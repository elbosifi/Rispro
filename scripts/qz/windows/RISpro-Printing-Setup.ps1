[CmdletBinding()]
param(
    [ValidateSet("Install", "Repair", "Diagnose")]
    [string]$Mode = "Repair",
    [string]$RisproBaseUrl = '__RISPRO_BASE_URL__',
    [switch]$ForcePinnedVersion,
    [Parameter(DontShow)]
    [string]$InteractiveUserSid,
    [Parameter(DontShow)]
    [string]$InteractiveUserName,
    [Parameter(DontShow)]
    [int]$InteractiveSessionId = -1
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:ExitCode = 1
$script:Phase = "Startup"
$script:LogFile = $null
$script:WorkDir = $null
$script:PinnedVersion = "2.2.6"
$script:QzDirectory = Join-Path $env:ProgramFiles "QZ Tray"
$script:QzConsole = Join-Path $script:QzDirectory "qz-tray-console.exe"
$script:QzExecutable = Join-Path $script:QzDirectory "qz-tray.exe"
$script:ExpectedSignerThumbprint = "2F8040E46C966DB1154357F5E80B2BBEB0EEF342"
$script:ExpectedSignerSubject = "CN=QZ Industries LLC, O=QZ Industries LLC, L=Canastota, S=New York, C=US, SERIALNUMBER=4430894, OID.2.5.4.15=Private Organization, OID.1.3.6.1.4.1.311.60.2.1.2=New York, OID.1.3.6.1.4.1.311.60.2.1.3=US"
$script:HealthResults = @()

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-NormalizedRisproOrigin([string]$Value) {
    $uri = New-Object System.Uri($Value, [System.UriKind]::Absolute)
    if ($uri.Scheme -ne "https" -and $env:RISPRO_QZ_ALLOW_HTTP_DEV -ne "1") { throw "RISproBaseUrl must use HTTPS." }
    if ($uri.Scheme -ne "https" -and $uri.Scheme -ne "http") { throw "RISproBaseUrl uses an unsupported scheme." }
    if (-not [string]::IsNullOrEmpty($uri.UserInfo) -or $uri.AbsolutePath -ne "/" -or -not [string]::IsNullOrEmpty($uri.Query) -or -not [string]::IsNullOrEmpty($uri.Fragment)) {
        throw "RisproBaseUrl must contain only an origin."
    }
    return $uri.GetLeftPart([System.UriPartial]::Authority)
}

function Test-ValidUserSid([string]$Sid) {
    return -not [string]::IsNullOrWhiteSpace($Sid) -and $Sid -match '^S-1-(?:\d+-){1,14}\d+$'
}

function Get-OriginalInteractiveUser {
    if (-not (Test-IsAdministrator)) {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        return [pscustomobject]@{ Sid = $identity.User.Value; Name = $identity.Name; SessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId }
    }
    if (Test-ValidUserSid $InteractiveUserSid) {
        $validatedSid = New-Object Security.Principal.SecurityIdentifier($InteractiveUserSid)
        $validatedName = $validatedSid.Translate([Security.Principal.NTAccount]).Value
        return [pscustomobject]@{ Sid = $validatedSid.Value; Name = $validatedName; SessionId = $InteractiveSessionId }
    }
    $interactiveName = [string](Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue).UserName
    if ([string]::IsNullOrWhiteSpace($interactiveName)) { throw "No interactive Windows user could be identified." }
    $sid = (New-Object Security.Principal.NTAccount($interactiveName)).Translate([Security.Principal.SecurityIdentifier]).Value
    $session = @(Get-Process explorer -IncludeUserName -ErrorAction SilentlyContinue | Where-Object { $_.UserName -eq $interactiveName } | Select-Object -First 1).SessionId
    return [pscustomobject]@{ Sid = $sid; Name = $interactiveName; SessionId = $(if ($null -eq $session) { -1 } else { [int]$session }) }
}

function Assert-DomainPowerShellPolicy {
    $policies = Get-ExecutionPolicy -List
    foreach ($scope in @("MachinePolicy", "UserPolicy")) {
        $policy = [string]($policies | Where-Object Scope -eq $scope).ExecutionPolicy
        if ($policy -in @("Restricted", "AllSigned", "RemoteSigned")) {
            throw "The NCCB domain PowerShell policy blocks the RISpro bootstrapper. Deploy the signed package or use the approved Group Policy installation."
        }
    }
}

function Invoke-SelfElevation([string]$Origin, $InteractiveUser) {
    if (Test-IsAdministrator) { return }
    $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $PSCommandPath), "-Mode", $Mode, "-RisproBaseUrl", ('"{0}"' -f $Origin), "-InteractiveUserSid", $InteractiveUser.Sid, "-InteractiveUserName", ('"{0}"' -f $InteractiveUser.Name), "-InteractiveSessionId", [string]$InteractiveUser.SessionId)
    if ($ForcePinnedVersion) { $arguments += "-ForcePinnedVersion" }
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -Verb RunAs -Wait -PassThru
    exit $process.ExitCode
}

function Initialize-Log {
    $directory = Join-Path $env:ProgramData "RISpro\PrintingSetup"
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $script:LogFile = Join-Path $directory "setup.log"
    if ((Test-Path -LiteralPath $script:LogFile) -and (Get-Item -LiteralPath $script:LogFile).Length -gt 2MB) {
        $previous = "$($script:LogFile).1"
        if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Force }
        Move-Item -LiteralPath $script:LogFile -Destination $previous
    }
}

function Write-SetupLog([string]$Message) {
    $line = "{0} [{1}] {2}" -f ([DateTime]::UtcNow.ToString("o")), $script:Phase, $Message
    Write-Host $line
    if ($null -ne $script:LogFile) { Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8 }
}

function Invoke-WithRetry([scriptblock]$Action, [string]$Description, [int]$Attempts = 3) {
    $lastError = $null
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try { return & $Action } catch { $lastError = $_; Write-SetupLog "$Description attempt $attempt failed: $($_.Exception.Message)"; if ($attempt -lt $Attempts) { Start-Sleep -Seconds ([Math]::Min(5, $attempt * 2)) } }
    }
    throw $lastError
}

function Get-RisproManifest([string]$Origin) {
    $url = "$Origin/api/public/printing-bootstrap/manifest"
    $response = Invoke-WithRetry { Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 30 } "Manifest download"
    if ($null -eq $response -or $response.schemaVersion -ne 1 -or $response.ready -ne $true) {
        $reasonProperty = if ($null -ne $response) { $response.PSObject.Properties["reason"] } else { $null }
        $reason = if ($null -ne $reasonProperty) { [string]$reasonProperty.Value } else { "Malformed or unavailable bootstrap manifest." }
        throw $reason
    }
    if ($response.risproOrigin -ne $Origin -or $response.qzVersion -ne $script:PinnedVersion -or $response.qzInstallerArchitecture -ne "x86_64") { throw "Bootstrap manifest identity, version, or architecture does not match this script." }
    $expectedUrls = @{
        qzInstallerUrl = "$Origin/api/public/printing-bootstrap/qz-installer"
        rootCertificateUrl = "$Origin/api/public/printing-bootstrap/root-certificate"
        signingCertificateUrl = "$Origin/api/public/printing-bootstrap/signing-certificate"
        windowsScriptUrl = "$Origin/api/public/printing-bootstrap/windows-script"
        windowsLauncherUrl = "$Origin/api/public/printing-bootstrap/windows-launcher"
        printingSettingsUrl = "$Origin/workstation/printing"
    }
    foreach ($name in $expectedUrls.Keys) { if ([string]$response.$name -ne $expectedUrls[$name]) { throw "Bootstrap manifest contains an unexpected $name." } }
    return $response
}

function Save-VerifiedDownload([string]$Url, [string]$Path, [string]$ExpectedSha256) {
    Invoke-WithRetry { Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing -TimeoutSec 900 } "Artifact download" | Out-Null
    Test-FileHash -Path $Path -ExpectedSha256 $ExpectedSha256
}

function Test-FileHash([string]$Path, [string]$ExpectedSha256) {
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $ExpectedSha256.ToLowerInvariant()) { throw "SHA-256 mismatch for downloaded artifact." }
    Write-SetupLog "Verified SHA-256 $actual for $(Split-Path -Leaf $Path)."
}

function Get-Certificate([string]$Path) { return New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($Path) }

function Test-CertificateArtifact([string]$Path, [string]$ExpectedSha256, [string]$ExpectedFingerprint) {
    Test-FileHash -Path $Path -ExpectedSha256 $ExpectedSha256
    $certificate = Get-Certificate $Path
    $expected = $ExpectedFingerprint.Replace(":", "").ToUpperInvariant()
    $actualFingerprint = $certificate.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256).ToUpperInvariant()
    if ($actualFingerprint -ne $expected) { throw "Certificate fingerprint mismatch." }
    $now = [DateTime]::UtcNow
    if ($now -lt $certificate.NotBefore.ToUniversalTime() -or $now -gt $certificate.NotAfter.ToUniversalTime()) { throw "Downloaded certificate is not currently valid." }
    Write-SetupLog "Verified certificate SHA-256 fingerprint $actualFingerprint."
    return $certificate
}

function Test-CertificateChain([string]$LeafPath, [string]$RootPath, $Leaf, $Root) {
    if ($Leaf.Issuer -ne $Root.Subject) { throw "Signing certificate issuer does not match the RISpro QZ root subject." }
    $output = & certutil.exe -verify -f $LeafPath $RootPath 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Signing certificate chain verification failed: $($output -join ' ')" }
    Write-SetupLog "Verified signing certificate chain to $($Root.Subject)."
}

function Test-InstallerSignature([string]$Path) {
    # File identity, publisher identity, and the expected issuing chain are independent controls; none substitutes for another.
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or $null -eq $signature.SignerCertificate) { throw "QZ installer Authenticode signature is not valid." }
    $signer = $signature.SignerCertificate
    if ($signer.Thumbprint.ToUpperInvariant() -ne $script:ExpectedSignerThumbprint -or $signer.Subject -ne $script:ExpectedSignerSubject) { throw "QZ installer signer identity does not match the pinned official 2.2.6 publisher certificate." }
    $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
    $chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(10)
    $chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::Offline
    $chain.ChainPolicy.RevocationFlag = [System.Security.Cryptography.X509Certificates.X509RevocationFlag]::EntireChain
    $chain.ChainPolicy.VerificationFlags = [System.Security.Cryptography.X509Certificates.X509VerificationFlags]::NoFlag
    if (-not $chain.Build($signer)) { throw "QZ installer publisher chain could not be validated." }
    $subjects = @($chain.ChainElements | ForEach-Object { $_.Certificate.Subject })
    if ($subjects -notcontains 'CN=DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1, O="DigiCert, Inc.", C=US' -or $subjects -notcontains 'CN=DigiCert Trusted Root G4, OU=www.digicert.com, O=DigiCert Inc, C=US') { throw "QZ installer publisher chain is unexpected." }
    Write-SetupLog "Verified Authenticode signer $($signer.Subject), thumbprint $($signer.Thumbprint)."
}

function Get-QzVersion {
    if (-not (Test-Path -LiteralPath $script:QzConsole)) { return $null }
    $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($script:QzConsole)
    $candidate = [string]$info.ProductVersion
    $match = [regex]::Match($candidate, '\d+\.\d+\.\d+')
    if (-not $match.Success) { return $null }
    return $match.Value
}

function Install-QzTray([string]$InstallerPath) {
    $current = Get-QzVersion
    if ($current -eq $script:PinnedVersion) { Write-SetupLog "QZ Tray $current is already installed; skipping reinstall."; return }
    if ($null -ne $current) {
        $comparison = ([version]$current).CompareTo([version]$script:PinnedVersion)
        if ($comparison -gt 0 -and -not $ForcePinnedVersion) { throw "QZ Tray $current is newer than pinned version $($script:PinnedVersion); use -ForcePinnedVersion for a controlled downgrade." }
    }
    $process = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -Wait -PassThru
    Write-SetupLog "QZ installer exited with code $($process.ExitCode)."
    if ($process.ExitCode -ne 0) { throw "QZ Tray silent installation failed." }
    if ((Get-QzVersion) -ne $script:PinnedVersion) { throw "QZ Tray installation did not produce exact version $($script:PinnedVersion)." }
}

function Stop-QzTray {
    $expectedPrefix = $script:QzDirectory.TrimEnd('\') + '\'
    $targets = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
    })
    foreach ($process in $targets) { [void]$process.CloseMainWindow() }
    if ($targets.Count -gt 0) { Start-Sleep -Seconds 3 }
    foreach ($process in $targets) { if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force } }
}

function Set-QzRootTrust([string]$RootPath) {
    $destination = Join-Path $script:QzDirectory "override.crt"
    if ((Test-Path -LiteralPath $destination) -and ((Get-FileHash $destination -Algorithm SHA256).Hash -eq (Get-FileHash $RootPath -Algorithm SHA256).Hash)) { Write-SetupLog "QZ root override already matches."; return }
    if (Test-Path -LiteralPath $destination) { Copy-Item -LiteralPath $destination -Destination "$destination.rispro.bak" -Force }
    $temporary = "$destination.rispro.tmp"
    Copy-Item -LiteralPath $RootPath -Destination $temporary -Force
    Move-Item -LiteralPath $temporary -Destination $destination -Force
    Write-SetupLog "Installed QZ override.crt atomically."
}

function Test-QzAllowedCertificate([string]$AllowlistPath, [string]$ExpectedThumbprint) {
    $expected = [regex]::Replace($ExpectedThumbprint, '[:\s]', '').ToUpperInvariant()
    if ($expected -notmatch '^[0-9A-F]{40}$' -or -not (Test-Path -LiteralPath $AllowlistPath)) { return $false }
    # QZ Tray v2.2.6 Certificate.saveFields serializes the SHA-1 fingerprint as the first tab-separated field.
    foreach ($line in @(Get-Content -LiteralPath $AllowlistPath -Encoding UTF8 -ErrorAction SilentlyContinue)) {
        if ([string]::IsNullOrWhiteSpace($line) -or -not $line.Contains("`t")) { continue }
        $fields = $line.Split("`t")
        if ($fields.Count -ne 6 -or @($fields[0..4] | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0 -or $fields[5] -notmatch '^(?i:true|false)$') { continue }
        $first = $fields[0].TrimStart([char]0xFEFF)
        $actual = [regex]::Replace($first, '[:\s]', '').ToUpperInvariant()
        if ($actual -match '^[0-9A-F]{40}$' -and $actual -eq $expected) { return $true }
    }
    return $false
}

function Add-QzAllowedCertificate([string]$CertificatePath, [string]$ExpectedThumbprint) {
    if (-not (Test-Path -LiteralPath $script:QzConsole)) { throw "qz-tray-console.exe is missing." }
    $output = & $script:QzConsole --whitelist $CertificatePath 2>&1
    $code = $LASTEXITCODE
    Write-SetupLog "QZ whitelist command exited with code $code."
    if ($code -ne 0) { throw "QZ certificate allowlist command failed: $($output -join ' ')" }
    $allowlist = Join-Path $env:ProgramData "qz\allowed.dat"
    if (-not (Test-QzAllowedCertificate $allowlist $ExpectedThumbprint)) { throw "QZ did not add the exact RISpro signing certificate fingerprint to the system-wide allowed.dat file." }
}

function Test-ExactPolicyValue([string]$RegistryPath, [string]$Origin) {
    if (-not (Test-Path $RegistryPath)) { return $false }
    $expected = Get-NormalizedRisproOrigin $Origin
    $key = Get-Item -Path $RegistryPath
    foreach ($name in $key.GetValueNames()) {
        try {
            $candidate = Get-NormalizedRisproOrigin ([string]$key.GetValue($name))
            if ([string]::Equals($candidate, $expected, [StringComparison]::Ordinal)) { return $true }
        } catch {}
    }
    return $false
}

function Add-ExactPolicyValue([string]$RegistryPath, [string]$Origin) {
    if (-not (Test-Path $RegistryPath)) { New-Item -Path $RegistryPath -Force | Out-Null }
    if (Test-ExactPolicyValue $RegistryPath $Origin) { Write-SetupLog "Browser policy already contains exact origin at $RegistryPath."; return }
    $key = Get-Item -Path $RegistryPath
    $numbers = @($key.GetValueNames() | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })
    $next = if ($numbers.Count -eq 0) { 1 } else { ([int](($numbers | Measure-Object -Maximum).Maximum)) + 1 }
    New-ItemProperty -Path $RegistryPath -Name ([string]$next) -PropertyType String -Value $Origin -Force | Out-Null
    Write-SetupLog "Added exact-origin browser policy at $RegistryPath value $next."
}

function Set-BrowserLocalNetworkPolicy([string]$Origin) {
    Add-ExactPolicyValue "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" $Origin
    Add-ExactPolicyValue "HKLM:\SOFTWARE\Policies\Microsoft\Edge\LocalNetworkAccessAllowedForUrls" $Origin
}

function Test-QzProcessOwner([string]$ExpectedSid) {
    if (-not (Test-ValidUserSid $ExpectedSid)) { return $false }
    foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        if (-not ([string]$process.ExecutablePath).StartsWith($script:QzDirectory.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
        $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction SilentlyContinue
        if ($null -ne $owner -and $owner.ReturnValue -eq 0 -and $owner.Sid -eq $ExpectedSid) { return $true }
    }
    return $false
}

function Start-QzTray([string]$ExpectedSid, [string]$ExpectedUserName) {
    if (-not (Test-Path -LiteralPath $script:QzExecutable)) { throw "QZ Tray executable is missing." }
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $taskFolder = $null
    $taskName = "RISpro-QZ-Start-" + [guid]::NewGuid().ToString("N")
    try {
        if ($currentSid -eq $ExpectedSid) {
            $output = & $script:QzConsole spawn $script:QzExecutable 2>&1
            if ($LASTEXITCODE -ne 0) { throw "QZ Tray spawn command failed: $($output -join ' ')" }
        } else {
            # QZ 2.2.6's Windows spawn implementation cannot drop an alternate UAC administrator token.
            # Run that same supported spawn command through a temporary interactive-token task for the original user.
            $scheduler = New-Object -ComObject "Schedule.Service"
            $scheduler.Connect()
            $taskFolder = $scheduler.GetFolder("\")
            $definition = $scheduler.NewTask(0)
            $definition.RegistrationInfo.Description = "One-time RISpro QZ Tray launch for the original interactive user"
            $definition.Settings.Enabled = $true
            $definition.Settings.Hidden = $true
            $definition.Settings.ExecutionTimeLimit = "PT1M"
            $definition.Principal.UserId = $ExpectedUserName
            $definition.Principal.LogonType = 3 # TASK_LOGON_INTERACTIVE_TOKEN
            $definition.Principal.RunLevel = 0
            $trigger = $definition.Triggers.Create(1)
            $trigger.StartBoundary = [DateTime]::Now.AddSeconds(2).ToString("s")
            $trigger.Enabled = $true
            $action = $definition.Actions.Create(0)
            $action.Path = $script:QzConsole
            $action.Arguments = 'spawn "{0}"' -f $script:QzExecutable
            $action.WorkingDirectory = $script:QzDirectory
            $registered = $taskFolder.RegisterTaskDefinition($taskName, $definition, 6, $null, $null, 3, $null)
            [void]$registered.Run($null)
        }
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        do {
            if (Test-QzProcessOwner $ExpectedSid) { return }
            Start-Sleep -Milliseconds 500
        } while ([DateTime]::UtcNow -lt $deadline)
        throw "QZ Tray did not start under the intended interactive user SID $ExpectedSid."
    } finally {
        if ($null -ne $taskFolder) { try { $taskFolder.DeleteTask($taskName, 0) } catch {} }
    }
}

function Test-QzAutostart([string]$UserSid) {
    if (-not (Test-ValidUserSid $UserSid)) { Write-SetupLog "Original interactive user SID is invalid."; return $false }
    $userHive = "Registry::HKEY_USERS\$UserSid"
    if (-not (Test-Path $userHive)) { Write-SetupLog "Original user registry hive $userHive is not loaded; autostart cannot be verified."; return $false }

    $runPath = "$userHive\Software\Microsoft\Windows\CurrentVersion\Run"
    $legacy = Get-ItemProperty -Path $runPath -Name "QZ Tray" -ErrorAction SilentlyContinue
    if ($null -ne $legacy) { Write-SetupLog "Inspected the original user's legacy QZ Tray Run entry." }

    # QZ Tray 2.2.6 installs a shared Startup shortcut with --honorautostart, not a per-admin HKCU entry.
    $shortcutPath = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Startup\QZ Tray.lnk"
    if (-not (Test-Path -LiteralPath $shortcutPath)) { Write-SetupLog "QZ Tray 2.2.6 shared Startup shortcut is missing."; return $false }
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    if (-not [string]::Equals($shortcut.TargetPath, $script:QzExecutable, [StringComparison]::OrdinalIgnoreCase) -or $shortcut.Arguments -notmatch '(?:^|\s)--honorautostart(?:\s|$)') {
        Write-SetupLog "QZ Tray shared Startup shortcut does not target the pinned executable with --honorautostart."; return $false
    }

    $profileKey = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$UserSid"
    $profile = [string](Get-ItemPropertyValue -Path $profileKey -Name ProfileImagePath -ErrorAction SilentlyContinue)
    if ([string]::IsNullOrWhiteSpace($profile)) { Write-SetupLog "Original user profile path is unavailable; .autostart cannot be verified."; return $false }
    $userPreference = Join-Path ([Environment]::ExpandEnvironmentVariables($profile)) "AppData\Roaming\qz\.autostart"
    $sharedPreference = Join-Path $env:ProgramData "qz\.autostart"
    $preference = if (Test-Path -LiteralPath $userPreference) { $userPreference } elseif (Test-Path -LiteralPath $sharedPreference) { $sharedPreference } else { $null }
    if ($null -ne $preference) {
        $preferenceValue = [string](Get-Content -LiteralPath $preference -TotalCount 1 -ErrorAction SilentlyContinue)
        if ($preferenceValue.Trim() -ne "1") { Write-SetupLog "QZ autostart preference disables startup for the original user."; return $false }
    }
    Write-SetupLog "Verified QZ Tray 2.2.6 autostart for original user SID $UserSid."
    return $true
}

function Add-HealthResult([string]$Label, [string]$Status, [bool]$Required, [string]$Detail = "") {
    $script:HealthResults += [pscustomobject]@{ Label = $Label; Status = $Status; Required = $Required; Detail = $Detail }
}

function Test-QzHealth($Manifest, [string]$RootPath, $SigningCertificate, $InteractiveUser) {
    $version = Get-QzVersion
    Add-HealthResult "QZ version" $(if ($version -eq $script:PinnedVersion) { "passed" } else { "failed" }) $true $(if ($null -eq $version) { "not installed" } else { $version })
    $override = Join-Path $script:QzDirectory "override.crt"
    $rootPassed = (Test-Path -LiteralPath $override) -and ((Get-FileHash $override -Algorithm SHA256).Hash -eq (Get-FileHash $RootPath -Algorithm SHA256).Hash)
    Add-HealthResult "Root trust configuration" $(if ($rootPassed) { "passed" } else { "failed" }) $true
    $allowlist = Join-Path $env:ProgramData "qz\allowed.dat"
    Add-HealthResult "RISpro certificate allowlist" $(if (Test-QzAllowedCertificate $allowlist $SigningCertificate.Thumbprint) { "passed" } else { "failed" }) $true

    $chromePolicy = "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls"
    $edgePolicy = "HKLM:\SOFTWARE\Policies\Microsoft\Edge\LocalNetworkAccessAllowedForUrls"
    $chromeInstalled = (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe") -or (Test-Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe")
    $edgeInstalled = Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"
    Add-HealthResult "Chrome local-network policy" $(if (Test-ExactPolicyValue $chromePolicy $Manifest.risproOrigin) { "passed" } else { "failed" }) $true $(if ($chromeInstalled) { "Chrome installed" } else { "Chrome not installed; policy retained for future installation" })
    Add-HealthResult "Edge local-network policy" $(if (Test-ExactPolicyValue $edgePolicy $Manifest.risproOrigin) { "passed" } else { "failed" }) $true $(if ($edgeInstalled) { "Edge installed" } else { "Edge not installed; policy retained for future installation" })
    Add-HealthResult "Chrome installation" $(if ($chromeInstalled) { "passed" } else { "not applicable" }) $false
    Add-HealthResult "Edge installation" $(if ($edgeInstalled) { "passed" } else { "not applicable" }) $false
    Add-HealthResult "QZ autostart for $($InteractiveUser.Name)" $(if (Test-QzAutostart $InteractiveUser.Sid) { "passed" } else { "failed" }) $true
    Add-HealthResult "QZ process owner" $(if (Test-QzProcessOwner $InteractiveUser.Sid) { "passed" } else { "failed" }) $true "expected SID $($InteractiveUser.Sid)"

    $available = $false
    foreach ($port in @($Manifest.securePorts)) {
        try { $client = New-Object Net.Sockets.TcpClient; $result = $client.BeginConnect("localhost", [int]$port, $null, $null); if ($result.AsyncWaitHandle.WaitOne(2000) -and $client.Connected) { $available = $true }; $client.Close() } catch {}
        if ($available) { Write-SetupLog "QZ secure port $port is reachable."; break }
    }
    Add-HealthResult "QZ secure port" $(if ($available) { "passed" } else { "failed" }) $true
    $endpointPassed = $Manifest.signingCertificateFingerprint.Replace(":", "").ToUpperInvariant() -eq $SigningCertificate.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256).ToUpperInvariant()
    Add-HealthResult "RISpro certificate endpoint" $(if ($endpointPassed) { "passed" } else { "failed" }) $true
    Add-HealthResult "Physical signed-call status" "pending physical verification" $false
    Add-HealthResult "Physical printer output" "pending physical verification" $false
    foreach ($result in $script:HealthResults) { Write-Host "$($result.Label): $($result.Status)$(if ($result.Detail) { ' - ' + $result.Detail })" }
    return -not @($script:HealthResults | Where-Object { $_.Required -and $_.Status -eq "failed" }).Count
}

try {
    $origin = Get-NormalizedRisproOrigin $RisproBaseUrl
    Assert-DomainPowerShellPolicy
    $interactiveUser = Get-OriginalInteractiveUser
    if (-not (Test-ValidUserSid $interactiveUser.Sid)) { throw "The original interactive user SID is invalid." }
    Invoke-SelfElevation $origin $interactiveUser
    Initialize-Log
    Write-SetupLog "RISpro printing setup started in $Mode mode."
    $script:Phase = "Preflight"; $script:ExitCode = 10
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or [Environment]::OSVersion.Version.Major -ne 10) { throw "Windows 10 or 11 is required." }
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ($architecture -eq "ARM64") { throw "Windows ARM64 is not supported by RISpro Printing Bootstrap Phase 1." }
    if ($architecture -ne "AMD64") { throw "Only Windows x86-64 is supported by RISpro Printing Bootstrap Phase 1." }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $manifest = Get-RisproManifest $origin
    $script:WorkDir = Join-Path ([IO.Path]::GetTempPath()) ("RISpro-Printing-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $script:WorkDir | Out-Null

    $script:Phase = "Download"; $script:ExitCode = 20
    $installer = Join-Path $script:WorkDir "qz-tray-2.2.6-x86_64.exe"
    $root = Join-Path $script:WorkDir "qz-root-ca.crt"
    $signing = Join-Path $script:WorkDir "qz-signing-certificate.pem"
    Save-VerifiedDownload $manifest.qzInstallerUrl $installer $manifest.qzInstallerSha256
    Save-VerifiedDownload $manifest.rootCertificateUrl $root $manifest.rootCertificateSha256
    Save-VerifiedDownload $manifest.signingCertificateUrl $signing $manifest.signingCertificateSha256
    $rootCertificate = Test-CertificateArtifact $root $manifest.rootCertificateSha256 $manifest.rootCertificateFingerprint
    $signingCertificate = Test-CertificateArtifact $signing $manifest.signingCertificateSha256 $manifest.signingCertificateFingerprint
    Test-CertificateChain $signing $root $signingCertificate $rootCertificate

    $script:Phase = "InstallerSignature"; $script:ExitCode = 30
    Test-InstallerSignature $installer

    if ($Mode -ne "Diagnose") {
        $script:Phase = "Installation"; $script:ExitCode = 40; Install-QzTray $installer
        Stop-QzTray
        $script:Phase = "RootTrust"; $script:ExitCode = 50; Set-QzRootTrust $root
        $script:Phase = "Allowlist"; $script:ExitCode = 60; Add-QzAllowedCertificate $signing $signingCertificate.Thumbprint
        $script:Phase = "BrowserPolicy"; $script:ExitCode = 70; Set-BrowserLocalNetworkPolicy $origin
        Start-QzTray $interactiveUser.Sid $interactiveUser.Name
    } else { Write-SetupLog "Diagnose mode: installation, trust, allowlist, browser policy, and startup writes were skipped." }

    $script:Phase = "Health"; $script:ExitCode = 80
    $requiredHealthPassed = Test-QzHealth $manifest $root $signingCertificate $interactiveUser
    if (-not $requiredHealthPassed) { throw "One or more required RISpro printing configuration checks failed." }
    Write-Host "Required software and configuration checks: passed"
    Write-SetupLog "Final required software/configuration health state: passed; browser signed-call and physical printing remain pending."
    if ($Mode -ne "Diagnose") { & $script:QzConsole spawn "$env:SystemRoot\explorer.exe" $manifest.printingSettingsUrl | Out-Null }
    $script:ExitCode = 0
} catch {
    Write-Host "RISpro printing setup failed during $($script:Phase): $($_.Exception.Message)" -ForegroundColor Red
    Write-SetupLog "FAILED: $($_.Exception.Message)"
} finally {
    if ($null -ne $script:WorkDir -and (Test-Path -LiteralPath $script:WorkDir)) { Remove-Item -LiteralPath $script:WorkDir -Recurse -Force }
}

exit $script:ExitCode

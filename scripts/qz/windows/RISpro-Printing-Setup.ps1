[CmdletBinding()]
param(
    [ValidateSet("Install", "Repair", "Diagnose")]
    [string]$Mode = "Repair",
    [string]$RisproBaseUrl = '__RISPRO_BASE_URL__',
    [switch]$ForcePinnedVersion
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

function Invoke-SelfElevation([string]$Origin) {
    if (Test-IsAdministrator) { return }
    $arguments = @("-NoProfile", "-File", ('"{0}"' -f $PSCommandPath), "-Mode", $Mode, "-RisproBaseUrl", ('"{0}"' -f $Origin))
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
    if ($certificate.Thumbprint.ToUpperInvariant() -ne $expected) { throw "Certificate fingerprint mismatch." }
    $now = [DateTime]::UtcNow
    if ($now -lt $certificate.NotBefore.ToUniversalTime() -or $now -gt $certificate.NotAfter.ToUniversalTime()) { throw "Downloaded certificate is not currently valid." }
    Write-SetupLog "Verified certificate fingerprint $($certificate.Thumbprint)."
    return $certificate
}

function Test-CertificateChain([string]$LeafPath, [string]$RootPath, $Leaf, $Root) {
    if ($Leaf.Issuer -ne $Root.Subject) { throw "Signing certificate issuer does not match the RISpro QZ root subject." }
    $output = & certutil.exe -verify -f $LeafPath $RootPath 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Signing certificate chain verification failed: $($output -join ' ')" }
    Write-SetupLog "Verified signing certificate chain to $($Root.Subject)."
}

function Test-InstallerSignature([string]$Path) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or $null -eq $signature.SignerCertificate) { throw "QZ installer Authenticode signature is not valid." }
    $signer = $signature.SignerCertificate
    if ($signer.Thumbprint.ToUpperInvariant() -ne $script:ExpectedSignerThumbprint -or $signer.Subject -ne $script:ExpectedSignerSubject) { throw "QZ installer signer identity does not match the pinned official 2.2.6 publisher certificate." }
    $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
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

function Add-QzAllowedCertificate([string]$CertificatePath) {
    if (-not (Test-Path -LiteralPath $script:QzConsole)) { throw "qz-tray-console.exe is missing." }
    $output = & $script:QzConsole --whitelist $CertificatePath 2>&1
    $code = $LASTEXITCODE
    Write-SetupLog "QZ whitelist command exited with code $code."
    if ($code -ne 0) { throw "QZ certificate allowlist command failed: $($output -join ' ')" }
    $allowlist = Join-Path $env:ProgramData "qz\allowed.dat"
    if (-not (Test-Path -LiteralPath $allowlist) -or (Get-Item -LiteralPath $allowlist).Length -eq 0) { throw "QZ did not create or update the system-wide allowed.dat file." }
}

function Add-ExactPolicyValue([string]$RegistryPath, [string]$Origin) {
    if (-not (Test-Path $RegistryPath)) { New-Item -Path $RegistryPath -Force | Out-Null }
    $key = Get-Item -Path $RegistryPath
    foreach ($name in $key.GetValueNames()) { if ([string]$key.GetValue($name) -eq $Origin) { Write-SetupLog "Browser policy already contains exact origin at $RegistryPath."; return } }
    $numbers = @($key.GetValueNames() | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })
    $next = if ($numbers.Count -eq 0) { 1 } else { ([int](($numbers | Measure-Object -Maximum).Maximum)) + 1 }
    New-ItemProperty -Path $RegistryPath -Name ([string]$next) -PropertyType String -Value $Origin -Force | Out-Null
    Write-SetupLog "Added exact-origin browser policy at $RegistryPath value $next."
}

function Set-BrowserLocalNetworkPolicy([string]$Origin) {
    Add-ExactPolicyValue "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" $Origin
    Add-ExactPolicyValue "HKLM:\SOFTWARE\Policies\Microsoft\Edge\LocalNetworkAccessAllowedForUrls" $Origin
}

function Start-QzTray {
    if (-not (Test-Path -LiteralPath $script:QzExecutable)) { throw "QZ Tray executable is missing." }
    $output = & $script:QzConsole spawn $script:QzExecutable 2>&1
    if ($LASTEXITCODE -ne 0) { throw "QZ Tray could not be started in the interactive user session: $($output -join ' ')" }
}

function Test-QzAutostart {
    $entry = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "QZ Tray" -ErrorAction SilentlyContinue
    $property = if ($null -ne $entry) { $entry.PSObject.Properties["QZ Tray"] } else { $null }
    $value = if ($null -ne $property) { $property.Value } else { $null }
    if ([string]::IsNullOrWhiteSpace([string]$value)) { Write-SetupLog "QZ login startup is not registered; no duplicate entry was added."; return $false }
    Write-SetupLog "Verified QZ login startup registration."
    return $true
}

function Test-QzHealth($Manifest, [string]$RootPath) {
    if ((Get-QzVersion) -ne $script:PinnedVersion) { throw "Installed QZ version is not $($script:PinnedVersion)." }
    $override = Join-Path $script:QzDirectory "override.crt"
    if (-not (Test-Path -LiteralPath $override)) { throw "QZ root override is missing." }
    if ((Get-FileHash $override -Algorithm SHA256).Hash -ne (Get-FileHash $RootPath -Algorithm SHA256).Hash) { throw "QZ root override fingerprint does not match RISpro." }
    $allowlist = Join-Path $env:ProgramData "qz\allowed.dat"
    if (-not (Test-Path -LiteralPath $allowlist) -or (Get-Item $allowlist).Length -eq 0) { throw "QZ system-wide allowlist is unavailable." }
    [void](Test-QzAutostart)
    $available = $false
    foreach ($port in @($Manifest.securePorts)) {
        try { $client = New-Object Net.Sockets.TcpClient; $result = $client.BeginConnect("localhost", [int]$port, $null, $null); if ($result.AsyncWaitHandle.WaitOne(2000) -and $client.Connected) { $available = $true }; $client.Close() } catch {}
        if ($available) { Write-SetupLog "QZ secure port $port is reachable."; break }
    }
    if (-not $available) { throw "No expected QZ secure port became reachable." }
}

try {
    $origin = Get-NormalizedRisproOrigin $RisproBaseUrl
    Invoke-SelfElevation $origin
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
        $script:Phase = "Allowlist"; $script:ExitCode = 60; Add-QzAllowedCertificate $signing
        $script:Phase = "BrowserPolicy"; $script:ExitCode = 70; Set-BrowserLocalNetworkPolicy $origin
        Start-QzTray
        Start-Sleep -Seconds 4
    } else { Write-SetupLog "Diagnose mode: installation, trust, allowlist, browser policy, and startup writes were skipped." }

    $script:Phase = "Health"; $script:ExitCode = 80
    Test-QzHealth $manifest $root
    Write-Host "Installation: passed"
    Write-Host "QZ version: passed"
    Write-Host "Root trust configuration: passed"
    Write-Host "RISpro certificate allowlist: passed"
    Write-Host "QZ secure port: passed"
    Write-Host "Browser policy: $(if ($Mode -eq 'Diagnose') { 'not modified' } else { 'passed; restart Chrome/Edge if already open' })"
    Write-Host "Browser signed-print verification: pending"
    Write-Host "RISpro printing is ready"
    Write-SetupLog "Final health state: ready; physical signed printing remains pending."
    if ($Mode -ne "Diagnose") { & $script:QzConsole spawn "$env:SystemRoot\explorer.exe" $manifest.printingSettingsUrl | Out-Null }
    $script:ExitCode = 0
} catch {
    Write-Host "RISpro printing setup failed during $($script:Phase): $($_.Exception.Message)" -ForegroundColor Red
    Write-SetupLog "FAILED: $($_.Exception.Message)"
} finally {
    if ($null -ne $script:WorkDir -and (Test-Path -LiteralPath $script:WorkDir)) { Remove-Item -LiteralPath $script:WorkDir -Recurse -Force }
}

exit $script:ExitCode

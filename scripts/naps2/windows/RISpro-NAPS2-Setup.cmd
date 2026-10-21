@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "RISPRO_NAPS2_SETUP_FILE=%~f0"
set "RISPRO_NAPS2_MODE=%~1"
if not defined RISPRO_NAPS2_MODE set "RISPRO_NAPS2_MODE=Repair"
powershell.exe -NoProfile -Command "$s=[IO.File]::ReadAllText($env:RISPRO_NAPS2_SETUP_FILE); & ([scriptblock]::Create($s.Substring([regex]::Match($s,'(?m)^# RISPRO_NAPS2_POWERSHELL\r?$').Index + [regex]::Match($s,'(?m)^# RISPRO_NAPS2_POWERSHELL\r?$').Length)))"
set "RISPRO_NAPS2_EXIT=%ERRORLEVEL%"
echo.
echo Setup log: %%ProgramData%%\RISpro\NAPS2Setup\
pause
exit /b %RISPRO_NAPS2_EXIT%
# RISPRO_NAPS2_POWERSHELL
param([string]$Mode = $env:RISPRO_NAPS2_MODE)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:LogFile = $null
$script:Issues = New-Object 'System.Collections.Generic.List[string]'
$script:Naps2ConfigurationValid = $false
$script:EdgePolicyStates = @{}
$script:EdgePolicyChanges = New-Object 'System.Collections.Generic.List[string]'

function Write-SetupLog([string]$Message) {
    Write-Host $Message
    if ($script:LogFile) { Add-Content -LiteralPath $script:LogFile -Value ('{0:o} {1}' -f [DateTime]::Now, $Message) -Encoding UTF8 }
}
function Add-Action([string]$Message) {
    $script:Issues.Add($Message)
    Write-SetupLog "Action required: $Message"
}
function Test-Administrator {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Read-SafeXml([string]$Path) {
    $settings = New-Object System.Xml.XmlReaderSettings
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [System.Xml.XmlReader]::Create($Path, $settings)
    try {
        $document = New-Object System.Xml.XmlDocument
        $document.PreserveWhitespace = $true
        $document.XmlResolver = $null
        $document.Load($reader)
        return ,$document
    } finally { $reader.Dispose() }
}
function Get-NormalizedNaps2InstallationPaths([string[]]$Candidates) {
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $paths = New-Object 'System.Collections.Generic.List[string]'
    foreach ($candidate in $Candidates) {
        if (-not $candidate) { continue }
        # Program Files, registry and a running process can name the same folder
        # with different case or a trailing separator. Windows path comparison is
        # case-insensitive, so normalize both before counting installations.
        $path = $candidate.Trim().TrimEnd([char[]]"\/")
        if ($path -and $seen.Add($path)) { $paths.Add($path) }
    }
    return $paths.ToArray()
}
function Find-Naps2Installation([string[]]$Candidates) {
    $found = @(Get-NormalizedNaps2InstallationPaths $Candidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'NAPS2.exe') })
    if ($found.Count -eq 0) { throw 'NAPS2 is not installed in a supported location. Install the official NAPS2 release; this setup never downloads or installs software.' }
    if ($found.Count -gt 1) { throw ('Multiple NAPS2 installations found. An administrator must identify the active installation: ' + ($found -join ', ')) }
    $path = Join-Path $found[0] 'appsettings.xml'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Installed NAPS2 has no appsettings.xml at $path. Repair the official installation; setup will not guess or modify a user config.xml." }
    return $path
}
function Assert-Naps2Version([string]$Value) {
    $version = $null
    if (-not [version]::TryParse($Value, [ref]$version) -or $version -lt [version]'7.5.2') { throw "NAPS2 version '$Value' cannot be verified as supporting ServerAllowAnyOrigin (requires 7.5.2 or later). Install a current official release manually; no XML was changed." }
}
function Set-Naps2Xml([string]$Path, [bool]$Diagnose) {
    $beforeHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    $document = Read-SafeXml $Path
    if ($document.DocumentElement.Name -ne 'AppConfig' -or $document.DocumentElement.NamespaceURI) { throw 'Invalid appsettings.xml: expected AppConfig root without a namespace. No changes made.' }
    if ($document.SelectSingleNode('/AppConfig/NoScannerSharing[text()="true"]')) { throw 'NAPS2 application policy disables Scanner Sharing (NoScannerSharing). Ask its administrator to review this policy.' }
    $nodes = @($document.SelectNodes('/AppConfig/EsclSecurityPolicy'))
    $values = @($nodes | ForEach-Object { $_.InnerText.Trim() } | Select-Object -Unique)
    if ($values.Count -gt 1 -or @($values | Where-Object { $_ -notin @('', 'None', 'ServerAllowAnyOrigin') }).Count -gt 0) {
        throw ('Conflicting EsclSecurityPolicy: ' + ($values -join ', ') + '. Preserved unchanged. An administrator must review HTTP/security requirements.')
    }
    if ($nodes.Count -eq 1 -and $values[0] -eq 'ServerAllowAnyOrigin') { Write-SetupLog 'NAPS2 XML configuration: correct (no changes).'; return $true }
    if ($Diagnose) { Add-Action 'NAPS2 appsettings.xml needs ServerAllowAnyOrigin exactly once. Run Repair after reviewing any policy conflict.'; return $false }
    $backup = $Path + '.RISpro-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.bak'
    [void](Copy-Item -LiteralPath $Path -Destination $backup -ErrorAction Stop)
    Write-SetupLog "XML backup: $backup"
    if ($nodes.Count -eq 0) {
        $node = $document.CreateElement('EsclSecurityPolicy')
        [void]$document.DocumentElement.AppendChild($node)
    } else { $node = $nodes[0] }
    $node.InnerText = 'ServerAllowAnyOrigin'
    foreach ($duplicate in @($nodes | Select-Object -Skip 1)) { [void]$document.DocumentElement.RemoveChild($duplicate) }
    $temporary = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        $document.Save($temporary)
        $verify = Read-SafeXml $temporary
        if (@($verify.SelectNodes('/AppConfig/EsclSecurityPolicy')).Count -ne 1) { throw 'XML verification failed before replacement.' }
        if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $beforeHash) { throw 'NAPS2 configuration changed during setup. Original preserved; rerun setup when configuration edits are finished.' }
        [IO.File]::Replace($temporary, $Path, $backup)
        Write-SetupLog 'NAPS2 XML configuration: repaired atomically; unrelated elements preserved.'
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
    return $true
}
function Get-PolicyValues([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $key = Get-Item -LiteralPath $Path
        foreach ($name in $key.GetValueNames()) { if ($name) { [string]$key.GetValue($name) } }
    }
}
function Test-PolicyPattern([string]$Pattern, [uri]$Origin) {
    # Edge patterns without a port match all ports. Unknown patterns require admin review.
    $value = $Pattern.Trim().TrimEnd('/')
    if ($value -eq '*') { return $true }
    if ($value -match '^(?:(http|https|\*)://)?(\[\*\.\])?([^/:]+)(?::(\d+|\*))?(?:/.*)?$') {
        $scheme = [string]$Matches[1]; $subdomains = [string]$Matches[2]; $hostName = [string]$Matches[3]; $port = [string]$Matches[4]
        return (($scheme -eq '' -or $scheme -eq '*' -or $scheme -eq $Origin.Scheme) -and
            ($hostName -eq '*' -or $hostName -eq $Origin.Host -or ($subdomains -and $Origin.Host.EndsWith('.' + $hostName))) -and
            ($port -eq '' -or $port -eq '*' -or [int]$port -eq $Origin.Port))
    }
    Add-Action "Cannot evaluate Edge policy pattern '$Pattern'. Ask the administrator to inspect edge://policy."
    return $true
}

function ConvertTo-EdgeVersion([string]$ProductVersion) {
    if ($ProductVersion -notmatch '^\d+\.\d+\.\d+\.\d+$') { return $null }
    $version = $null
    if ([version]::TryParse($ProductVersion, [ref]$version) -and $version.Build -ge 0 -and $version.Revision -ge 0) { return $version }
    return $null
}
function Find-EdgeExecutable([string[]]$Candidates) {
    foreach ($candidate in $Candidates) { if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate } }
    return $null
}
function Get-RequiredEdgePolicies([version]$Version) {
    if ($null -eq $Version -or $Version -lt [version]'77.0.0.0') { return @() }
    $policies = @('OverrideSecurityRestrictionsOnInsecureOrigin')
    if ($Version -ge [version]'140.0.0.0') { $policies += 'LocalNetworkAccessAllowedForUrls' }
    if ($Version -ge [version]'146.0.0.0') { $policies += 'LoopbackNetworkAllowedForUrls' }
    return $policies
}
function Test-ExactEdgePolicyOrigin([string]$Path, [string]$Exact) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $key = Get-Item -LiteralPath $Path
    foreach ($name in $key.GetValueNames()) {
        if ([string]$key.GetValue($name) -ceq $Exact) {
            try { if ($key.GetValueKind($name) -eq [Microsoft.Win32.RegistryValueKind]::String) { return $true } }
            catch { }
        }
    }
    return $false
}
function Confirm-InsecureOriginCompatibility([string]$Exact, [bool]$Interactive = ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected)) {
    Write-SetupLog 'RISpro is configured for HTTP LAN access. Microsoft Edge requires an insecure-origin compatibility exception to permit browser-based local scanning. This exception applies only to the configured RISpro address. It does NOT enable HTTPS or encrypt network traffic.'
    Write-SetupLog "Configured RISpro origin: $Exact"
    if (-not $Interactive) { Write-SetupLog 'Administrator confirmation is unavailable in this noninteractive session.'; return $false }
    try { return ((Read-Host 'Administrator approval required. Type YES to add this exact-origin Edge policy') -ceq 'YES') }
    catch { Write-SetupLog 'Administrator confirmation was unavailable; the insecure-origin policy was not added.'; return $false }
}
function Set-EdgePolicyOrigin([string]$Policy, [uri]$Origin, [bool]$Diagnose, [bool]$Managed, [bool]$RequireApproval, [bool]$AllowInsecurePolicy, [bool]$Interactive, [string]$MachineRoot) {
    # Explicit :80 is intentional: an omitted port in a policy pattern can allow other ports.
    $exact = '{0}://{1}:{2}' -f $Origin.Scheme, $Origin.Host, $Origin.Port
    $path = Join-Path $MachineRoot $Policy
    $script:EdgePolicyStates[$Policy] = $false
    if (Test-ExactEdgePolicyOrigin $path $exact) {
        $script:EdgePolicyStates[$Policy] = $true
        Write-SetupLog "Edge machine policy ${Policy}: exact REG_SZ origin already present: $exact"
        return
    }
    if ($Diagnose) { Add-Action "Required Edge policy $Policy is missing exact origin $exact. Diagnose did not modify policy."; return }
    if ($Managed) { Add-Action "This domain/MDM-managed machine needs central configuration of Edge policy $Policy with exact origin $exact. No local policy was written."; return }
    if ($RequireApproval -and -not $AllowInsecurePolicy) { Add-Action "HostRepair did not add Edge policy $Policy. Run Repair to review and explicitly approve the exact-origin HTTP compatibility exception for $exact."; return }
    if ($RequireApproval -and -not (Confirm-InsecureOriginCompatibility $exact $Interactive)) {
        Add-Action "Administrator approval was declined or unavailable. Edge policy $Policy was not added for $exact; browser-based scanning is not ready."
        return
    }
    try {
        if (-not (Test-Path -LiteralPath $path)) { [void](New-Item -Path $path -Force) }
        $key = Get-Item -LiteralPath $path
        $index = 1
        while ($key.GetValueNames() -contains [string]$index) { $index++ }
        # No -Force: never overwrite another entry, even if a policy refresh races setup.
        [void](New-ItemProperty -LiteralPath $path -Name ([string]$index) -PropertyType String -Value $exact)
        if (-not (Test-ExactEdgePolicyOrigin $path $exact)) { throw 'Registry readback did not contain the exact REG_SZ origin.' }
        $script:EdgePolicyStates[$Policy] = $true
        $script:EdgePolicyChanges.Add($Policy)
        Write-SetupLog "Edge machine policy ${Policy}: added only exact origin $exact as REG_SZ; unrelated values preserved."
    } catch {
        Add-Action "Could not configure Edge policy $Policy at HKLM\SOFTWARE\Policies\Microsoft\Edge. Check administrator registry permissions and domain/MDM policy. Details: $($_.Exception.Message)"
    }
}
function Set-EdgeOriginPolicy([uri]$Origin, [version]$EdgeVersion, [bool]$Diagnose, [bool]$Managed, [string]$MachineRoot = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge', [string[]]$UserRoots = @(), [string]$Mode = 'Repair', [bool]$Interactive = ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected)) {
    $script:EdgePolicyStates = @{}
    $script:EdgePolicyChanges = New-Object 'System.Collections.Generic.List[string]'
    $policies = @(Get-RequiredEdgePolicies $EdgeVersion)
    if ($null -eq $EdgeVersion) { Add-Action 'Microsoft Edge version is unavailable or invalid. No browser policy was written.'; return }
    if ($EdgeVersion -lt [version]'77.0.0.0') { Add-Action "Microsoft Edge $EdgeVersion is unsupported for the insecure-origin policy (requires Edge 77 or later). No browser policy was written."; return }

    $blocked = $false
    foreach ($root in @($MachineRoot) + $UserRoots) {
        foreach ($policy in @('LocalNetworkBlockedForUrls', 'LoopbackNetworkBlockedForUrls', 'LocalNetworkAccessBlockedForUrls')) {
            foreach ($pattern in @(Get-PolicyValues (Join-Path $root $policy))) {
                if (Test-PolicyPattern $pattern $Origin) { Add-Action "Higher-priority Edge blocking policy $policy at $root matches or may match RISpro. Ask the policy administrator; no blocking policies were changed."; $blocked = $true }
            }
        }
    }
    if ($blocked) { foreach ($policy in $policies) { $script:EdgePolicyStates[$policy] = $false }; return }
    foreach ($policy in $policies) {
        $requiresApproval = $policy -eq 'OverrideSecurityRestrictionsOnInsecureOrigin'
        Set-EdgePolicyOrigin $policy $Origin $Diagnose $Managed $requiresApproval ($Mode -ne 'HostRepair') $Interactive $MachineRoot
    }
    if ($script:EdgePolicyChanges.Count -gt 0) {
        Add-Action ('New Edge policy entries were installed: ' + ($script:EdgePolicyChanges -join ', ') + '. Close and reopen Edge; a policy reload alone does not activate the insecure-origin exception. Then verify the effective origin and policies in edge://policy.')
    }
}
function Get-EsclEndpoint([string[]]$Candidates, [string]$Origin) {
    # 50 asynchronous probes share one bounded deadline. No physical scan is started.
    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $handler.UseProxy = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(4)
    $client.DefaultRequestHeaders.Add('Origin', $Origin)
    try {
        $pending = @($Candidates | ForEach-Object { [pscustomobject]@{ Endpoint = $_; Task = $client.GetAsync($_ + '/eSCL/ScannerCapabilities') } })
        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        while (@($pending | Where-Object { -not $_.Task.IsCompleted }).Count -gt 0 -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
        $found = @()
        foreach ($probe in $pending) {
            if (-not $probe.Task.IsCompleted -or $probe.Task.IsFaulted -or $probe.Task.IsCanceled) { continue }
            $response = $probe.Task.Result
            try {
                if (-not $response.IsSuccessStatusCode) { continue }
                $text = $response.Content.ReadAsStringAsync().Result
                if ($text.Length -gt 1048576) { continue }
                $settings = New-Object System.Xml.XmlReaderSettings
                $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
                $settings.XmlResolver = $null
                $reader = [System.Xml.XmlReader]::Create((New-Object IO.StringReader($text)), $settings)
                try { $xml = New-Object Xml.XmlDocument; $xml.XmlResolver = $null; $xml.Load($reader) } catch { continue } finally { $reader.Dispose() }
                if ($xml.DocumentElement.LocalName -ne 'ScannerCapabilities' -or $xml.DocumentElement.NamespaceURI -ne 'http://schemas.hp.com/imaging/escl/2011/05/03') { continue }
                $formats = @($xml.SelectNodes('//*[local-name()="DocumentFormat" or local-name()="DocumentFormatExt"]') | ForEach-Object { $_.InnerText })
                if ($formats -notcontains 'application/pdf' -and $formats -notcontains 'image/jpeg') { continue }
                $cors = @()
                if ($response.Headers.Contains('Access-Control-Allow-Origin')) { $cors = @($response.Headers.GetValues('Access-Control-Allow-Origin')) }
                $found += [pscustomobject]@{ Endpoint = $probe.Endpoint; Cors = ($cors -contains '*' -or $cors -contains $Origin) }
            } finally { $response.Dispose() }
        }
        return $found
    } finally { $client.CancelPendingRequests(); $client.Dispose(); $handler.Dispose() }
}
function Set-ScannerHostFirewall([uri]$Endpoint, [string[]]$Sources, [bool]$Diagnose) {
    if ($Endpoint.IsLoopback -or $Endpoint.HostNameType -ne 'IPv4') { throw 'HostRepair requires an explicitly configured scanner-host LAN IPv4 endpoint. Loopback setup never creates an inbound firewall rule.' }
    if ($Sources.Count -eq 0) { throw 'HostRepair requires approved scanner client addresses saved in RISpro Settings > Documents & Uploads > Advanced shared scanner settings. No unrestricted inbound rule will be created.' }
    foreach ($source in $Sources) {
        if ($source -notmatch '^(\d{1,3}\.){3}\d{1,3}(?:/(?:1[6-9]|2\d|3[0-2]))?$') { throw 'Firewall sources must be approved IPv4 addresses or restricted /16-/32 CIDRs; no broad access is allowed.' }
        $ip = $null
        if (-not [Net.IPAddress]::TryParse(($source -split '/')[0], [ref]$ip) -or $ip.ToString() -eq '0.0.0.0' -or $ip.GetAddressBytes()[0] -ge 224) { throw 'Invalid approved firewall source address.' }
    }
    if (@(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -eq $Endpoint.Host }).Count -eq 0) { throw 'HostRepair must run on the configured scanner host IP, not on a scanner client. No firewall rule created.' }
    $name = 'RISpro-NAPS2-TCP-' + $Endpoint.Port
    $existing = @(Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue)
    if ($existing.Count -gt 0) {
        $port = @($existing | Get-NetFirewallPortFilter)
        $addresses = @($existing | Get-NetFirewallAddressFilter | ForEach-Object { $_.RemoteAddress })
        if ($existing.Count -ne 1 -or $existing[0].Direction -ne 'Inbound' -or $existing[0].Action -ne 'Allow' -or $existing[0].Enabled -ne 'True' -or [string]$existing[0].Profile -ne 'Domain, Private' -or $port[0].Protocol -ne 'TCP' -or [string]$port[0].LocalPort -ne [string]$Endpoint.Port -or (Compare-Object ($Sources | Sort-Object) ($addresses | Sort-Object))) { throw "Existing firewall rule $name differs from approved configuration. Preserved unchanged; ask the firewall administrator." }
        Write-SetupLog "Scanner-host firewall: existing restricted rule $name verified."
        return
    }
    if ($Diagnose) { Add-Action "Scanner host needs a restricted inbound TCP rule on port $($Endpoint.Port) for approved sources."; return }
    [void](New-NetFirewallRule -Name $name -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Endpoint.Port -RemoteAddress $Sources -Profile Domain,Private)
    Write-SetupLog "Scanner-host firewall: added restricted TCP port $($Endpoint.Port) for $($Sources -join ', '). Existing firewall policies were preserved."
}
function Get-SetupReadinessMessages([string]$Naps2State, [bool]$HttpReady, [bool]$PoliciesConfigured, [bool]$RestartRequired, [string]$RestartDetails) {
    $restartState = if ($RestartRequired) { "restart Edge is required after new policy entries ($RestartDetails); then inspect edge://policy." }
        elseif ($PoliciesConfigured) { 'No new Edge policy entries this run; no additional restart is requested. Confirm effective settings in edge://policy.' }
        else { 'pending required policy configuration; see Action required.' }
    return @(
        "READINESS 1/6 - NAPS2 installed and configuration valid: $Naps2State"
        "READINESS 2/6 - NAPS2 HTTP capabilities and CORS responding: $HttpReady"
        "READINESS 3/6 - Applicable Edge registry policies configured: $PoliciesConfigured"
        "READINESS 4/6 - Edge restart/policy verification: $restartState"
        'READINESS 5/6 - RISpro browser Test Connection: not run by setup; required after Edge policy verification.'
        'READINESS 6/6 - Physical Test Scan: not run by setup; required in RISpro. Setup does not claim physical scanning success.'
    )
}
function Invoke-Naps2Setup {
    if ($Mode -notin @('Repair', 'Diagnose', 'HostRepair')) { throw 'Usage: RISpro-NAPS2-Setup.cmd [Repair|Diagnose|HostRepair]' }
    $os = Get-CimInstance Win32_OperatingSystem
    if ($os.ProductType -ne 1 -or [version]$os.Version -lt [version]'10.0' -or [version]$os.Version -ge [version]'11.0') { throw 'Windows 10 or Windows 11 workstation is required.' }
    if (-not (Test-Administrator)) {
        Write-Host 'Requesting administrator elevation for workstation setup...'
        $child = Start-Process -FilePath $env:RISPRO_NAPS2_SETUP_FILE -ArgumentList $Mode -Verb RunAs -Wait -PassThru
        exit $child.ExitCode
    }
    $directory = Join-Path $env:ProgramData 'RISpro\NAPS2Setup'
    [void](New-Item -ItemType Directory -Path $directory -Force)
    $script:LogFile = Join-Path $directory ('setup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.log')
    Write-SetupLog "RISpro NAPS2 setup: $Mode; $($os.Caption)"
    $config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__RISPRO_NAPS2_CONFIG_BASE64__')) | ConvertFrom-Json
    $origin = [uri]$config.origin
    if ($origin.Scheme -ne 'http' -or $origin.HostNameType -ne 'IPv4' -or $origin.UserInfo -or $origin.AbsolutePath -ne '/' -or $origin.Query -or $origin.Fragment) { throw 'Invalid embedded RISpro HTTP origin. Download a new setup from the configured RISpro server.' }
    $diagnose = $Mode -eq 'Diagnose'
    $endpoint = [string]$config.endpoint
    $remote = $endpoint -and ([uri]$endpoint).Host -notin @('127.0.0.1', 'localhost')
    if (-not $remote -or $Mode -eq 'HostRepair') {
        $candidates = @()
        foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramW6432, (Join-Path $env:LOCALAPPDATA 'Programs'))) { if ($root) { $candidates += Join-Path $root 'NAPS2' } }
        foreach ($process in @(Get-Process NAPS2 -ErrorAction SilentlyContinue)) { if ($process.Path) { $candidates += Split-Path $process.Path } }
        foreach ($root in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
            foreach ($key in @(Get-ChildItem $root -ErrorAction SilentlyContinue)) {
                if ([string]$key.GetValue('DisplayName') -like 'NAPS2*') { $candidates += [string]$key.GetValue('InstallLocation') }
            }
        }
        $path = Find-Naps2Installation $candidates
        Write-SetupLog "NAPS2 installed: yes. Configuration: $path"
        $version = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path (Split-Path $path) 'NAPS2.exe')).FileVersion
        Write-SetupLog "NAPS2 version: $version"
        Assert-Naps2Version $version
        $script:Naps2ConfigurationValid = Set-Naps2Xml $path $diagnose
    } else { Write-SetupLog 'Role: scanner client. NAPS2 installation/XML and inbound firewall are managed on the remote scanner host.' }
    $machine = Get-CimInstance Win32_ComputerSystem
    $managed = $machine.PartOfDomain -or @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Provisioning\OMADM\Accounts' -ErrorAction SilentlyContinue).Count -gt 0
    $userRoots = @('HKCU:\SOFTWARE\Policies\Microsoft\Edge') + @(Get-ChildItem Registry::HKEY_USERS -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^S-1-5-21-(\d+-){3}\d+$' } | ForEach-Object { 'Registry::' + $_.Name + '\SOFTWARE\Policies\Microsoft\Edge' } | Select-Object -Unique)
    $edgeCandidates = @()
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramW6432)) { if ($root) { $edgeCandidates += Join-Path $root 'Microsoft\Edge\Application\msedge.exe' } }
    if ($env:LOCALAPPDATA) { $edgeCandidates += Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe' }
    $edge = Find-EdgeExecutable $edgeCandidates
    $edgeVersion = $null
    if (-not $edge) { Add-Action 'Microsoft Edge installation was not found in supported machine or per-user installation paths. No browser policy was written.' }
    else {
        $edgeProductVersion = ''
        try { $edgeProductVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($edge).ProductVersion } catch { }
        $edgeVersion = ConvertTo-EdgeVersion $edgeProductVersion
        if ($null -eq $edgeVersion) {
            Write-SetupLog "Microsoft Edge executable: $edge; unrecognized ProductVersion: '$edgeProductVersion'"
            Add-Action 'The installed Microsoft Edge ProductVersion could not be parsed as a four-part Windows version. No browser policy was written.'
        } else {
            Write-SetupLog "Microsoft Edge version detected from msedge.exe: $edgeVersion (ProductVersion $edgeProductVersion)"
            if ($edgeVersion -lt [version]'77.0.0.0') {
                Add-Action "Microsoft Edge $edgeVersion is unsupported for the insecure-origin policy (requires Edge 77 or later). No browser policy was written. Ask the administrator to update Edge."
            } else { Set-EdgeOriginPolicy $origin $edgeVersion $diagnose $managed 'HKLM:\SOFTWARE\Policies\Microsoft\Edge' $userRoots $Mode ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) }
        }
    }
    $candidates = if ($endpoint) { @($endpoint) } else { @(9801..9850 | ForEach-Object { 'http://127.0.0.1:' + $_ }) }
    $found = @(Get-EsclEndpoint $candidates $origin.GetLeftPart([UriPartial]::Authority))
    $httpReady = $found.Count -eq 1 -and [bool]$found[0].Cors
    Write-SetupLog "Scanner Sharing active / compatible HTTP endpoint count: $($found.Count)"
    foreach ($scanner in $found) { Write-SetupLog "HTTP endpoint responds: $($scanner.Endpoint); browser-origin CORS: $($scanner.Cors)" }
    if ($found.Count -eq 0) { Add-Action 'No compatible HTTP scanner responded. Enable Scanner Sharing, keep NAPS2 running with background sharing enabled, check device/network/port. If XML was repaired, exit and reopen NAPS2 after all scans finish, then rerun setup.' }
    elseif ($found.Count -gt 1) { Add-Action 'Multiple local shared scanners respond. Select the intended exact endpoint in RISpro Workstation Setup advanced override.' }
    elseif (-not $found[0].Cors) { Add-Action 'HTTP responds but CORS does not allow RISpro. Exit and reopen NAPS2 after all scans finish to load appsettings.xml, then rerun setup. Setup never stops an active scan.' }
    if ($Mode -eq 'HostRepair' -and $found.Count -eq 1) { Set-ScannerHostFirewall ([uri]$found[0].Endpoint) @($config.sources) $diagnose }
    else { Write-SetupLog 'Inbound firewall: unchanged. Loopback scanners and scanner clients need no inbound exception.' }
    $naps2State = if ($remote -and $Mode -ne 'HostRepair') { 'not checked on this scanner client; NAPS2 is on the remote scanner host' } else { [string]$script:Naps2ConfigurationValid }
    $policyConfigured = $script:EdgePolicyStates.Count -gt 0 -and @($script:EdgePolicyStates.Values | Where-Object { -not $_ }).Count -eq 0
    foreach ($readiness in (Get-SetupReadinessMessages $naps2State $httpReady $policyConfigured ($script:EdgePolicyChanges.Count -gt 0) ($script:EdgePolicyChanges -join ', '))) { Write-SetupLog $readiness }
    if ($script:Issues.Count -gt 0) { Write-SetupLog ('RESULT: Action required - ' + ($script:Issues -join ' | ')); return 2 }
    Write-SetupLog 'RESULT: Setup ready — browser verification required. NAPS2 configuration, exact applicable Edge registry policies and HTTP capabilities/CORS were checked. Confirm effective policy in edge://policy, then run Test Connection and Test Scan in RISpro.'
    return 0
}

if ($env:RISPRO_NAPS2_TEST -ne '1') {
    try { exit (Invoke-Naps2Setup) }
    catch { Write-SetupLog ('RESULT: Failed - ' + $_.Exception.Message + ' Check administrator permissions and the setup log. No software was installed; no NAPS2 process was terminated.'); exit 1 }
}

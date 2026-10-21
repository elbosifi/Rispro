param([string]$SetupFile = (Join-Path $PSScriptRoot 'windows/RISpro-NAPS2-Setup.cmd'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = [IO.File]::ReadAllText($SetupFile)
$marker = [regex]::Match($source, '(?m)^# RISPRO_NAPS2_POWERSHELL\r?$')
if (-not $marker.Success) { throw 'Missing self-contained payload marker.' }
$payload = $source.Substring($marker.Index + $marker.Length)
$tokens = $null; $errors = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($payload, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$env:RISPRO_NAPS2_TEST = '1'
. ([scriptblock]::Create($payload))
$temp = Join-Path ([IO.Path]::GetTempPath()) ('rispro-naps2-tests-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $temp)
$script:Passed = 0
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Check([string]$Name, [scriptblock]$Body) { & $Body; $script:Passed++; Write-Host "PASS: $Name" }
function Expect-Failure([scriptblock]$Body, [string]$Pattern) {
    try { & $Body } catch { Assert ($_.Exception.Message -match $Pattern) "Wrong diagnostic: $($_.Exception.Message)"; return }
    throw "Expected failure: $Pattern"
}
try {
    Check 'missing installation and missing appsettings diagnostics' {
        Expect-Failure { Find-Naps2Installation @($temp) } 'not installed'
        [IO.File]::WriteAllText((Join-Path $temp 'NAPS2.exe'), '')
        Expect-Failure { Find-Naps2Installation @($temp) } 'no appsettings.xml'
    }
    Check 'unsupported NAPS2 versions are rejected before editing XML' {
        Expect-Failure { Assert-Naps2Version '7.5.1.0' } 'requires 7.5.2'
        Expect-Failure { Assert-Naps2Version '' } 'cannot be verified'
        Assert-Naps2Version '7.5.2.0'
        Assert-Naps2Version '8.2.1.0'
    }
    $xmlPath = Join-Path $temp 'appsettings.xml'
    Check 'duplicate discovery paths use Windows case-insensitive normalized comparison' {
        $programFilesCandidate = 'C:\Program Files\NAPS2'
        $registryCandidate = 'c:\program files\naps2\'
        $processCandidate = 'C:\PROGRAM FILES\NAPS2\\'
        $normalized = @(Get-NormalizedNaps2InstallationPaths @($programFilesCandidate, $registryCandidate, $processCandidate))
        Assert ($normalized.Count -eq 1) 'Equivalent Windows NAPS2 paths were counted as separate installations'
        Assert ($normalized[0] -eq 'C:\Program Files\NAPS2') 'Installation path was not normalized'

        [IO.File]::WriteAllText($xmlPath, '<AppConfig/>')
        $sameInstallation = Find-Naps2Installation @($temp, ($temp.ToUpperInvariant() + [IO.Path]::DirectorySeparatorChar))
        Assert ($sameInstallation -eq $xmlPath) 'Equivalent discovery sources did not resolve to the same installation'
        $otherInstallation = Join-Path $temp 'other-naps2'
        [void](New-Item -ItemType Directory -Path $otherInstallation)
        [IO.File]::WriteAllText((Join-Path $otherInstallation 'NAPS2.exe'), '')
        [IO.File]::WriteAllText((Join-Path $otherInstallation 'appsettings.xml'), '<AppConfig/>')
        Expect-Failure { Find-Naps2Installation @($temp, $otherInstallation) } 'Multiple NAPS2 installations found'
    }
    Check 'XML backup, missing element, whitespace and unrelated settings preservation' {
        $original = "<?xml version=`"1.0`"?>`n<AppConfig><!--keep--><OcrTimeoutInSeconds>600</OcrTimeoutInSeconds><Other attr=`"a`">value</Other></AppConfig>"
        [IO.File]::WriteAllText($xmlPath, $original)
        Set-Naps2Xml $xmlPath $false
        $xml = Read-SafeXml $xmlPath
        Assert ($xml.AppConfig.EsclSecurityPolicy -eq 'ServerAllowAnyOrigin') 'Missing policy'
        Assert ($xml.AppConfig.Other.InnerText -eq 'value') 'Lost unrelated value'
        Assert ($xml.AppConfig.Other.GetAttribute('attr') -eq 'a') 'Lost attribute'
        Assert ($xml.OuterXml.Contains('<!--keep-->')) 'Lost comment'
        $backups = @(Get-ChildItem ($xmlPath + '.RISpro-*.bak'))
        Assert ($backups.Count -eq 1) 'Missing backup'
        Assert ([IO.File]::ReadAllText($backups[0].FullName) -eq $original) 'Backup does not match original bytes'
    }
    Check 'correct configuration and repeated repair produce no changes or duplicates' {
        $before = [IO.File]::ReadAllText($xmlPath)
        Set-Naps2Xml $xmlPath $false
        Set-Naps2Xml $xmlPath $false
        Assert ([IO.File]::ReadAllText($xmlPath) -eq $before) 'Idempotent repair changed XML'
        Assert (@(Get-ChildItem ($xmlPath + '.RISpro-*.bak')).Count -eq 1) 'Unnecessary backups'
    }
    Check 'identical duplicate values are repaired exactly once' {
        [IO.File]::WriteAllText($xmlPath, '<AppConfig><EsclSecurityPolicy>None</EsclSecurityPolicy><EsclSecurityPolicy>None</EsclSecurityPolicy></AppConfig>')
        Set-Naps2Xml $xmlPath $false
        Assert (@((Read-SafeXml $xmlPath).SelectNodes('/AppConfig/EsclSecurityPolicy')).Count -eq 1) 'Duplicate setting remained'
    }
    Check 'conflicting security settings and invalid XML are preserved' {
        foreach ($content in @('<AppConfig><EsclSecurityPolicy>RequireHttps</EsclSecurityPolicy></AppConfig>', '<AppConfig><EsclSecurityPolicy>None</EsclSecurityPolicy><EsclSecurityPolicy>ServerAllowAnyOrigin</EsclSecurityPolicy></AppConfig>', '<AppConfig><NoScannerSharing>true</NoScannerSharing></AppConfig>', '<WrongRoot/>', '<AppConfig>')) {
            [IO.File]::WriteAllText($xmlPath, $content)
            Expect-Failure { Set-Naps2Xml $xmlPath $false } 'Conflicting|disables|Invalid|Exception'
            Assert ([IO.File]::ReadAllText($xmlPath) -eq $content) 'Conflicting configuration was changed'
        }
    }
    Check 'diagnostics do not modify XML' {
        $content = '<AppConfig><EsclSecurityPolicy>None</EsclSecurityPolicy></AppConfig>'
        [IO.File]::WriteAllText($xmlPath, $content)
        Set-Naps2Xml $xmlPath $true
        Assert ([IO.File]::ReadAllText($xmlPath) -eq $content) 'Diagnose changed XML'
    }
    # Simulated registry: exercise real policy functions without touching Windows policy.
    $script:Registry = @{}
    $script:RegistryTypes = @{}
    $script:DenyWrite = $false
    $script:ConfirmationAnswer = 'YES'
    $script:ReadHostCalls = 0
    $policyRoot = Join-Path $temp 'Edge'
    function Reset-PolicyRegistry {
        $script:Registry = @{}
        $script:RegistryTypes = @{}
        $script:DenyWrite = $false
        $script:Issues.Clear()
        $script:ReadHostCalls = 0
    }
    function Test-Path([string]$LiteralPath, [string]$PathType = 'Any') {
        if ($script:Registry.ContainsKey($LiteralPath)) { return $true }
        Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType
    }
    function Get-PolicyValues([string]$Path) { if ($script:Registry.ContainsKey($Path)) { $script:Registry[$Path].Values } }
    function Get-Item([string]$LiteralPath) {
        if ($script:Registry.ContainsKey($LiteralPath)) {
            $item = [pscustomobject]@{ Entries = $script:Registry[$LiteralPath]; Kinds = $script:RegistryTypes[$LiteralPath] }
            $item | Add-Member ScriptMethod GetValueNames { @($this.Entries.Keys) }
            $item | Add-Member ScriptMethod GetValue { param($Name) $this.Entries[$Name] }
            $item | Add-Member ScriptMethod GetValueKind { param($Name) $this.Kinds[$Name] }
            return $item
        }
        Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath
    }
    function New-Item([string]$Path, [switch]$Force) {
        if ($script:DenyWrite) { throw 'Registry permission denied by enterprise policy' }
        if (-not $script:Registry.ContainsKey($Path)) { $script:Registry[$Path] = @{}; $script:RegistryTypes[$Path] = @{} }
        return [pscustomobject]@{ Path = $Path }
    }
    function New-ItemProperty([string]$LiteralPath, [string]$Name, [string]$PropertyType, [string]$Value) {
        if ($script:DenyWrite) { throw 'Registry permission denied by enterprise policy' }
        if (-not $script:Registry.ContainsKey($LiteralPath)) { throw 'Policy key does not exist' }
        if ($script:Registry[$LiteralPath].ContainsKey($Name)) { throw 'Attempted to overwrite existing policy' }
        $script:Registry[$LiteralPath][$Name] = $Value
        $script:RegistryTypes[$LiteralPath][$Name] = if ($PropertyType -eq 'String') { [Microsoft.Win32.RegistryValueKind]::String } else { $PropertyType }
    }
    function Read-Host([string]$Prompt) { $script:ReadHostCalls++; return $script:ConfirmationAnswer }
    $script:PolicyMachineRoot = $policyRoot
    $script:PolicyOrigin = [uri]'http://192.9.101.30:8080'
    $script:PolicyExact = 'http://192.9.101.30:8080'

    Check 'Edge four-part version parsing and missing executable fail safely' {
        Assert ((ConvertTo-EdgeVersion '146.0.3124.51') -eq [version]'146.0.3124.51') 'Valid Edge version was not parsed'
        foreach ($invalid in @('', '146.0.3124', '146.0.3124.51-beta', 'unknown', '999999999999.0.0.0')) { Assert ($null -eq (ConvertTo-EdgeVersion $invalid)) "Invalid Edge version accepted: $invalid" }
        Assert ($null -eq (Find-EdgeExecutable @((Join-Path $temp 'missing-msedge.exe')))) 'Missing Edge executable was accepted'
    }
    Check 'Edge version matrix writes only supported exact-origin policies' {
        $matrix = @(
            @{ Version = '76.0.0.0'; Policies = @() },
            @{ Version = '77.0.0.0'; Policies = @('OverrideSecurityRestrictionsOnInsecureOrigin') },
            @{ Version = '139.0.0.0'; Policies = @('OverrideSecurityRestrictionsOnInsecureOrigin') },
            @{ Version = '140.0.0.0'; Policies = @('OverrideSecurityRestrictionsOnInsecureOrigin', 'LocalNetworkAccessAllowedForUrls') },
            @{ Version = '145.0.0.0'; Policies = @('OverrideSecurityRestrictionsOnInsecureOrigin', 'LocalNetworkAccessAllowedForUrls') },
            @{ Version = '146.0.0.0'; Policies = @('OverrideSecurityRestrictionsOnInsecureOrigin', 'LocalNetworkAccessAllowedForUrls', 'LoopbackNetworkAllowedForUrls') },
            @{ Version = '151.2.3.4'; Policies = @('OverrideSecurityRestrictionsOnInsecureOrigin', 'LocalNetworkAccessAllowedForUrls', 'LoopbackNetworkAllowedForUrls') }
        )
        foreach ($case in $matrix) {
            Reset-PolicyRegistry
            $version = ConvertTo-EdgeVersion $case.Version
            Set-EdgeOriginPolicy $script:PolicyOrigin $version $false $false $script:PolicyMachineRoot @() 'Repair' $true
            $actual = @($script:Registry.Keys | Where-Object { $_ -match '\\(OverrideSecurityRestrictionsOnInsecureOrigin|LocalNetworkAccessAllowedForUrls|LoopbackNetworkAllowedForUrls)$' } | ForEach-Object { Split-Path $_ -Leaf })
            Assert (@(Compare-Object @($case.Policies | Sort-Object) @($actual | Sort-Object)).Count -eq 0) "Wrong policy set for Edge $($case.Version): $($actual -join ', ')"
            foreach ($policy in $case.Policies) {
                $path = Join-Path $script:PolicyMachineRoot $policy
                Assert (@($script:Registry[$path].Values) -contains $script:PolicyExact) "Edge $($case.Version) policy $policy did not use exact origin and port"
                Assert (@($script:RegistryTypes[$path].Values | Where-Object { $_ -ne [Microsoft.Win32.RegistryValueKind]::String }).Count -eq 0) "Edge $($case.Version) policy $policy was not REG_SZ"
            }
            if ($version -lt [version]'77.0.0.0') { Assert ($script:Issues -match 'unsupported') 'Edge 76 did not report unsupported version' }
        }
    }
    Check 'exact policy entry preserves unrelated values, uses next free slot and is idempotent' {
        Reset-PolicyRegistry
        $path = Join-Path $script:PolicyMachineRoot 'LocalNetworkAccessAllowedForUrls'
        $script:Registry[$path] = @{ '1' = 'https://existing.example:443'; '3' = 'http://192.9.101.30:8081' }
        $script:RegistryTypes[$path] = @{ '1' = [Microsoft.Win32.RegistryValueKind]::String; '3' = [Microsoft.Win32.RegistryValueKind]::String }
        Set-EdgePolicyOrigin 'LocalNetworkAccessAllowedForUrls' $script:PolicyOrigin $false $false $false $true $true $script:PolicyMachineRoot
        Assert ($script:Registry[$path]['1'] -eq 'https://existing.example:443') 'Existing policy overwritten'
        Assert ($script:Registry[$path]['3'] -eq 'http://192.9.101.30:8081') 'Other port overwritten'
        Assert ($script:Registry[$path]['2'] -eq $script:PolicyExact) 'Exact origin not added in the next free numeric slot'
        Assert ($script:RegistryTypes[$path]['2'] -eq [Microsoft.Win32.RegistryValueKind]::String) 'New value was not REG_SZ'
        $before = $script:Registry[$path].Count
        Set-EdgePolicyOrigin 'LocalNetworkAccessAllowedForUrls' $script:PolicyOrigin $false $false $false $true $true $script:PolicyMachineRoot
        Assert ($script:Registry[$path].Count -eq $before) 'Repeated policy repair created a duplicate'
    }
    Check 'already configured insecure-origin policy does not prompt again' {
        Reset-PolicyRegistry
        $path = Join-Path $script:PolicyMachineRoot 'OverrideSecurityRestrictionsOnInsecureOrigin'
        $script:Registry[$path] = @{ '4' = $script:PolicyExact }
        $script:RegistryTypes[$path] = @{ '4' = [Microsoft.Win32.RegistryValueKind]::String }
        Set-EdgePolicyOrigin 'OverrideSecurityRestrictionsOnInsecureOrigin' $script:PolicyOrigin $false $false $true $true $true $script:PolicyMachineRoot
        Assert ($script:ReadHostCalls -eq 0) 'Already configured policy prompted for approval'
        Assert ($script:Issues.Count -eq 0) 'Correct existing exception was reported as missing'
    }
    Check 'declined or noninteractive insecure-origin approval never writes the policy' {
        foreach ($case in @(@{ Answer = 'NO'; Interactive = $true }, @{ Answer = 'YES'; Interactive = $false })) {
            Reset-PolicyRegistry
            $script:ConfirmationAnswer = $case.Answer
            Set-EdgePolicyOrigin 'OverrideSecurityRestrictionsOnInsecureOrigin' $script:PolicyOrigin $false $false $true $true $case.Interactive $script:PolicyMachineRoot
            $path = Join-Path $script:PolicyMachineRoot 'OverrideSecurityRestrictionsOnInsecureOrigin'
            Assert (-not $script:Registry.ContainsKey($path)) 'Policy was written without affirmative interactive approval'
            Assert ($script:Issues -match 'approval.*declined or unavailable') 'Missing Action required diagnostic'
            if (-not $case.Interactive) { Assert ($script:ReadHostCalls -eq 0) 'Noninteractive run attempted to read confirmation' }
        }
        $script:ConfirmationAnswer = 'YES'
    }
    Check 'missing registry permissions produce an actionable diagnostic' {
        Reset-PolicyRegistry
        $script:DenyWrite = $true
        Set-EdgePolicyOrigin 'LocalNetworkAccessAllowedForUrls' $script:PolicyOrigin $false $false $false $true $true $script:PolicyMachineRoot
        Assert ($script:Issues -match 'Could not configure Edge policy LocalNetworkAccessAllowedForUrls.*permissions') 'Missing registry permission diagnostic'
        Assert ($script:Registry.Count -eq 0) 'Policy registry changed after permission denial'
    }
    Check 'managed devices and Diagnose do not write policies and name central requirements' {
        Reset-PolicyRegistry
        Set-EdgeOriginPolicy $script:PolicyOrigin ([version]'146.0.0.0') $false $true $script:PolicyMachineRoot @() 'Repair' $true
        Assert ($script:Registry.Count -eq 0) 'Managed machine registry was modified'
        foreach ($policy in @('OverrideSecurityRestrictionsOnInsecureOrigin', 'LocalNetworkAccessAllowedForUrls', 'LoopbackNetworkAllowedForUrls')) { Assert ($script:Issues -match [regex]::Escape($policy)) "Managed diagnostic omitted $policy" }
        Reset-PolicyRegistry
        Set-EdgeOriginPolicy $script:PolicyOrigin ([version]'146.0.0.0') $true $false $script:PolicyMachineRoot @() 'Diagnose' $true
        Assert ($script:Registry.Count -eq 0) 'Diagnose wrote policy registry values'
        foreach ($policy in @('OverrideSecurityRestrictionsOnInsecureOrigin', 'LocalNetworkAccessAllowedForUrls', 'LoopbackNetworkAllowedForUrls')) { Assert ($script:Issues -match [regex]::Escape($policy)) "Diagnose omitted required policy $policy" }
    }
    Check 'malformed or unknown Edge version and Edge 76 write no policies' {
        foreach ($version in @($null, (ConvertTo-EdgeVersion '146.0.3124'))) {
            Reset-PolicyRegistry
            Set-EdgeOriginPolicy $script:PolicyOrigin $version $false $false $script:PolicyMachineRoot @() 'Repair' $true
            Assert ($script:Registry.Count -eq 0) 'Unknown version wrote Edge policies'
        }
        Reset-PolicyRegistry
        Set-EdgeOriginPolicy $script:PolicyOrigin ([version]'76.0.0.0') $false $false $script:PolicyMachineRoot @() 'Repair' $true
        Assert ($script:Registry.Count -eq 0) 'Edge 76 wrote an insecure-origin policy'
    }
    Check 'user-level higher-priority blockers are reported and preserved' {
        Reset-PolicyRegistry
        Assert (Test-PolicyPattern 'http://192.9.101.30' $script:PolicyOrigin) 'A pattern with no port must match every port'
        Assert (-not (Test-PolicyPattern 'http://192.9.101.30:8081' $script:PolicyOrigin)) 'Wrong port matched'
        $userRoot = Join-Path $temp 'UserEdge'
        $blockPath = Join-Path $userRoot 'LoopbackNetworkBlockedForUrls'
        $script:Registry[$blockPath] = @{ '1' = '*' }
        $script:RegistryTypes[$blockPath] = @{ '1' = [Microsoft.Win32.RegistryValueKind]::String }
        Set-EdgeOriginPolicy $script:PolicyOrigin ([version]'146.0.0.0') $false $false $script:PolicyMachineRoot @($userRoot) 'Repair' $true
        Assert ($script:Issues -match 'Higher-priority.*LoopbackNetworkBlockedForUrls') 'Missing user-level blocking-policy diagnosis'
        Assert ($script:Registry.Keys -notmatch 'AllowedForUrls|OverrideSecurity') 'Wrote policy despite higher-priority blocker'
        Assert ($script:Registry[$blockPath]['1'] -eq '*') 'Blocking policy was modified'
    }
    Check 'HostRepair never silently adds the insecure-origin exception' {
        Reset-PolicyRegistry
        Set-EdgeOriginPolicy $script:PolicyOrigin ([version]'146.0.0.0') $false $false $script:PolicyMachineRoot @() 'HostRepair' $true
        $overridePath = Join-Path $script:PolicyMachineRoot 'OverrideSecurityRestrictionsOnInsecureOrigin'
        Assert (-not $script:Registry.ContainsKey($overridePath)) 'HostRepair added insecure-origin exception'
        Assert ($script:Issues -match 'HostRepair did not add.*OverrideSecurityRestrictionsOnInsecureOrigin') 'HostRepair omission was not reported'
        Assert ($script:ReadHostCalls -eq 0) 'HostRepair prompted for or approved the exception'
    }
    Check 'readiness reporting keeps HTTP response separate from browser and physical acceptance' {
        $messages = @(Get-SetupReadinessMessages 'True' $true $true $true 'OverrideSecurityRestrictionsOnInsecureOrigin')
        Assert ($messages[1] -match 'HTTP capabilities and CORS responding: True') 'Missing HTTP readiness state'
        Assert ($messages[3] -match 'restart Edge is required') 'New policy did not require restart'
        Assert ($messages[4] -match 'browser Test Connection: not run') 'HTTP success claimed browser Test Connection'
        Assert ($messages[5] -match 'Physical Test Scan: not run.*does not claim physical scanning success') 'HTTP success claimed physical scan success'
        $repeat = @(Get-SetupReadinessMessages 'True' $true $true $false '')
        Assert ($repeat[3] -match 'no additional restart is requested') 'Repeated complete Repair required another restart'
    }
    function Get-NetIPAddress { [pscustomobject]@{ IPAddress = '192.9.101.40' } }
    function Get-NetFirewallRule { @() }
    $script:Firewall = $null
    function New-NetFirewallRule { param($Name, $DisplayName, $Direction, $Action, $Protocol, $LocalPort, $RemoteAddress, $Profile) $script:Firewall = $PSBoundParameters }
    Check 'firewall refuses broad/default access and the scanner-client role' {
        Expect-Failure { Set-ScannerHostFirewall ([uri]'http://192.9.101.40:9828') @() $false } 'requires approved scanner client addresses'
        Expect-Failure { Set-ScannerHostFirewall ([uri]'http://192.9.101.40:9828') @('Any') $false } 'no broad access'
        Expect-Failure { Set-ScannerHostFirewall ([uri]'http://192.9.101.41:9828') @('192.9.101.12') $false } 'scanner host IP'
        Assert ($null -eq $script:Firewall) 'Unexpected firewall mutation'
    }
    Check 'scanner host uses only approved source addresses and actual TCP port' {
        Set-ScannerHostFirewall ([uri]'http://192.9.101.40:9828') @('192.9.101.12', '192.9.102.0/24') $false
        Assert ($script:Firewall.LocalPort -eq 9828 -and $script:Firewall.Protocol -eq 'TCP') 'Wrong port/protocol'
        Assert ($script:Firewall.RemoteAddress.Count -eq 2 -and $script:Firewall.RemoteAddress -notcontains 'Any') 'Broad firewall rule'
        Assert ($script:Firewall.Profile -notcontains 'Public') 'Public firewall rule'
    }
    Write-Host "PASS: $script:Passed setup tests. OS elevation, real registry/GPO, HTTP sharing and hardware require Windows acceptance."
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force
    Remove-Item Env:RISPRO_NAPS2_TEST -ErrorAction SilentlyContinue
}

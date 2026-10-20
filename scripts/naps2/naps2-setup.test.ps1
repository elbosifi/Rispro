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
    # Simulated registry: exercise the real policy function without changing host policies.
    $script:Registry = @{}
    $script:DenyWrite = $false
    $policyRoot = Join-Path $temp 'Edge'
    $script:PolicyPath = Join-Path $policyRoot 'LocalNetworkAccessAllowedForUrls'
    $script:Registry[$script:PolicyPath] = @{ '1' = 'https://existing.example:443'; '3' = 'http://192.9.101.30:8081' }
    function Get-PolicyValues([string]$Path) { if ($script:Registry.ContainsKey($Path)) { $script:Registry[$Path].Values } }
    function Get-Item([string]$LiteralPath) {
        if ($script:Registry.ContainsKey($LiteralPath)) {
            $item = [pscustomobject]@{ Entries = $script:Registry[$LiteralPath] }
            $item | Add-Member ScriptMethod GetValueNames { @($this.Entries.Keys) }
            return $item
        }
        Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath
    }
    function New-ItemProperty([string]$LiteralPath, [string]$Name, [string]$PropertyType, [string]$Value) {
        if ($script:DenyWrite) { throw 'Registry permission denied by enterprise policy' }
        if ($script:Registry[$LiteralPath].ContainsKey($Name)) { throw 'Attempted to overwrite existing policy' }
        $script:Registry[$LiteralPath][$Name] = $Value
    }
    Check 'exact HTTP origin with explicit port preserves all existing Edge entries' {
        Set-EdgeOriginPolicy ([uri]'http://192.9.101.30:8080') $false $false $policyRoot
        Assert ($script:Registry[$script:PolicyPath]['1'] -eq 'https://existing.example:443') 'Existing policy overwritten'
        Assert ($script:Registry[$script:PolicyPath]['3'] -eq 'http://192.9.101.30:8081') 'Other port overwritten'
        Assert ($script:Registry[$script:PolicyPath]['2'] -eq 'http://192.9.101.30:8080') 'Exact origin not added in unused slot'
        Set-EdgeOriginPolicy ([uri]'http://192.9.101.30:8080') $false $false $policyRoot
        Assert ($script:Registry[$script:PolicyPath].Count -eq 3) 'Duplicate policy added'
    }
    Check 'default HTTP port is restricted to :80, with no wildcard' {
        Set-EdgeOriginPolicy ([uri]'http://192.9.101.30') $false $false $policyRoot
        Assert ($script:Registry[$script:PolicyPath].Values -contains 'http://192.9.101.30:80') 'Default port missing'
    }
    Check 'higher-priority loopback blocking policy is reported and preserved' {
        Assert (Test-PolicyPattern 'http://192.9.101.30' ([uri]'http://192.9.101.30:8080')) 'A pattern with no port must match every port'
        Assert (-not (Test-PolicyPattern 'http://192.9.101.30:8081' ([uri]'http://192.9.101.30:8080'))) 'Wrong port matched'
        $blockPath = Join-Path $policyRoot 'LoopbackNetworkBlockedForUrls'
        $script:Registry[$blockPath] = @{ '1' = '*' }
        $count = $script:Registry[$script:PolicyPath].Count
        $script:Issues.Clear()
        Set-EdgeOriginPolicy ([uri]'http://192.9.101.31') $false $false $policyRoot
        Assert ($script:Issues[0] -match 'Higher-priority.*Loopback') 'Missing blocking-policy diagnosis'
        Assert ($script:Registry[$script:PolicyPath].Count -eq $count) 'Wrote policy despite blocker'
        $script:Registry.Remove($blockPath)
    }
    Check 'domain managed and diagnostic modes never write missing Edge policy' {
        $count = $script:Registry[$script:PolicyPath].Count
        Set-EdgeOriginPolicy ([uri]'http://192.9.101.31') $false $true $policyRoot
        Set-EdgeOriginPolicy ([uri]'http://192.9.101.31') $true $false $policyRoot
        Assert ($script:Registry[$script:PolicyPath].Count -eq $count) 'Changed managed/diagnostic policy'
    }
    Check 'registry permissions produce an actionable failure' {
        $script:DenyWrite = $true
        Expect-Failure { Set-EdgeOriginPolicy ([uri]'http://192.9.101.31') $false $false $policyRoot } 'permission denied'
        $script:DenyWrite = $false
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

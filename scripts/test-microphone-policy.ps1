# Exercise the downloadable setup script using an in-memory registry only.
$ErrorActionPreference = 'Stop'
$setup = Join-Path $PSScriptRoot '..\frontend\public\downloads\Repair-RISpro-Microphone-Windows.ps1'
$tokens = $null; $parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($setup, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw "Setup script has syntax errors: $parseErrors" }
$global:microphonePolicyRegistry = @{}
$global:microphonePolicyWrites = 0
$script:assertions = 0
$edge = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\OverrideSecurityRestrictionsOnInsecureOrigin'
$chrome = 'HKLM:\SOFTWARE\Policies\Google\Chrome\UnsafelyTreatInsecureOriginAsSecure'
$origin = 'http://192.9.101.252:3000'
function Assert($condition, $message) {
    if (-not $condition) { throw $message }
    $script:assertions++
}
# These mocks shadow cmdlets only inside this test process. No registry provider is used.
function New-Object($TypeName, $ArgumentList) {
    if ($TypeName -ne 'Security.Principal.WindowsPrincipal') { throw "Unexpected type: $TypeName" }
    $principal = [pscustomobject]@{}
    $principal | Add-Member ScriptMethod IsInRole { param($role) return $true }
    return $principal
}
function Test-Path($LiteralPath) { return $global:microphonePolicyRegistry.ContainsKey($LiteralPath) }
function New-Item($Path, [switch]$Force) {
    if ($Path -notin @($edge, $chrome)) { throw "Unexpected policy write: $Path" }
    $global:microphonePolicyRegistry[$Path] = @{}; $global:microphonePolicyWrites++
}
function Get-ItemProperty($LiteralPath) { return [pscustomobject]$global:microphonePolicyRegistry[$LiteralPath] }
function New-ItemProperty($LiteralPath, $Name, $Value, $PropertyType, [switch]$Force) {
    if ($LiteralPath -notin @($edge, $chrome) -or $Value -ne $origin -or $PropertyType -ne 'String') { throw 'Unexpected policy value' }
    $global:microphonePolicyRegistry[$LiteralPath][$Name] = $Value; $global:microphonePolicyWrites++
}
function Remove-ItemProperty($LiteralPath, $Name) {
    $global:microphonePolicyRegistry[$LiteralPath].Remove($Name); $global:microphonePolicyWrites++
}
function Get-Item($LiteralPath) {
    $item = [pscustomobject]@{}
    $item | Add-Member ScriptMethod GetValueKind { param($name) return [Microsoft.Win32.RegistryValueKind]::String }
    return $item
}
$global:microphonePolicyRegistry[$edge] = @{ '1' = 'http://other.example/'; '2' = "$origin/"; '3' = $origin }
& $setup
Assert ($global:microphonePolicyRegistry[$edge]['1'] -eq 'http://other.example/') 'Changed another origin'
Assert ($global:microphonePolicyRegistry[$edge].Count -eq 2) 'Did not collapse RISpro duplicates'
Assert ($global:microphonePolicyRegistry[$edge]['2'] -eq $origin) 'Did not normalize the Edge origin'
Assert ($global:microphonePolicyRegistry[$chrome]['1'] -eq $origin) 'Chrome policy was not installed'
& $setup
Assert ($global:microphonePolicyRegistry[$edge].Count -eq 2 -and $global:microphonePolicyRegistry[$chrome].Count -eq 1) 'Setup is not idempotent'
$before = $global:microphonePolicyWrites
& $setup -VerifyOnly
Assert ($global:microphonePolicyWrites -eq $before) 'VerifyOnly wrote registry values'
& $setup -Remove
Assert ($global:microphonePolicyRegistry[$edge].Count -eq 1 -and $global:microphonePolicyRegistry[$edge]['1'] -eq 'http://other.example/') 'Remove changed another origin'
Assert ($global:microphonePolicyRegistry[$chrome].Count -eq 0) 'Remove left the Chrome exception'
$failed = $false
try { & $setup -VerifyOnly } catch { $failed = $true }
Assert $failed 'VerifyOnly accepted a missing origin'
Write-Host "PASS: syntax and $script:assertions microphone policy assertions (mock registry only)."

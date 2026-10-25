# RISpro LAN microphone access for Edge and Chrome.
# Run as Administrator. Use -VerifyOnly to check without changes; -Remove to undo.
param([switch]$Remove, [switch]$VerifyOnly)

$ErrorActionPreference = 'Stop'
$Origin = 'http://192.9.101.252:3000'
$PreviousOrigin = "$Origin/"
if ($Remove -and $VerifyOnly) { throw 'Use either -Remove or -VerifyOnly.' }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)

if (-not $VerifyOnly -and -not $principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)) {
    throw 'Start Windows PowerShell as Administrator, then rerun this script.'
}

$paths = [ordered]@{
    'Microsoft Edge' = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\OverrideSecurityRestrictionsOnInsecureOrigin'
    'Google Chrome' = 'HKLM:\SOFTWARE\Policies\Google\Chrome\UnsafelyTreatInsecureOriginAsSecure'
}

foreach ($browser in $paths.Keys) {
    $path = $paths[$browser]
    $policyName = Split-Path -Leaf $path

    if (-not (Test-Path -LiteralPath $path)) {
        if ($Remove -or $VerifyOnly) {
            Write-Host "$browser - no policy configured"
            if ($VerifyOnly) { throw "$browser - $policyName is missing. Run setup as Administrator." }
            continue
        }
        New-Item -Path $path -Force | Out-Null
    }

    $props = (Get-ItemProperty -LiteralPath $path).PSObject.Properties
    $entries = @($props | Where-Object { $_.Name -match '^\d+$' })

    $mine = @($entries | Where-Object {
        $_.Value -eq $Origin -or $_.Value -eq $PreviousOrigin
    })

    if ($VerifyOnly) {
        if ($mine.Count -eq 0) { throw "$browser - RISpro origin missing from $policyName" }
        foreach ($entry in $mine) {
            if ((Get-Item -LiteralPath $path).GetValueKind($entry.Name) -ne [Microsoft.Win32.RegistryValueKind]::String) {
                throw "$browser - RISpro policy entry must be REG_SZ"
            }
        }
        Write-Host "$browser - registry VERIFIED: $policyName = $Origin" -ForegroundColor Green
        continue
    }

    if ($Remove) {
        foreach ($entry in $mine) {
            Remove-ItemProperty -LiteralPath $path -Name $entry.Name
        }
        Write-Host "$browser - removed RISpro exception(s): $($mine.Count)"
        continue
    }

    if ($mine.Count -eq 0) {
        $used = @($entries | ForEach-Object { [int]$_.Name })
        $n = 1
        while ($used -contains $n) { $n++ }

        New-ItemProperty -LiteralPath $path `
            -Name ([string]$n) `
            -Value $Origin `
            -PropertyType String -Force | Out-Null
    } else {
        New-ItemProperty -LiteralPath $path `
            -Name $mine[0].Name -Value $Origin -PropertyType String -Force | Out-Null

        foreach ($duplicate in ($mine | Select-Object -Skip 1)) {
            Remove-ItemProperty -LiteralPath $path -Name $duplicate.Name
        }
    }

    $verified = @(
        (Get-ItemProperty -LiteralPath $path).PSObject.Properties |
        Where-Object {
            $_.Name -match '^\d+$' -and $_.Value -eq $Origin
        }
    )

    if ($verified.Count -ne 1 -or (Get-Item -LiteralPath $path).GetValueKind($verified[0].Name) -ne [Microsoft.Win32.RegistryValueKind]::String) {
        throw "$browser registry validation failed"
    }

    Write-Host "$browser - registry VERIFIED: $policyName = $Origin" -ForegroundColor Green
}

if ($Remove) {
    Write-Host 'RISpro microphone exceptions removed. Fully close and reopen Edge/Chrome to apply.'
    return
}

Write-Host ''
Write-Host 'Close all Chrome and Edge windows, then restart Windows.' -ForegroundColor Yellow
Write-Host "Open RISpro at http://192.9.101.252:3000"
Write-Host 'In edge://policy, check OverrideSecurityRestrictionsOnInsecureOrigin.'
Write-Host 'In chrome://policy, check UnsafelyTreatInsecureOriginAsSecure.'
Write-Host 'Click Reload policies; the RISpro entry must show status OK. Registry verification alone does not prove the browser accepted it.'
Write-Host 'Allow microphone permission when prompted.'
Write-Host 'Windows Settings > Privacy & security > Microphone must allow microphone access and desktop apps.'
Write-Host 'If browser policy shows an error or audio capture is blocked by your organization, contact your administrator. This script does not change those restrictions.'
Write-Host 'Open the top-bar settings arrow > Microphone Test, record, stop, and play back to verify actual capture.'
Write-Host ''
Write-Host 'This exception does not encrypt HTTP traffic.' -ForegroundColor Yellow

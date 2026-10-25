# RISpro LAN microphone access for Edge and Chrome.
# Run as Administrator. Use -Remove to undo.
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$Origin = 'http://192.9.101.252:3000/'
$PolicyName = 'OverrideSecurityRestrictionsOnInsecureOrigin'
$PreviousOrigin = 'http://192.9.101.252:3000'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)

if (-not $principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)) {
    throw 'Start Windows PowerShell as Administrator, then rerun this script.'
}

$paths = [ordered]@{
    'Microsoft Edge' = "HKLM:\SOFTWARE\Policies\Microsoft\Edge\$PolicyName"
    'Google Chrome' = "HKLM:\SOFTWARE\Policies\Google\Chrome\$PolicyName"
}

foreach ($browser in $paths.Keys) {
    $path = $paths[$browser]

    if (-not (Test-Path -LiteralPath $path)) {
        if ($Remove) {
            Write-Host "$browser - no policy configured"
            continue
        }
        New-Item -Path $path -Force | Out-Null
    }

    $props = (Get-ItemProperty -LiteralPath $path).PSObject.Properties
    $entries = @($props | Where-Object { $_.Name -match '^\d+$' })

    $mine = @($entries | Where-Object {
        $_.Value -eq $Origin -or $_.Value -eq $PreviousOrigin
    })

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
        Set-ItemProperty -LiteralPath $path `
            -Name $mine[0].Name -Value $Origin

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

    if ($verified.Count -ne 1) {
        throw "$browser registry validation failed"
    }

    Write-Host "$browser - registry VERIFIED: $Origin" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Close all Chrome and Edge windows, then restart Windows.' -ForegroundColor Yellow
Write-Host "Open RISpro at http://192.9.101.252:3000"
Write-Host "Check edge://policy or chrome://policy for $PolicyName"
Write-Host 'Allow microphone permission when prompted.'
Write-Host ''
Write-Host 'This exception does not encrypt HTTP traffic.' -ForegroundColor Yellow

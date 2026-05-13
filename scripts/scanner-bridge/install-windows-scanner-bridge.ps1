param(
  [string]$RisproOrigin = "http://192.9.101.252:3000",
  [string]$NodePath = "node",
  [string]$Naps2BaseUrl = "http://127.0.0.1:9801",
  [int]$Port = 9810
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeScript = Join-Path $scriptDir "rispro-scanner-bridge.mjs"
$installDir = Join-Path $env:ProgramData "RISpro\ScannerBridge"
$installedScript = Join-Path $installDir "rispro-scanner-bridge.mjs"
$startScript = Join-Path $installDir "start-rispro-scanner-bridge.ps1"
$taskName = "RISpro Scanner Bridge"

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Copy-Item -LiteralPath $bridgeScript -Destination $installedScript -Force

@"
`$env:RISPRO_ALLOWED_ORIGINS = "$RisproOrigin"
`$env:NAPS2_ESCL_BASE_URL = "$Naps2BaseUrl"
`$env:RISPRO_SCANNER_BRIDGE_PORT = "$Port"
& "$NodePath" "$installedScript"
"@ | Set-Content -LiteralPath $startScript -Encoding UTF8

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Installed $taskName."
Write-Host "Bridge: http://127.0.0.1:$Port/health"
Write-Host "NAPS2:  $Naps2BaseUrl/eSCL/ScannerCapabilities"
Write-Host "Allowed RISpro origin: $RisproOrigin"

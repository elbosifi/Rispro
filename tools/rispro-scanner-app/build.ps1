param(
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
dotnet restore "$root/RISpro.Scanner.sln"
dotnet build "$root/RISpro.Scanner.sln" -c $Configuration --no-restore
dotnet publish "$root/RISpro.Scanner.App/RISpro.Scanner.App.csproj" -c $Configuration -r win-x64 --self-contained false -o "$root/artifacts/app"

$publishDir = Join-Path $root "artifacts/app"
$requiredFiles = @(
  "RISpro.Scanner.App.exe",
  "RISpro.Scanner.App.dll",
  "RISpro.Scanner.Core.dll",
  "NAPS2.Sdk.dll",
  "NAPS2.Escl.dll",
  "NAPS2.Images.dll",
  "NAPS2.Images.Wpf.dll",
  "NAPS2.Internals.dll",
  "PdfSharpCore.dll",
  "NAPS2.Wia.dll",
  "NTwain.dll"
)

$missingFiles = @()
foreach ($fileName in $requiredFiles) {
  $filePath = Join-Path $publishDir $fileName
  if (-not (Test-Path $filePath)) {
    $missingFiles += $fileName
  }
}

if ($missingFiles.Count -gt 0) {
  throw "Scanner app publish output is missing required runtime file(s): $($missingFiles -join ', ')"
}

Write-Host "Scanner app publish output verified: required RISpro and NAPS2 runtime files are present."

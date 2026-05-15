param(
  [string]$Configuration = "Release",
  [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$root/build.ps1" -Configuration $Configuration
dotnet tool restore --tool-manifest "$root/.config/dotnet-tools.json"
dotnet tool run wix --project "$root/RISpro.Scanner.Installer/RISpro.Scanner.Installer.wixproj" -p:Configuration=$Configuration -p:ProductVersion=$Version

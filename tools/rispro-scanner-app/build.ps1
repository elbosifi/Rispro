param(
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
dotnet restore "$root/RISpro.Scanner.sln"
dotnet build "$root/RISpro.Scanner.sln" -c $Configuration --no-restore
dotnet publish "$root/RISpro.Scanner.App/RISpro.Scanner.App.csproj" -c $Configuration -r win-x64 --self-contained false -o "$root/artifacts/app"

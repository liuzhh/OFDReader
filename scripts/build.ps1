<#
.SYNOPSIS
    Builds OFD Reader on Windows from a plain PowerShell terminal.

.DESCRIPTION
    Locates a Visual Studio installation that ships the MSVC toolchain (via
    vswhere, so any edition, version or install path works), enters its developer
    environment to set up INCLUDE/LIB/link.exe, and then runs the Tauri CLI.

    By default only the executable is produced; pass -Bundle to also generate the
    MSI / NSIS installers.

.EXAMPLE
    pwsh -File scripts/build.ps1
    pwsh -File scripts/build.ps1 -Bundle
#>
[CmdletBinding()]
param(
    [switch]$Bundle
)

$ErrorActionPreference = "Continue"

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere)) {
    throw "vswhere.exe not found. Install Visual Studio or the Build Tools with the 'Desktop development with C++' workload: https://tauri.app/start/prerequisites/"
}

$vsPath = & $vswhere -latest -products * `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath

if (-not $vsPath) {
    throw "No Visual Studio installation with the MSVC C++ toolchain was found."
}

$devShell = Join-Path $vsPath "Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
if (-not (Test-Path -LiteralPath $devShell)) {
    throw "Microsoft.VisualStudio.DevShell.dll not found under '$vsPath'."
}
Write-Host "Visual Studio: $vsPath"

# Load the VS developer environment (sets INCLUDE / LIB for MSVC + Windows SDK).
Import-Module $devShell
Enter-VsDevShell -VsInstallPath $vsPath -SkipAutomaticLocation `
    -DevCmdArguments "-arch=x64 -host_arch=x64" | Out-Null

# DevShell omits the toolchain bin dir from PATH; resolve and prepend it.
$msvcRoot = Join-Path $vsPath "VC\Tools\MSVC"
$msvcVer = (Get-ChildItem -LiteralPath $msvcRoot -Directory | Sort-Object Name | Select-Object -Last 1).Name
$bin = Join-Path $msvcRoot "$msvcVer\bin\Hostx64\x64"
$env:PATH = "$bin;$env:PATH"

Write-Host "MSVC version: $msvcVer"
Write-Host "bin: $bin"
Write-Host "link.exe present: $(Test-Path (Join-Path $bin 'link.exe'))"

Push-Location (Join-Path $PSScriptRoot "..")
try {
    if ($Bundle) {
        Write-Host "== building (release, bundled) =="
        npx tauri build
    } else {
        Write-Host "== building (release, no bundle) =="
        npx tauri build --no-bundle
    }
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}

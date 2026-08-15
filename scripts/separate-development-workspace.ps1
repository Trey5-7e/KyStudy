[CmdletBinding()]
param(
    [switch]$ConfirmMove
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $ConfirmMove) {
    throw "This moves the existing KyStudy workspace to the Debug-only directory. Re-run with -ConfirmMove after closing KyStudy."
}

$appData = [Environment]::GetFolderPath("ApplicationData")
$source = Join-Path $appData "io.github.kystudy.desktop"
$destination = Join-Path $appData "io.github.kystudy.desktop-dev"

if (Get-Process -Name "kystudy" -ErrorAction SilentlyContinue) {
    throw "Close all KyStudy windows before moving the workspace."
}

if (-not (Test-Path -LiteralPath $source)) {
    throw "The shared workspace directory does not exist: $source"
}

if (Test-Path -LiteralPath $destination) {
    throw "The Debug workspace directory already exists; refusing to merge or overwrite it: $destination"
}

$resolvedAppData = [IO.Path]::GetFullPath($appData).TrimEnd([char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar))
$resolvedSource = [IO.Path]::GetFullPath($source)
$resolvedDestination = [IO.Path]::GetFullPath($destination)

if (-not $resolvedSource.StartsWith($resolvedAppData + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    -not $resolvedDestination.StartsWith($resolvedAppData + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to move a path outside the current user's ApplicationData directory."
}

Move-Item -LiteralPath $source -Destination $destination
Write-Host "Development workspace moved successfully."
Write-Host "Debug builds:   $destination"
Write-Host "Release builds: $source"

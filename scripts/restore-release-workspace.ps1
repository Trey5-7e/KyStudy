[CmdletBinding()]
param(
    [switch]$ConfirmMove
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $ConfirmMove) {
    throw "This restores the Debug workspace as the Release workspace. Re-run with -ConfirmMove after closing KyStudy."
}

$appData = [Environment]::GetFolderPath("ApplicationData")
$release = Join-Path $appData "io.github.kystudy.desktop"
$debug = Join-Path $appData "io.github.kystudy.desktop-dev"

if (Get-Process -Name "kystudy" -ErrorAction SilentlyContinue) {
    throw "Close all KyStudy windows before restoring the Release workspace."
}

$debugDatabase = Join-Path $debug "workspaces\default\kystudy.sqlite3"
if (-not (Test-Path -LiteralPath $debugDatabase)) {
    throw "The Debug workspace database was not found: $debugDatabase"
}

$resolvedAppData = [IO.Path]::GetFullPath($appData).TrimEnd([char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar))
$resolvedRelease = [IO.Path]::GetFullPath($release)
$resolvedDebug = [IO.Path]::GetFullPath($debug)

foreach ($path in @($resolvedRelease, $resolvedDebug)) {
    if (-not $path.StartsWith($resolvedAppData + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to move a path outside the current user's ApplicationData directory."
    }
}

$releaseBackup = Join-Path $appData ("io.github.kystudy.desktop-release-backup-" + [Guid]::NewGuid().ToString("N"))
if (Test-Path -LiteralPath $release) {
    Move-Item -LiteralPath $release -Destination $releaseBackup
}

try {
    Move-Item -LiteralPath $debug -Destination $release
} catch {
    if (Test-Path -LiteralPath $releaseBackup -and -not (Test-Path -LiteralPath $release)) {
        Move-Item -LiteralPath $releaseBackup -Destination $release
    }
    throw
}

Write-Host "Release workspace restored successfully."
Write-Host "Release workspace: $release"
Write-Host "Debug workspace is now empty until the next Debug run."
if (Test-Path -LiteralPath $releaseBackup) {
    Write-Host "Previous Release directory backup: $releaseBackup"
}

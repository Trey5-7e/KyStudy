[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,

    [Parameter(Mandatory = $true)]
    [string]$OutputArchive,

    [string]$Version = "0.1.2"
)

$ErrorActionPreference = "Stop"

$executable = (Resolve-Path -LiteralPath $ExecutablePath -ErrorAction Stop).Path
$archive = [IO.Path]::GetFullPath($OutputArchive)
$archiveDirectory = Split-Path -Parent $archive
$archiveName = [IO.Path]::GetFileNameWithoutExtension($archive)
$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) ("kystudy-portable-" + [Guid]::NewGuid().ToString("N"))
$stagingDirectory = Join-Path $stagingRoot $archiveName

if ([IO.Path]::GetExtension($archive) -ine ".zip") {
    throw "Portable release archive must use the .zip extension."
}

New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
try {
    Copy-Item -LiteralPath $executable -Destination (Join-Path $stagingDirectory "kystudy.exe")

    $portableDataDirectory = Join-Path $stagingDirectory "data"
    New-Item -ItemType Directory -Path $portableDataDirectory -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $portableDataDirectory ".kystudy-data-v1") `
        -Value "KyStudy user data directory v1" -Encoding UTF8

    $readme = @"
KyStudy $Version portable package

Run kystudy.exe to start KyStudy.
User data is stored in the data folder next to kystudy.exe. Keep the data folder with the executable when moving this package.
The data folder is user-owned content; back it up before replacing or deleting the portable package.
See the project README for backup, privacy, support, and license information.
Source code: https://github.com/Trey5-7e/KyStudy
License: GNU GPL v3.0-only (see LICENSE)
"@
    Set-Content -LiteralPath (Join-Path $stagingDirectory "README.txt") -Value $readme -Encoding UTF8

    $licensePath = Resolve-Path -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) "LICENSE") -ErrorAction Stop
    Copy-Item -LiteralPath $licensePath.Path -Destination (Join-Path $stagingDirectory "LICENSE")

    New-Item -ItemType Directory -Path $archiveDirectory -Force | Out-Null
    if (Test-Path -LiteralPath $archive) {
        Remove-Item -LiteralPath $archive -Force
    }
    Compress-Archive -Path (Join-Path $stagingDirectory "*") -DestinationPath $archive -CompressionLevel Optimal
}
finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
}

Write-Output $archive

[CmdletBinding()]
param(
    [string]$ExecutablePath = (Join-Path $PSScriptRoot "..\src-tauri\target\release\kystudy.exe")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Remove-VerifiedPreviewDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$PreviewDirectory,
        [Parameter(Mandatory = $true)][string]$SystemTemporaryDirectory
    )

    if (-not (Test-Path -LiteralPath $PreviewDirectory)) {
        return
    }

    $resolvedPreview = [IO.Path]::GetFullPath($PreviewDirectory)
    $resolvedTemporary = [IO.Path]::GetFullPath($SystemTemporaryDirectory)
    $separatorCharacters = [char[]]@(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $temporaryPrefix = $resolvedTemporary.TrimEnd($separatorCharacters) + [IO.Path]::DirectorySeparatorChar

    if (-not $resolvedPreview.StartsWith($temporaryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a preview directory outside the system temporary directory."
    }

    Remove-Item -LiteralPath $resolvedPreview -Recurse -Force
}

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
if ([IO.Path]::GetExtension($resolvedExecutable) -ne ".exe") {
    throw "Clean release preview requires a Windows executable."
}

$systemTemporary = [IO.Path]::GetTempPath()
$previewRoot = Join-Path $systemTemporary ("kystudy-clean-release-" + [Guid]::NewGuid().ToString("N"))
$previewDataDirectory = Join-Path $previewRoot "KyStudyData"
$previewDatabase = Join-Path $previewDataDirectory "workspaces\default\kystudy.sqlite3"

$originalDataDirectoryOverride = $env:KYSTUDY_APP_DATA_DIR
$process = $null

try {
    New-Item -ItemType Directory -Path $previewDataDirectory -Force | Out-Null

    # Tauri resolves Windows Known Folders directly, so APPDATA alone cannot
    # isolate the preview. KyStudy honors this explicit absolute-path override.
    $env:KYSTUDY_APP_DATA_DIR = $previewDataDirectory

    Write-Host "KyStudy clean first-launch preview"
    Write-Host "Executable: $resolvedExecutable"
    Write-Host "Isolated application data: $previewDataDirectory"
    Write-Host "Your normal KyStudy workspace will not be touched."
    Write-Host "Close the KyStudy window when you finish checking the initial state."

    $process = Start-Process -FilePath $resolvedExecutable -PassThru
    Wait-Process -Id $process.Id

    if (Test-Path -LiteralPath $previewDatabase) {
        Write-Host "A workspace database was created in the isolated preview directory." -ForegroundColor Yellow
    } else {
        Write-Host "No workspace database was created during preview." -ForegroundColor Green
    }
}
finally {
    $env:KYSTUDY_APP_DATA_DIR = $originalDataDirectoryOverride

    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
        Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue
    }

    Remove-VerifiedPreviewDirectory `
        -PreviewDirectory $previewRoot `
        -SystemTemporaryDirectory $systemTemporary
}

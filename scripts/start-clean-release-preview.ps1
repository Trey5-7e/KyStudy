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
$previewAppData = Join-Path $previewRoot "AppData\Roaming"
$previewLocalAppData = Join-Path $previewRoot "AppData\Local"
$previewDatabase = Join-Path $previewAppData "io.github.kystudy.desktop\workspaces\default\kystudy.sqlite3"

$originalAppData = $env:APPDATA
$originalLocalAppData = $env:LOCALAPPDATA
$process = $null

try {
    New-Item -ItemType Directory -Path $previewAppData -Force | Out-Null
    New-Item -ItemType Directory -Path $previewLocalAppData -Force | Out-Null

    $env:APPDATA = $previewAppData
    $env:LOCALAPPDATA = $previewLocalAppData

    Write-Host "KyStudy clean first-launch preview"
    Write-Host "Executable: $resolvedExecutable"
    Write-Host "Isolated APPDATA: $previewAppData"
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
    $env:APPDATA = $originalAppData
    $env:LOCALAPPDATA = $originalLocalAppData

    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
        Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue
    }

    Remove-VerifiedPreviewDirectory `
        -PreviewDirectory $previewRoot `
        -SystemTemporaryDirectory $systemTemporary
}

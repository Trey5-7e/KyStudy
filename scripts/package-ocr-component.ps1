param(
    [Parameter(Mandatory = $true)]
    [string]$ComponentRoot,

    [Parameter(Mandatory = $true)]
    [string]$OutputArchive,

    [Parameter(Mandatory = $false)]
    [string]$ManifestPath,

    [Parameter(Mandatory = $false)]
    [string]$DownloadUrl
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RequiredFiles = @(
    "kystudy-ocr-worker.exe",
    "_internal/rapidocr/models/PP-OCRv6_det_small.onnx",
    "_internal/rapidocr/models/PP-OCRv6_rec_small.onnx",
    "_internal/rapidocr/models/ch_ppocr_mobile_v2.0_cls_mobile.onnx",
    "_internal/onnxruntime/capi/onnxruntime_pybind11_state.pyd"
)

function Resolve-Directory([string]$PathValue) {
    $resolved = Resolve-Path -LiteralPath $PathValue -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $resolved.Path -PathType Container)) {
        throw "Component root must be a directory: $PathValue"
    }
    return $resolved.Path
}

$source = Resolve-Directory $ComponentRoot
$sourceName = Split-Path -Leaf $source
if ($sourceName -ne "kystudy-ocr-worker") {
    throw "Component root must be named kystudy-ocr-worker."
}

foreach ($relative in $RequiredFiles) {
    $candidate = Join-Path $source ($relative -replace '/', '\')
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Required OCR component file is missing: $relative"
    }
}

$entries = Get-ChildItem -LiteralPath $source -Force -Recurse
foreach ($entry in $entries) {
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "OCR component must not contain symbolic links or reparse points: $($entry.FullName)"
    }
}

$archive = [IO.Path]::GetFullPath($OutputArchive)
$archiveExtension = [IO.Path]::GetExtension($archive)
if ($archiveExtension -ine ".zip") {
    throw "Output archive must use the .zip extension."
}
$sourcePrefix = $source.TrimEnd('\') + '\'
if ($archive.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Output archive must be outside the component root."
}
$archiveParent = Split-Path -Parent $archive
if (-not (Test-Path -LiteralPath $archiveParent -PathType Container)) {
    New-Item -ItemType Directory -Path $archiveParent -Force | Out-Null
}
if (Test-Path -LiteralPath $archive -PathType Leaf) {
    Remove-Item -LiteralPath $archive -Force
}

Compress-Archive -LiteralPath $source -DestinationPath $archive -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    $names = @($zip.Entries | ForEach-Object { $_.FullName -replace '\\', '/' })
    foreach ($relative in $RequiredFiles) {
        $expected = "kystudy-ocr-worker/$relative"
        if ($names -notcontains $expected) {
            throw "Packaged archive is missing required entry: $expected"
        }
    }
    foreach ($name in $names) {
        if ($name.StartsWith('/') -or $name.Contains('../') -or $name -match '(^|/)\.\.($|/)') {
            throw "Packaged archive contains an unsafe path: $name"
        }
    }
}
finally {
    $zip.Dispose()
}

$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $archive).Length
Write-Host "OCR archive: $archive"
Write-Host "SHA-256: $hash"
Write-Host "Size: $size bytes"

if ($ManifestPath) {
    if ($DownloadUrl -and $DownloadUrl -notmatch '^https://') {
        throw "DownloadUrl must use HTTPS."
    }
    $manifest = [ordered]@{
        schemaVersion = 1
        engine = "rapidocr-3.9.2-ppocrv6-small-onnx-cpu"
        archive = [IO.Path]::GetFileName($archive)
        sizeBytes = $size
        sha256 = $hash
        downloadUrl = if ($DownloadUrl) { $DownloadUrl } else { $null }
    }
    $manifestFile = [IO.Path]::GetFullPath($ManifestPath)
    $manifestParent = Split-Path -Parent $manifestFile
    if (-not (Test-Path -LiteralPath $manifestParent -PathType Container)) {
        New-Item -ItemType Directory -Path $manifestParent -Force | Out-Null
    }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestFile -Encoding utf8
    Write-Host "Manifest: $manifestFile"
}

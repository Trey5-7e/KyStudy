$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("kystudy-ocr-package-test-" + [Guid]::NewGuid().ToString("N"))
$componentRoot = Join-Path $testRoot "kystudy-ocr-worker"
$archive = Join-Path $testRoot "kystudy-ocr-worker.zip"
$manifest = Join-Path $testRoot "manifest.json"
$packageScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "package-ocr-component.ps1"
$requiredFiles = @(
    "kystudy-ocr-worker.exe",
    "_internal/rapidocr/models/PP-OCRv6_det_small.onnx",
    "_internal/rapidocr/models/PP-OCRv6_rec_small.onnx",
    "_internal/rapidocr/models/ch_ppocr_mobile_v2.0_cls_mobile.onnx",
    "_internal/onnxruntime/capi/onnxruntime_pybind11_state.pyd"
)

try {
    foreach ($relative in $requiredFiles) {
        $path = Join-Path $componentRoot ($relative -replace '/', '\')
        New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
        Set-Content -LiteralPath $path -Value "fixture" -Encoding ascii
    }

    & $packageScript -ComponentRoot $componentRoot -OutputArchive $archive -ManifestPath $manifest

    $metadata = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    if ($metadata.schemaVersion -ne 1 -or $metadata.engine -ne "rapidocr-3.9.2-ppocrv6-small-onnx-cpu") {
        throw "Generated manifest metadata is invalid."
    }
    $actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($metadata.sha256 -ne $actualHash -or $metadata.sizeBytes -ne (Get-Item -LiteralPath $archive).Length) {
        throw "Generated manifest digest or size does not match the archive."
    }

    Add-Type -AssemblyName System.IO.Compression
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $names = @($zip.Entries | ForEach-Object { $_.FullName -replace '\\', '/' })
        foreach ($relative in $requiredFiles) {
            if ($names -notcontains ("kystudy-ocr-worker/" + $relative)) {
                throw "Generated archive is missing $relative"
            }
        }
    }
    finally {
        $zip.Dispose()
    }

    Write-Host "OCR package fixture test passed."

    try {
        & $packageScript -ComponentRoot $componentRoot -OutputArchive (Join-Path $testRoot "component.tar")
        throw "Non-ZIP output archive should have been rejected."
    }
    catch {
        if ($_.Exception.Message -notmatch "\.zip extension") {
            throw
        }
    }

    try {
        & $packageScript -ComponentRoot $componentRoot -OutputArchive (Join-Path $testRoot "secure.zip") -ManifestPath (Join-Path $testRoot "secure.json") -DownloadUrl "http://example.com/ocr.zip"
        throw "Non-HTTPS download URL should have been rejected."
    }
    catch {
        if ($_.Exception.Message -notmatch "HTTPS") {
            throw
        }
    }
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}

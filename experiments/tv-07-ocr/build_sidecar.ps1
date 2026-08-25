param(
    [Parameter(Mandatory = $true)]
    [string]$PythonExecutable
)

$ErrorActionPreference = "Stop"
$ExperimentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutputRoot = Join-Path $ExperimentRoot "output\pyinstaller"
$Arguments = @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onedir",
    "--name", "kystudy-ocr-worker",
    "--paths", $ExperimentRoot,
    "--collect-data", "rapidocr",
    "--distpath", (Join-Path $OutputRoot "dist"),
    "--workpath", (Join-Path $OutputRoot "build"),
    "--specpath", $OutputRoot,
    (Join-Path $ExperimentRoot "tv07_ocr\worker.py")
)

# PaddleOCR is an optional formula-recognition enhancement. Keep the base
# Worker lightweight when the selected Python environment only has RapidOCR,
# while allowing the Paddle environment to produce a self-contained package.
$PaddleProbe = & $PythonExecutable -c "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('paddleocr') else 1)"
$PaddleAvailable = $LASTEXITCODE -eq 0
if ($PaddleAvailable) {
    $Arguments += @(
        "--collect-all", "paddleocr",
        "--collect-all", "paddlex",
        "--collect-all", "paddle",
        # PaddleX checks optional OCR dependencies through importlib.metadata;
        # PyInstaller does not preserve those distributions automatically.
        "--copy-metadata", "paddlex",
        "--copy-metadata", "paddleocr",
        "--copy-metadata", "paddlepaddle",
        "--copy-metadata", "beautifulsoup4",
        "--copy-metadata", "einops",
        "--copy-metadata", "ftfy",
        "--copy-metadata", "imagesize",
        "--copy-metadata", "Jinja2",
        "--copy-metadata", "latex2mathml",
        "--copy-metadata", "lxml",
        "--copy-metadata", "opencv-contrib-python",
        "--copy-metadata", "openpyxl",
        "--copy-metadata", "premailer",
        "--copy-metadata", "pyclipper",
        "--copy-metadata", "pypdfium2",
        "--copy-metadata", "python-bidi",
        "--copy-metadata", "regex",
        "--copy-metadata", "safetensors",
        "--copy-metadata", "scikit-learn",
        "--copy-metadata", "scipy",
        "--copy-metadata", "sentencepiece",
        "--copy-metadata", "shapely",
        "--copy-metadata", "tiktoken",
        "--copy-metadata", "tokenizers"
    )

    $FormulaModelDirectory = $env:KYSTUDY_OCR_FORMULA_MODEL_DIR
    if ([string]::IsNullOrWhiteSpace($FormulaModelDirectory)) {
        $FormulaModelDirectory = Join-Path $env:USERPROFILE ".paddlex\official_models\PP-FormulaNet_plus-M"
    }
    if (Test-Path -LiteralPath $FormulaModelDirectory -PathType Container) {
        $Arguments += @(
            "--add-data",
            "$FormulaModelDirectory;formula_models\PP-FormulaNet_plus-M"
        )
        Write-Host "Including optional formula model: $FormulaModelDirectory"
    }
    else {
        Write-Warning "PaddleOCR is installed but the optional formula model was not found: $FormulaModelDirectory"
    }
}
else {
    Write-Host "PaddleOCR not installed; building RapidOCR-only Worker."
}

& $PythonExecutable @Arguments

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

# Microsoft Store Python may bundle an older VC runtime than ONNX Runtime needs.
# Prefer newer system copies that already support the build environment.
$DistInternal = Join-Path $OutputRoot "dist\kystudy-ocr-worker\_internal"
$SystemRuntimeDirectory = [Environment]::SystemDirectory
$RuntimeNames = @(
    "msvcp140.dll",
    "msvcp140_1.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll"
)

foreach ($RuntimeName in $RuntimeNames) {
    $SystemRuntime = Join-Path $SystemRuntimeDirectory $RuntimeName
    $BundledRuntime = Join-Path $DistInternal $RuntimeName
    if (-not (Test-Path -LiteralPath $SystemRuntime -PathType Leaf)) {
        throw "Required system runtime is missing: $RuntimeName"
    }
    if (-not (Test-Path -LiteralPath $BundledRuntime -PathType Leaf)) {
        throw "PyInstaller did not bundle the expected runtime: $RuntimeName"
    }

    $SystemVersion = [version](Get-Item -LiteralPath $SystemRuntime).VersionInfo.FileVersion
    $BundledVersion = [version](Get-Item -LiteralPath $BundledRuntime).VersionInfo.FileVersion
    if ($SystemVersion -gt $BundledVersion) {
        Copy-Item -LiteralPath $SystemRuntime -Destination $BundledRuntime -Force
        Write-Host "Updated $RuntimeName from $BundledVersion to $SystemVersion"
    }
}

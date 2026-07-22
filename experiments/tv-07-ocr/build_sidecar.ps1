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

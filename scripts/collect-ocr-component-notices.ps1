[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ComponentRoot,

    [Parameter(Mandatory = $true)]
    [string]$PythonSitePackages,

    [switch]$FetchProjectLicenses
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$componentPath = (Resolve-Path -LiteralPath $ComponentRoot).Path
$sitePackagesPath = (Resolve-Path -LiteralPath $PythonSitePackages).Path
$noticeDirectory = Join-Path $componentPath "THIRD_PARTY_NOTICES"
New-Item -ItemType Directory -Path $noticeDirectory -Force | Out-Null

$copyMap = @(
    @{ Source = "onnxruntime\LICENSE"; Destination = "onnxruntime-LICENSE.txt" },
    @{ Source = "onnxruntime\ThirdPartyNotices.txt"; Destination = "onnxruntime-ThirdPartyNotices.txt" },
    @{ Source = "cv2\LICENSE.txt"; Destination = "opencv-LICENSE.txt" },
    @{ Source = "cv2\LICENSE-3RD-PARTY.txt"; Destination = "opencv-LICENSE-3RD-PARTY.txt" },
    @{ Source = "pillow-12.3.0.dist-info\licenses\LICENSE"; Destination = "pillow-LICENSE.txt" },
    @{ Source = "psutil-7.2.2.dist-info\LICENSE"; Destination = "psutil-LICENSE.txt" },
    @{ Source = "shapely-2.1.2.dist-info\licenses\LICENSE.txt"; Destination = "shapely-LICENSE.txt" },
    @{ Source = "shapely-2.1.2.dist-info\licenses\LICENSE_GEOS"; Destination = "shapely-LICENSE_GEOS.txt" },
    @{ Source = "shapely-2.1.2.dist-info\licenses\LICENSE_win32"; Destination = "shapely-LICENSE_win32.txt" },
    @{ Source = "requests-2.34.2.dist-info\licenses\LICENSE"; Destination = "requests-LICENSE.txt" },
    @{ Source = "requests-2.34.2.dist-info\licenses\NOTICE"; Destination = "requests-NOTICE.txt" },
    @{ Source = "pyinstaller-6.21.0.dist-info\licenses\COPYING.txt"; Destination = "pyinstaller-COPYING.txt" },
    @{ Source = "pyclipper-1.4.0.dist-info\licenses\LICENSE"; Destination = "pyclipper-LICENSE.txt" },
    @{ Source = "pyyaml-6.0.3.dist-info\licenses\LICENSE"; Destination = "pyyaml-LICENSE.txt" },
    @{ Source = "omegaconf-2.3.1.dist-info\licenses\LICENSE"; Destination = "omegaconf-LICENSE.txt" },
    @{ Source = "urllib3-2.7.0.dist-info\licenses\LICENSE.txt"; Destination = "urllib3-LICENSE.txt" },
    @{ Source = "certifi-2026.7.22.dist-info\licenses\LICENSE"; Destination = "certifi-LICENSE.txt" },
    @{ Source = "charset_normalizer-3.4.9.dist-info\licenses\LICENSE"; Destination = "charset-normalizer-LICENSE.txt" },
    @{ Source = "idna-3.18.dist-info\licenses\LICENSE.md"; Destination = "idna-LICENSE.md" },
    @{ Source = "six-1.17.0.dist-info\LICENSE"; Destination = "six-LICENSE.txt" },
    @{ Source = "colorama-0.4.6.dist-info\licenses\LICENSE.txt"; Destination = "colorama-LICENSE.txt" },
    @{ Source = "colorlog-6.11.0.dist-info\licenses\LICENSE"; Destination = "colorlog-LICENSE.txt" },
    @{ Source = "packaging-26.2.dist-info\licenses\LICENSE"; Destination = "packaging-LICENSE.txt" },
    @{ Source = "packaging-26.2.dist-info\licenses\LICENSE.APACHE"; Destination = "packaging-LICENSE.APACHE.txt" },
    @{ Source = "packaging-26.2.dist-info\licenses\LICENSE.BSD"; Destination = "packaging-LICENSE.BSD.txt" },
    @{ Source = "pefile-2024.8.26.dist-info\LICENSE"; Destination = "pefile-LICENSE.txt" },
    @{ Source = "pywin32_ctypes-0.2.3.dist-info\LICENSE.txt"; Destination = "pywin32-ctypes-LICENSE.txt" }
)

foreach ($entry in $copyMap) {
    $source = Join-Path $sitePackagesPath $entry.Source
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required license source is missing: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $noticeDirectory $entry.Destination) -Force
}

if ($FetchProjectLicenses) {
    $remoteLicenses = @(
        @{ Url = "https://raw.githubusercontent.com/RapidAI/RapidOCR/main/LICENSE"; Destination = "rapidocr-LICENSE.txt" },
        @{ Url = "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/LICENSE"; Destination = "paddleocr-project-LICENSE.txt" },
        @{ Url = "https://raw.githubusercontent.com/google/flatbuffers/master/LICENSE"; Destination = "flatbuffers-LICENSE.txt" },
        @{ Url = "https://raw.githubusercontent.com/protocolbuffers/protobuf/main/LICENSE"; Destination = "protobuf-LICENSE.txt" },
        @{ Url = "https://raw.githubusercontent.com/antlr/antlr4/master/LICENSE.txt"; Destination = "antlr4-LICENSE.txt" },
        @{ Url = "https://raw.githubusercontent.com/ronaldoussoren/altgraph/master/LICENSE"; Destination = "altgraph-LICENSE.txt" }
    )
    foreach ($entry in $remoteLicenses) {
        Invoke-WebRequest -Uri $entry.Url -OutFile (Join-Path $noticeDirectory $entry.Destination)
    }
}

$summary = @"
KyStudy OCR component third-party notice inventory
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ssK")

This directory contains license and notice files copied from the locked OCR
Python environment. It is an inventory, not legal advice. Do not publish the
component until the PP-OCRv6 model terms and Microsoft VC Runtime terms have
been independently confirmed for redistribution.

Runtime packages:
- RapidOCR 3.9.2: Apache-2.0 project license; see rapidocr-LICENSE.txt when fetched.
- ONNX Runtime 1.27.0: LICENSE and ThirdPartyNotices.txt are included.
- OpenCV Python 5.0.0.93: LICENSE.txt and LICENSE-3RD-PARTY.txt are included.
- Pillow 12.3.0: LICENSE is included.
- psutil 7.2.2: LICENSE is included.
- Shapely/GEOS 2.1.2: LICENSE, LICENSE_GEOS and LICENSE_win32 are included.
- requests 2.34.2: LICENSE and NOTICE are included.
- PyInstaller 6.21.0: COPYING.txt is included for the build bootloader.
- pyclipper, PyYAML, OmegaConf, urllib3, certifi, charset-normalizer, idna,
  six, colorama, colorlog, packaging, pefile and pywin32-ctypes license files
  are included when present in the locked environment.

Model and runtime review required before publication:
- PP-OCRv6_det_small.onnx
- PP-OCRv6_rec_small.onnx
- ch_ppocr_mobile_v2.0_cls_mobile.onnx
- msvcp140.dll, MSVCP140_1.dll, vcruntime140.dll, vcruntime140_1.dll

Model source evidence:
- RapidOCR 3.9.2 resolves the PP-OCRv6 and PP-OCRv4 ONNX files from
  https://www.modelscope.cn/models/RapidAI/RapidOCR (model card currently
  declares Apache License 2.0). The exact v3.9.2 model files still require
  a final redistribution check before publication.
- PaddleOCR project license text is included as attribution evidence; it is
  not a substitute for checking the exact model-card terms.

The exact source directory and archive digest are recorded in the R52
acceptance document. Adding or changing these files changes the ZIP digest.
"@
Set-Content -LiteralPath (Join-Path $componentPath "THIRD_PARTY_NOTICES.txt") -Value $summary -Encoding utf8

Write-Host "Collected $($copyMap.Count) local license/notice files into $noticeDirectory"
if ($FetchProjectLicenses) {
    Write-Host "Fetched RapidOCR and PaddleOCR project license texts from their official repositories."
}
Write-Host "Model and VC Runtime redistribution review remains required before publication."

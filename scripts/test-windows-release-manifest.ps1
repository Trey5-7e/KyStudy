[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("kystudy-release-manifest-test-" + [Guid]::NewGuid().ToString('N'))
$artifactDirectory = Join-Path $testRoot 'artifacts'
$manifest = Join-Path $testRoot 'manifest.json'
$scriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'write-windows-release-manifest.ps1'

try {
    New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
    $setup = Join-Path $artifactDirectory 'KyStudy_0.1.2_x64-setup.exe'
    $signature = Join-Path $artifactDirectory 'KyStudy_0.1.2_x64-setup.exe.sig'
    $portable = Join-Path $artifactDirectory 'kystudy-windows-x64-portable.zip'
    Set-Content -LiteralPath $setup -Value 'setup-fixture' -Encoding ascii
    Set-Content -LiteralPath $signature -Value 'signature-fixture' -Encoding ascii
    Set-Content -LiteralPath $portable -Value 'portable-fixture' -Encoding ascii

    & $scriptPath `
        -Version '0.1.2' `
        -OutputPath $manifest `
        -ArtifactPath @($setup, $signature, $portable)

    $metadata = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    if ($metadata.schemaVersion -ne 1 -or $metadata.version -ne '0.1.2') {
        throw 'Release manifest header is invalid.'
    }
    if ($metadata.artifacts.Count -ne 3) {
        throw 'Release manifest artifact count is invalid.'
    }
    foreach ($artifact in $metadata.artifacts) {
        $source = Join-Path $artifactDirectory $artifact.fileName
        $expectedHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
        $expectedSize = (Get-Item -LiteralPath $source).Length
        if ($artifact.sha256 -cne $expectedHash -or $artifact.sizeBytes -ne $expectedSize) {
            throw "Release manifest digest is invalid for $($artifact.fileName)."
        }
    }

    try {
        & $scriptPath -Version '0.1.2' -OutputPath (Join-Path $testRoot 'duplicate.json') -ArtifactPath @($setup, $setup)
        throw 'Duplicate artifact names should have been rejected.'
    }
    catch {
        if ($_.Exception.Message -notmatch 'unique') {
            throw
        }
    }

    try {
        & $scriptPath -Version '0.1.2' -OutputPath (Join-Path $testRoot 'directory.json') -ArtifactPath $artifactDirectory
        throw 'Directory artifacts should have been rejected.'
    }
    catch {
        if ($_.Exception.Message -notmatch 'must be a file') {
            throw
        }
    }

    Write-Host 'Windows release manifest fixture test passed.'
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [Parameter(Mandatory = $true)]
    [string[]]$ArtifactPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Version must use major.minor.patch format: $Version"
}

$manifestPath = [IO.Path]::GetFullPath($OutputPath)
$artifactMetadata = foreach ($path in $ArtifactPath) {
    $resolved = (Resolve-Path -LiteralPath $path -ErrorAction Stop).Path
    $item = Get-Item -LiteralPath $resolved
    if (-not $item.PSIsContainer -and $item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Release artifacts must not be reparse points: $resolved"
    }
    if ($item.PSIsContainer) {
        throw "Release artifact must be a file: $resolved"
    }
    if ([IO.Path]::GetFullPath($resolved).Equals($manifestPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Manifest output cannot also be an input artifact: $resolved"
    }

    [pscustomobject][ordered]@{
        fileName = $item.Name
        sizeBytes = [int64]$item.Length
        sha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

$sortedArtifacts = @($artifactMetadata | Sort-Object -Property fileName)
$duplicateNames = @(
    $sortedArtifacts |
        Group-Object -Property fileName |
        Where-Object Count -gt 1 |
        Select-Object -ExpandProperty Name
)
if ($duplicateNames.Count -gt 0) {
    throw "Release artifact names must be unique: $($duplicateNames -join ', ')"
}

$manifest = [ordered]@{
    schemaVersion = 1
    version = $Version
    artifacts = $sortedArtifacts
}

$manifestParent = Split-Path -Parent $manifestPath
New-Item -ItemType Directory -Path $manifestParent -Force | Out-Null
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Output $manifestPath

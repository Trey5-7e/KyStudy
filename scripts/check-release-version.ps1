[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$ExpectedVersion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
$tauri = Get-Content -LiteralPath (Join-Path $repositoryRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$cargoLine = Select-String -LiteralPath (Join-Path $repositoryRoot 'src-tauri\Cargo.toml') -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1

$versions = [ordered]@{
    package = [string]$package.version
    tauri = [string]$tauri.version
    cargo = if ($cargoLine -and $cargoLine.Matches.Count -gt 0) {
        [string]$cargoLine.Matches[0].Groups[1].Value
    } else {
        ''
    }
}

$mismatches = @(
    $versions.GetEnumerator() |
        Where-Object { $_.Value -ne $ExpectedVersion } |
        ForEach-Object { "$($_.Key)=$($_.Value)" }
)

if ($mismatches.Count -gt 0) {
    throw "Release version mismatch. Expected $ExpectedVersion; found $($mismatches -join ', ')."
}

Write-Output "Release version check passed: $ExpectedVersion"

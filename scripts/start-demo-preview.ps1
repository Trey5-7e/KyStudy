param(
  [int]$Port = 1420
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))

Push-Location $repoRoot
try {
  Write-Host "KyStudy clean demo workspace"
  Write-Host "Preview URL: http://127.0.0.1:$Port/#planning"
  Write-Host "Read-only browser preview; desktop workspace data is not touched."
  Write-Host "Press Ctrl+C to stop the dev server."

  $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if ($null -eq $pnpm) {
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  }

  if ($null -ne $pnpm) {
    $runner = $pnpm.Source
    $runnerArguments = @("dev", "--host", "127.0.0.1", "--port", "$Port")
  } else {
    $corepack = Get-Command corepack.cmd -ErrorAction SilentlyContinue
    if ($null -eq $corepack) {
      $corepack = Get-Command corepack -ErrorAction SilentlyContinue
    }
    if ($null -eq $corepack) {
      throw "pnpm was not found. Install pnpm or enable it with: corepack enable"
    }
    $runner = $corepack.Source
    $runnerArguments = @("pnpm", "dev", "--host", "127.0.0.1", "--port", "$Port")
  }

  & $runner @runnerArguments
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm dev exited with code: $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

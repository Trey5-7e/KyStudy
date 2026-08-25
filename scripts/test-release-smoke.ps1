[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,

    [Parameter(Mandatory = $true)]
    [string]$ReportPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RequiredEnvironmentPath {
    param([Parameter(Mandatory = $true)][string]$Name)

    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Required environment variable '$Name' is not available."
    }
    return [IO.Path]::GetFullPath($value)
}

function Remove-VerifiedSmokeDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$SmokeDirectory,
        [Parameter(Mandatory = $true)][string]$RunnerTemporaryDirectory
    )

    if (-not (Test-Path -LiteralPath $SmokeDirectory)) {
        return
    }

    $resolvedSmoke = [IO.Path]::GetFullPath($SmokeDirectory)
    $resolvedRunnerTemporary = [IO.Path]::GetFullPath($RunnerTemporaryDirectory)
    $separatorCharacters = [char[]]@(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $runnerPrefix = $resolvedRunnerTemporary.TrimEnd($separatorCharacters) + [IO.Path]::DirectorySeparatorChar

    if (-not $resolvedSmoke.StartsWith($runnerPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a Smoke directory outside RUNNER_TEMP."
    }

    Remove-Item -LiteralPath $resolvedSmoke -Recurse -Force
}

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
if ([IO.Path]::GetExtension($resolvedExecutable) -ne '.exe') {
    throw 'Release Smoke requires a Windows executable.'
}

$runnerTemporary = Get-RequiredEnvironmentPath -Name 'RUNNER_TEMP'
$smokeRoot = Join-Path $runnerTemporary ("kystudy-release-smoke-" + [Guid]::NewGuid().ToString('N'))
$smokeInstallDirectory = Join-Path $smokeRoot 'install'
$smokeExecutable = Join-Path $smokeInstallDirectory 'kystudy.exe'
$smokeDataDirectory = Join-Path $smokeInstallDirectory 'data'
$smokeAppData = Join-Path $smokeRoot 'AppData\Roaming'
$smokeLocalAppData = Join-Path $smokeRoot 'AppData\Local'
$workspaceDatabase = Join-Path $smokeDataDirectory 'workspaces\default\kystudy.sqlite3'
$resolvedReport = [IO.Path]::GetFullPath($ReportPath)
$reportParent = Split-Path -Parent $resolvedReport
$executableMetadata = Get-Item -LiteralPath $resolvedExecutable
$executableHash = (Get-FileHash -LiteralPath $resolvedExecutable -Algorithm SHA256).Hash

$originalAppData = $env:APPDATA
$originalLocalAppData = $env:LOCALAPPDATA
$process = $null
$windowObserved = $false
$observedSeconds = 0

try {
    New-Item -ItemType Directory -Path $smokeInstallDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $smokeInstallDirectory 'resources') -Force | Out-Null
    Copy-Item -LiteralPath $resolvedExecutable -Destination $smokeExecutable
    New-Item -ItemType Directory -Path $smokeAppData -Force | Out-Null
    New-Item -ItemType Directory -Path $smokeLocalAppData -Force | Out-Null
    New-Item -ItemType Directory -Path $reportParent -Force | Out-Null

    $env:APPDATA = $smokeAppData
    $env:LOCALAPPDATA = $smokeLocalAppData
    $process = Start-Process -FilePath $smokeExecutable -PassThru -WindowStyle Hidden

    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 500
        $observedSeconds += 0.5
        $process.Refresh()
        if ($process.HasExited) {
            throw "KyStudy exited during startup with code $($process.ExitCode)."
        }
        if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
            $windowObserved = $true
            break
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    if (-not $windowObserved) {
        throw 'KyStudy did not create a main window within 20 seconds.'
    }

    Start-Sleep -Seconds 2
    $process.Refresh()
    if ($process.HasExited) {
        throw "KyStudy exited after creating its main window with code $($process.ExitCode)."
    }
    if (Test-Path -LiteralPath $workspaceDatabase) {
        throw 'Startup Smoke created a workspace database without user action.'
    }
    if (-not (Test-Path -LiteralPath $smokeDataDirectory -PathType Container)) {
        Get-ChildItem -LiteralPath $smokeRoot -Recurse -Depth 2 -Force |
            ForEach-Object { Write-Output ("SMOKE_TREE: " + $_.FullName) }
        throw 'Startup Smoke did not initialize the installation-side data directory.'
    }

    [ordered]@{
        status = 'passed'
        executableFileName = $executableMetadata.Name
        executableSizeBytes = $executableMetadata.Length
        executableSha256 = $executableHash
        installDataDirectoryInitialized = $true
        mainWindowObserved = $windowObserved
        observedSeconds = $observedSeconds + 2
        workspaceDatabaseCreated = $false
        runnerImage = $env:ImageOS
        runnerArchitecture = $env:PROCESSOR_ARCHITECTURE
    } | ConvertTo-Json | Set-Content -LiteralPath $resolvedReport -Encoding utf8
}
finally {
    $env:APPDATA = $originalAppData
    $env:LOCALAPPDATA = $originalLocalAppData

    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
        Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue
    }

    Remove-VerifiedSmokeDirectory `
        -SmokeDirectory $smokeRoot `
        -RunnerTemporaryDirectory $runnerTemporary
}

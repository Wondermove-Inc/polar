param([Parameter(Mandatory=$true)][string]$Asset)
$ErrorActionPreference = 'Stop'
if (!(Test-Path $Asset -PathType Leaf)) { throw "Missing installer: $Asset" }
$installed = Join-Path $env:LOCALAPPDATA 'Programs/Polar/app'
$setup = Start-Process -FilePath $Asset -ArgumentList '/S' -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw "Setup exited with $($setup.ExitCode)" }
if (!(Test-Path "$installed/Font-Licenses.txt")) { throw 'Font notices missing' }
$env:POLAR_SMOKE_TEST = '1'
$stderr = [System.IO.Path]::GetTempFileName()
$app = Start-Process "$installed/Polar.exe" -PassThru -RedirectStandardError $stderr
try {
    for ($i = 0; $i -lt 60; $i++) {
        $app.Refresh()
        if ($app.HasExited) { throw "Polar exited with $($app.ExitCode)" }
        $ready = Select-String -Path $stderr -Pattern '^Polar frontend ready$' -Quiet
        if ($ready -and $app.MainWindowHandle -ne 0 -and $app.MainWindowTitle -eq 'Polar') { return }
        Start-Sleep -Seconds 1
    }
    Get-Content $stderr
    throw 'Polar did not show its main window with a ready frontend'
} finally {
    if (!$app.HasExited) { Stop-Process -Id $app.Id }
}

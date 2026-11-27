# Requires Rust x64 MSVC, the Visual Studio C++ toolchain, and NSIS 3.
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $target = 'x86_64-pc-windows-msvc'
    cargo build -p polar-desktop --locked --release --target $target
    if ($LASTEXITCODE) { throw 'Rust release build failed' }
    $dist = New-Item -ItemType Directory -Force 'target/dist'
    $exe = (Resolve-Path "target/$target/release/polar-desktop.exe").Path
    $setup = Join-Path $dist.FullName 'Polar-1.0.0-rc.16-windows-x64-setup.exe'
    $compiler = Get-Command makensis.exe -ErrorAction SilentlyContinue
    $nsis = if ($compiler) { $compiler.Source } else { Join-Path ${env:ProgramFiles(x86)} 'NSIS/makensis.exe' }
    & $nsis "/DOUTPUT=$setup" "/DBINARY=$exe" 'packaging/Polar.nsi'
    if ($LASTEXITCODE) { throw 'Installer packaging failed' }
    Get-FileHash $setup -Algorithm SHA256
} finally { Pop-Location }

#!/usr/bin/env bash
# Build on the target OS so the installer contains a native app for this CPU.
set -euo pipefail
cd "$(dirname "$0")/.."
repo=$PWD
version=$(python3 -c 'import json; print(json.load(open("desktop/tauri.conf.json"))["version"])')
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$ ]]
if [[ $(uname -s) == Darwin ]]; then export MACOSX_DEPLOYMENT_TARGET=13.0; fi
cargo build --release --locked -p polar-desktop
target_dir=$(cargo metadata --locked --no-deps --format-version 1 | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')
binary="$target_dir/release/polar-desktop"
dist="$repo/target/dist"
mkdir -p "$dist"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

case "$(uname -s)" in
  Linux)
    test "$(dpkg --print-architecture)" = amd64
    package="$stage/package"
    install -Dm755 "$binary" "$package/usr/bin/polar"
    install -Dm644 desktop/icons/icon.png "$package/usr/share/icons/hicolor/512x512/apps/local.polar.launcher.png"
    install -Dm644 docs/FONT-LICENSES.txt "$package/usr/share/doc/polar/FONT-LICENSES.txt"
    mkdir -p "$package/DEBIAN" "$package/usr/share/applications" "$stage/debian"
    cat > "$package/usr/share/applications/local.polar.launcher.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Polar
Comment=Game library and launcher
Comment[ko]=게임 라이브러리 및 런처
Exec=polar
Icon=local.polar.launcher
Terminal=false
Categories=Game;
DESKTOP
    # dpkg-shlibdeps resolves the actual distribution package names and symbol versions.
    touch "$stage/debian/control"
    deps=$(cd "$stage" && dpkg-shlibdeps -O "$package/usr/bin/polar")
    [[ $deps == shlibs:Depends=?* ]]
    cat > "$package/DEBIAN/control" <<CONTROL
Package: polar
Version: ${version/-rc./~rc.}
Architecture: amd64
Section: games
Priority: optional
Maintainer: Wondermove-Inc <Wondermove-Inc@users.noreply.github.com>
Depends: ${deps#shlibs:Depends=}, libglib2.0-bin
Description: Polar desktop game library and launcher
 Browse your installed games and launch them from one controller-friendly library.
CONTROL
    dpkg-deb --build --root-owner-group "$package" "$dist/Polar-$version-linux-x64.deb"
    ;;
  Darwin)
    case "$(uname -m)" in
      arm64) arch=arm64 ;;
      x86_64) arch=x64 ;;
      *) echo 'Unsupported macOS architecture' >&2; exit 1 ;;
    esac
    app="$stage/volume/Polar.app"
    mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
    install -m755 "$binary" "$app/Contents/MacOS/Polar"
    install -m644 desktop/icons/icon.icns "$app/Contents/Resources/Polar.icns"
    install -m644 docs/FONT-LICENSES.txt "$app/Contents/Resources/FONT-LICENSES.txt"
    cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Polar</string>
<key>CFBundleIdentifier</key><string>local.polar.launcher</string>
<key>CFBundleName</key><string>Polar</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>Polar.icns</string>
<key>CFBundleShortVersionString</key><string>${version%%-*}</string>
<key>CFBundleVersion</key><string>${version/-rc./b}</string>
<key>LSMinimumSystemVersion</key><string>$MACOSX_DEPLOYMENT_TARGET</string>
<key>LSApplicationCategoryType</key><string>public.app-category.games</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
    codesign --force --sign - "$app"
    ln -s /Applications "$stage/volume/Applications"
    hdiutil create -fs HFS+ -format UDZO -volname Polar -srcfolder "$stage/volume" "$stage/Polar.dmg"
    mv "$stage/Polar.dmg" "$dist/Polar-$version-macos-$arch.dmg"
    ;;
  *) echo 'Run this script on Linux or macOS' >&2; exit 1 ;;
esac

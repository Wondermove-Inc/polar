#!/usr/bin/env bash
# Run on a clean GitHub-hosted runner after building the native installer.
set -euo pipefail
asset=$1
test -f "$asset"
export POLAR_SMOKE_TEST=1
case "$(uname -s)" in
  Linux)
    sudo apt-get install --yes "$(realpath "$asset")"
    desktop-file-validate /usr/share/applications/local.polar.launcher.desktop
    test -s /usr/share/doc/polar/FONT-LICENSES.txt
    test -s /usr/share/icons/hicolor/512x512/apps/local.polar.launcher.png
    xvfb-run -a dbus-run-session -- bash -ec '
      log=$(mktemp)
      polar 2>"$log" &
      pid=$!
      trap "kill $pid 2>/dev/null || true" EXIT
      timeout 60 xdotool search --sync --onlyvisible --pid "$pid" --name "^Polar$" >/dev/null
      for _ in {1..60}; do
        kill -0 "$pid"
        if grep -Fxq "Polar frontend ready" "$log"; then exit 0; fi
        sleep 1
      done
      cat "$log" >&2
      exit 1
    '
    ;;
  Darwin)
    work=$(mktemp -d)
    mount="$work/volume"
    mkdir "$mount"
    hdiutil verify "$asset"
    hdiutil attach "$asset" -readonly -nobrowse -mountpoint "$mount"
    trap 'hdiutil detach "$mount"' EXIT
    test "$(readlink "$mount/Applications")" = /Applications
    ditto "$mount/Polar.app" "$work/Polar.app"
    app="$work/Polar.app/Contents"
    plutil -lint "$app/Info.plist"
    test -s "$app/Resources/Polar.icns"
    test -s "$app/Resources/FONT-LICENSES.txt"
    lipo "$app/MacOS/Polar" -verify_arch "$(uname -m)"
    codesign --verify --strict --deep "$work/Polar.app"
    "$app/MacOS/Polar" 2>"$work/stderr" &
    pid=$!
    trap 'kill "$pid" 2>/dev/null || true; hdiutil detach "$mount"' EXIT
    swift - "$pid" "$work/stderr" <<'SWIFT'
import CoreGraphics
import Foundation

let pid = Int(CommandLine.arguments[1])!
let log = CommandLine.arguments[2]
for _ in 0..<60 {
    let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
    let ready = (try? String(contentsOfFile: log, encoding: .utf8))?.components(separatedBy: .newlines).contains("Polar frontend ready") == true
    if ready && windows.contains(where: {
        $0[kCGWindowOwnerPID as String] as? Int == pid && $0[kCGWindowLayer as String] as? Int == 0
    }) { exit(0) }
    Thread.sleep(forTimeInterval: 1)
}
if let errors = try? String(contentsOfFile: log, encoding: .utf8) { print(errors) }
exit(1)
SWIFT
    ;;
  *) exit 1 ;;
esac

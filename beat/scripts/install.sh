#!/bin/bash
# Builds Mac Pulse Beat, packs it into an app, installs it to ~/Applications
# and starts it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
swift build -c release

APP="$ROOT/dist/Mac Pulse Beat.app"
rm -rf "$ROOT/dist"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/MacPulseBeat "$APP/Contents/MacOS/"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>MacPulseBeat</string>
  <key>CFBundleIdentifier</key><string>dev.macpulse.beat</string>
  <key>CFBundleName</key><string>Mac Pulse Beat</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAudioCaptureUsageDescription</key><string>Mac Pulse Beat listens to what plays on this Mac to find its tempo for Tape Club. Audio is not recorded or sent anywhere: only the tempo and the time of a beat leave the app.</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
# Ad hoc signature: macOS may ask for the audio permission again after a rebuild.
codesign --force --sign - "$APP"

mkdir -p ~/Applications
rm -rf ~/Applications/"Mac Pulse Beat.app"
cp -R "$APP" ~/Applications/
open ~/Applications/"Mac Pulse Beat.app"
echo "Mac Pulse Beat is running: look for ♩ in the menu bar."

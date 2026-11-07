#!/bin/sh
# Builds dist/GoatBrowser-<version>-x86_64.AppImage from dist/Goat Browser-linux-x64.
# Needs appimagetool (https://github.com/AppImage/appimagetool) on PATH or in $APPIMAGETOOL.
set -e
cd "$(dirname "$0")/../.."
VERSION=$(node -p "require('./package.json').version")
SRC="dist/Goat Browser-linux-x64"
APPDIR="dist/GoatBrowser.AppDir"
TOOL="${APPIMAGETOOL:-appimagetool}"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/lib/goat-browser" "$APPDIR/usr/share/icons/hicolor/256x256/apps" "$APPDIR/usr/share/applications"
cp -a "$SRC/." "$APPDIR/usr/lib/goat-browser/"
cp installer/linux/AppRun "$APPDIR/AppRun"
cp installer/linux/goat-browser.desktop "$APPDIR/goat-browser.desktop"
cp installer/linux/goat-browser.desktop "$APPDIR/usr/share/applications/"
cp src/icon.png "$APPDIR/goat-browser.png"
cp src/icon.png "$APPDIR/usr/share/icons/hicolor/256x256/apps/goat-browser.png"
ln -sf goat-browser.png "$APPDIR/.DirIcon"
chmod +x "$APPDIR/AppRun"
ARCH=x86_64 "$TOOL" --appimage-extract-and-run "$APPDIR" "dist/GoatBrowser-$VERSION-x86_64.AppImage" 2>/dev/null || ARCH=x86_64 "$TOOL" "$APPDIR" "dist/GoatBrowser-$VERSION-x86_64.AppImage"
echo "Built dist/GoatBrowser-$VERSION-x86_64.AppImage"

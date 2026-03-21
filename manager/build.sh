#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Building ProtocanvasManager..."
swift build -c release 2>&1

APP="ProtocanvasManager.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

# Copy binary
cp ".build/release/ProtocanvasManager" "$APP/Contents/MacOS/"

# Copy Info.plist
cp "Resources/Info.plist" "$APP/Contents/"

echo "Built $APP successfully."
echo ""
echo "To install: cp -r $APP /Applications/"
echo "To run:     open $APP"

#!/usr/bin/env bash
set -euo pipefail

rm -rf dist

bun run build

mkdir -p dist

cp server/dist/alfc dist/
cp -r frontend/build dist/frontend
cp bootstrap/scripts/linux/* dist/
cp alfc.config.json dist/

# Include plasmoid for KDE users
if [[ -d plasmoid/package ]]; then
  mkdir -p dist/plasmoid
  cp -r plasmoid/package dist/plasmoid/package
  cp plasmoid/install.sh dist/plasmoid/ 2>/dev/null || true
  cp plasmoid/uninstall.sh dist/plasmoid/ 2>/dev/null || true
  cp plasmoid/DEPENDENCIES.md dist/plasmoid/ 2>/dev/null || true
fi

# Include docs
cp LICENSE dist/ 2>/dev/null || true
cp LINUX.md dist/ 2>/dev/null || true
cp README.md dist/ 2>/dev/null || true

cd dist
tar -czf alfc.tar.gz --transform 's,^,alfc/,' *

cd ..

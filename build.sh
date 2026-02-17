#!/usr/bin/env bash
set -euo pipefail

rm -rf dist

bun run build

mkdir -p dist

cp server/dist/alfc dist/
cp -r frontend/build dist/frontend
cp bootstrap/scripts/linux/* dist/
cp alfc.config.json dist/
cp package.json dist/

cd dist
tar -czf alfc.tar.gz --transform 's,^,alfc/,' *

cd ..

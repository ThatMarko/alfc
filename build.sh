#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"
rm -rf dist
bun run build

RELEASE_DIR="dist/alfc"
mkdir -p "${RELEASE_DIR}"
cp server/dist/alfc "${RELEASE_DIR}/"
cp -r frontend/build "${RELEASE_DIR}/frontend"
cp bootstrap/scripts/linux/* "${RELEASE_DIR}/"
cp alfc.config.json LICENSE ./*.md "${RELEASE_DIR}/"

mkdir -p "${RELEASE_DIR}/plasmoid"
cp -r plasmoid/package "${RELEASE_DIR}/plasmoid/package"
cp plasmoid/install.sh plasmoid/uninstall.sh plasmoid/*.md "${RELEASE_DIR}/plasmoid/"
mkdir -p "${RELEASE_DIR}/common" "${RELEASE_DIR}/aur" "${RELEASE_DIR}/assets"
cp common/*.md "${RELEASE_DIR}/common/"
cp aur/README.md "${RELEASE_DIR}/aur/"
cp assets/screenshot.png "${RELEASE_DIR}/assets/"
mkdir -p "${RELEASE_DIR}/omarchy"
cp omarchy/install.sh omarchy/uninstall.sh omarchy/manage.py "${RELEASE_DIR}/omarchy/"
cp -r omarchy/module "${RELEASE_DIR}/omarchy/module"

# Keep the archive outside the directory being archived.
tar -czf dist/alfc.tar.gz -C dist alfc
printf 'Build complete: %s/dist/alfc.tar.gz\n' "${ROOT_DIR}"

#!/usr/bin/env bash
set -euo pipefail
widget_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
build_dir="$(mktemp -d -t alfc-widget-components.XXXXXX)"
trap 'rm -rf -- "$build_dir"' EXIT
# Use a single distribution's development files, shared libraries and QML
# plugins. Do not point this native runner at a PySide wheel's Qt directory.
cmake -S "$widget_dir/tests" -B "$build_dir" -G Ninja
cmake --build "$build_dir"
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"
export QT_QUICK_BACKEND="${QT_QUICK_BACKEND:-software}"
export XDG_CACHE_HOME="$build_dir/cache"
"$build_dir/alfc-widget-tests" -input "$widget_dir" "$@"

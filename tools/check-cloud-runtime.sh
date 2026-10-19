#!/bin/sh
set -eu

# Cloud image/activation pins, matching the tested CI versions. These do not
# replace package.json's minimum supported development engine requirements.
expected_bun=1.4.3
expected_node=v24.22.0
failed=0

check_runtime() {
  runtime=$1
  expected=$2
  if ! command -v "$runtime" >/dev/null 2>&1; then
    printf '%s\n' "Cloud runtime: $runtime is missing from PATH (expected $expected)." >&2
    failed=1
    return
  fi
  if ! actual=$("$runtime" --version 2>/dev/null); then
    printf '%s\n' "Cloud runtime: $runtime --version failed (expected $expected)." >&2
    failed=1
    return
  fi
  if [ "$actual" != "$expected" ]; then
    printf '%s\n' "Cloud runtime: $runtime reports $actual; expected $expected." >&2
    failed=1
  fi
}

check_runtime bun "$expected_bun"
check_runtime node "$expected_node"
if [ "$failed" -ne 0 ]; then
  printf '%s\n' \
    'Activate Bun 1.4.3 and Node 24.22.0 in PATH for every cloud setup/run/check shell.' \
    'Select those versions with your installed runtime manager, or update the cloud image if they are missing.' \
    'Installing dependencies does not upgrade the runtimes. See CONTRIBUTING.md for the toolchain and separate elevated backend command.' >&2
  exit 1
fi
printf '%s\n' "Cloud runtimes ready: Bun $expected_bun, Node $expected_node."

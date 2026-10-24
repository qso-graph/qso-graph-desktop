#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-only
# Builds the credential core against glibc 2.28, inside a manylinux_2_28 container.
set -euo pipefail
dnf -q -y install golang cmake perl >/dev/null
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal >/dev/null
export PATH="$HOME/.cargo/bin:$PATH"
go version; cmake --version | head -1
cargo build --release --target-dir /tmp/core --manifest-path packages/callsign-core/Cargo.toml
cp /tmp/core/release/libqg_callsign_core.so "$1"

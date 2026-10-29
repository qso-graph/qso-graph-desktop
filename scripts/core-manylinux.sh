#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-only
# Builds the credential core against glibc 2.28, inside a manylinux_2_28 container.
set -euo pipefail
# A stalled mirror is given up on, not waited on: in CI (2026-10-28) this dnf, silenced, hung a
# job twice for 18 minutes while the same step elsewhere took 2. minrate drops a mirror slower
# than 100 kB/s for timeout seconds and tries the next; its progress is shown, so a stall shows.
# A broken mirror is a different failure, and those settings do not cover it: on 2026-10-29 a
# mirror served an empty repomd.xml, dnf stopped at "Document is empty" within the minute, and
# the release PR's check failed while the same step in the next job passed. The bad metadata is
# cleaned and the install tried again, which picks a mirror afresh.
for attempt in 1 2 3 4; do
  echo "== dnf: golang cmake perl (attempt $attempt)"
  if dnf -y --setopt=timeout=30 --setopt=minrate=100k --setopt=retries=10 install golang cmake perl; then
    break
  fi
  if [ "$attempt" = 4 ]; then echo "== dnf failed 4 times; giving up" >&2; exit 1; fi
  dnf clean metadata
  sleep $((attempt * 15))
done
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none >/dev/null  # the version: rust-toolchain.toml (#104)
export PATH="$HOME/.cargo/bin:$PATH"
go version; cmake --version | head -1
cargo build --release --target-dir /tmp/core --manifest-path packages/callsign-core/Cargo.toml
cp /tmp/core/release/libqg_callsign_core.so "$1"

#!/bin/bash
# Builds Stockfish for Intel Macs from its official release tag into engine/stockfish.
# The official macOS download is a universal file whose x86_64 slice reads its network
# from the arm64 slice, so it breaks when PyInstaller thins or re-signs it for the bundle.
# Usage: scripts/build-stockfish-mac.sh [sf_19]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
tag="${1:-sf_19}"
# AVX2 covers every Intel Mac that runs macOS 11+ except the 2013 Mac Pro.
arch="${STOCKFISH_ARCH:-x86-64-avx2}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git clone --quiet --depth 1 --branch "$tag" https://github.com/official-stockfish/Stockfish.git "$work/Stockfish"
make -C "$work/Stockfish/src" -j "$(sysctl -n hw.ncpu)" build ARCH="$arch" COMP=clang >/dev/null
mkdir -p "$root/engine"
cp "$work/Stockfish/src/stockfish" "$root/engine/stockfish"
printf 'uci\nquit\n' | "$root/engine/stockfish" | grep '^id name'

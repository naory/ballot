#!/usr/bin/env bash
set -euo pipefail

# Compile circom circuits to r1cs + wasm
# Prerequisites: circom installed (https://docs.circom.io/getting-started/installation/)

CIRCUITS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$CIRCUITS_DIR/build"

mkdir -p "$BUILD_DIR"

echo "==> Compiling membership.circom"
circom "$CIRCUITS_DIR/src/membership.circom" \
  --r1cs --wasm --sym \
  -o "$BUILD_DIR"

echo "==> Compiling vote.circom"
circom "$CIRCUITS_DIR/src/vote.circom" \
  --r1cs --wasm --sym \
  -o "$BUILD_DIR"

echo "Done. Artifacts in $BUILD_DIR"

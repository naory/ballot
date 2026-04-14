#!/usr/bin/env bash
set -euo pipefail

# Compile circom circuits to r1cs + wasm
#
# Prerequisites:
#   circom  — https://docs.circom.io/getting-started/installation/
#             (install via Rust: cargo install circom)
#   circomlib — installed via npm (run `npm install` in circuits/ first)

CIRCUITS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$CIRCUITS_DIR/build"
LIB_DIR="$CIRCUITS_DIR/node_modules"

if [ ! -d "$LIB_DIR/circomlib" ]; then
  echo "Error: circomlib not found. Run 'npm install' in circuits/ first."
  exit 1
fi

mkdir -p "$BUILD_DIR"

echo "==> Compiling membership.circom"
circom "$CIRCUITS_DIR/src/membership.circom" \
  --r1cs --wasm --sym \
  -l "$LIB_DIR" \
  -o "$BUILD_DIR"

echo "==> Compiling vote.circom"
circom "$CIRCUITS_DIR/src/vote.circom" \
  --r1cs --wasm --sym \
  -l "$LIB_DIR" \
  -o "$BUILD_DIR"

echo "==> Compiling vote_with_credential.circom"
circom "$CIRCUITS_DIR/src/vote_with_credential.circom" \
  --r1cs --wasm --sym \
  -l "$LIB_DIR" \
  -o "$BUILD_DIR"

echo "Done. Artifacts in $BUILD_DIR"
echo ""
echo "Next: run 'npm run setup' to generate proving keys."

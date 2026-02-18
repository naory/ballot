#!/usr/bin/env bash
set -euo pipefail

# Trusted setup: Powers of Tau ceremony + circuit-specific key generation
# Prerequisites: snarkjs installed globally (npm i -g snarkjs)

CIRCUITS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$CIRCUITS_DIR/build"

if [ ! -d "$BUILD_DIR" ]; then
  echo "Error: build/ not found. Run compile.sh first."
  exit 1
fi

echo "==> Phase 1: Powers of Tau (BN128, 2^14)"
snarkjs powersoftau new bn128 14 "$BUILD_DIR/pot14_0000.ptau" -v
snarkjs powersoftau contribute "$BUILD_DIR/pot14_0000.ptau" "$BUILD_DIR/pot14_0001.ptau" \
  --name="First contribution" -v -e="random entropy"
snarkjs powersoftau prepare phase2 "$BUILD_DIR/pot14_0001.ptau" "$BUILD_DIR/pot14_final.ptau" -v

for CIRCUIT in membership vote; do
  echo "==> Phase 2: Setup for $CIRCUIT"
  snarkjs groth16 setup \
    "$BUILD_DIR/${CIRCUIT}.r1cs" \
    "$BUILD_DIR/pot14_final.ptau" \
    "$BUILD_DIR/${CIRCUIT}_0000.zkey"

  snarkjs zkey contribute \
    "$BUILD_DIR/${CIRCUIT}_0000.zkey" \
    "$BUILD_DIR/${CIRCUIT}_final.zkey" \
    --name="First contribution" -v -e="random entropy"

  snarkjs zkey export verificationkey \
    "$BUILD_DIR/${CIRCUIT}_final.zkey" \
    "$BUILD_DIR/${CIRCUIT}.vkey.json"

  echo "  -> $BUILD_DIR/${CIRCUIT}_final.zkey"
  echo "  -> $BUILD_DIR/${CIRCUIT}.vkey.json"
done

echo "Done. Keys ready for proving and verification."

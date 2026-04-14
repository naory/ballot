#!/usr/bin/env bash
set -euo pipefail

# Groth16 trusted setup: Phase 2 key generation using an existing Powers of Tau file.
#
# Uses the Hermez ceremony pot15_final.ptau (~86 MB) which was produced by a
# large multi-party ceremony and is widely used in production ZK applications.
# This is safe for testnet and most production deployments.
#
# For a highest-assurance mainnet deployment, run your own multi-party Phase 2
# ceremony on top of this ptau using `snarkjs zkey contribute` with multiple
# independent participants before exporting the final verification key.
#
# Prerequisites:
#   snarkjs — installed globally (npm i -g snarkjs) or via npx
#   compile.sh — must be run first to produce .r1cs files in build/

CIRCUITS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$CIRCUITS_DIR/build"
PTAU="$BUILD_DIR/pot15_final.ptau"
PTAU_URL="https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau"

if [ ! -d "$BUILD_DIR" ]; then
  echo "Error: build/ not found. Run compile.sh first."
  exit 1
fi

# ── Phase 1: Powers of Tau ────────────────────────────────────────────────────
# Download the Hermez pot15 file if not already present.
# This covers up to 2^15 = 32,768 constraints — well above our circuit's needs.

if [ ! -f "$PTAU" ]; then
  echo "==> Downloading Hermez pot15_final.ptau (~86 MB)..."
  if command -v curl &>/dev/null; then
    curl -L -o "$PTAU" "$PTAU_URL"
  elif command -v wget &>/dev/null; then
    wget -O "$PTAU" "$PTAU_URL"
  else
    echo "Error: curl or wget required to download the ptau file."
    echo "  Manually download from: $PTAU_URL"
    echo "  Place it at: $PTAU"
    exit 1
  fi
  echo "  -> $PTAU"
else
  echo "==> Using existing $PTAU"
fi

# ── Phase 2: Circuit-specific key generation ──────────────────────────────────

for CIRCUIT in membership vote vote_with_credential; do
  echo "==> Phase 2: Setup for $CIRCUIT"

  snarkjs groth16 setup \
    "$BUILD_DIR/${CIRCUIT}.r1cs" \
    "$PTAU" \
    "$BUILD_DIR/${CIRCUIT}_0000.zkey"

  # Single contribution for development/testnet.
  # For production: add more `snarkjs zkey contribute` calls from independent
  # parties before running `zkey beacon` or exporting the final key.
  snarkjs zkey contribute \
    "$BUILD_DIR/${CIRCUIT}_0000.zkey" \
    "$BUILD_DIR/${CIRCUIT}_final.zkey" \
    --name="Dev contribution" -v -e="$(head -c 32 /dev/urandom | base64)"

  snarkjs zkey export verificationkey \
    "$BUILD_DIR/${CIRCUIT}_final.zkey" \
    "$BUILD_DIR/${CIRCUIT}.vkey.json"

  echo "  -> $BUILD_DIR/${CIRCUIT}_final.zkey"
  echo "  -> $BUILD_DIR/${CIRCUIT}.vkey.json"
done

echo ""
echo "Done. Keys are ready for development and testnet use."
echo ""
echo "For production: run additional 'snarkjs zkey contribute' steps with"
echo "independent participants before exporting the final verification key."

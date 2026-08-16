/**
 * snarkjs wrapper — client-side ZK proof generation.
 *
 * Generates Groth16 proofs for:
 *   - identity-commitment voting (F1/F2) via generateVoteProofV2
 *   - idOS credential-gated voting via generateVoteWithCredentialProof
 */

// @ts-expect-error snarkjs has no type declarations
import * as snarkjs from "snarkjs";
import { poseidon2 } from "poseidon-lite";
import type { ZKProof } from "@ballot/core";
import { buildCommitmentMerkleProof, voteNullifier } from "@ballot/core";

// ---------------------------------------------------------------------------
// Legacy serial-based types — still used by generateVoteWithCredentialProof
// ---------------------------------------------------------------------------

interface ProofInput {
  merkleRoot: string;
  serial: string;
  secret: string;
  pathElements: string[];
  pathIndices: number[];
  choiceIndex: number;
}

interface ProofResult {
  proof: ZKProof;
  publicSignals: string[];
  nullifier: string;
}

interface CredentialProofInput extends ProofInput {
  credentialMerkleRoot: string;
  credentialId: string;
  credentialSecret: string;
  credentialPathElements: string[];
  credentialPathIndices: number[];
}

interface CredentialProofResult extends ProofResult {
  /** Poseidon(credentialId, credentialSecret) — prevents double-voting with same credential */
  credentialNullifier: string;
}

/**
 * Generate a ZK vote proof that also proves idOS credential membership.
 * Uses vote_with_credential.circom (5 public signals).
 *
 * Requires:
 *   /circuits/vote_with_credential_js/vote_with_credential.wasm
 *   /circuits/vote_with_credential_final.zkey
 */
export async function generateVoteWithCredentialProof(
  input: CredentialProofInput
): Promise<CredentialProofResult> {
  const wasmPath = "/circuits/vote_with_credential_js/vote_with_credential.wasm";
  const zkeyPath = "/circuits/vote_with_credential_final.zkey";

  const nullifier = poseidon2([BigInt(input.serial), BigInt(input.secret)]).toString();
  const credentialNullifier = poseidon2([
    BigInt(input.credentialId),
    BigInt(input.credentialSecret),
  ]).toString();

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      merkleRoot:             input.merkleRoot,
      nullifierHash:          nullifier,
      choiceIndex:            input.choiceIndex,
      credentialMerkleRoot:   input.credentialMerkleRoot,
      credentialNullifier,
      serial:                 input.serial,
      secret:                 input.secret,
      pathElements:           input.pathElements,
      pathIndices:            input.pathIndices,
      credentialId:           input.credentialId,
      credentialSecret:       input.credentialSecret,
      credentialPathElements: input.credentialPathElements,
      credentialPathIndices:  input.credentialPathIndices,
    },
    wasmPath,
    zkeyPath
  );

  // Public signal ordering: [merkleRoot, nullifierHash, choiceIndex, credentialMerkleRoot, credentialNullifier]
  return {
    proof: proof as ZKProof,
    publicSignals: publicSignals as string[],
    nullifier,
    credentialNullifier,
  };
}

/**
 * Generate a ZK vote proof for identity-commitment voting (F1/F2).
 * Proves membership in the poll's commitment-weight Merkle tree and produces
 * a per-poll nullifier from the identity secret.
 *
 * Requires:
 *   /circuits/vote_v2_js/vote_v2.wasm
 *   /circuits/vote_v2_final.zkey
 */
export async function generateVoteProofV2(input: {
  identitySecret: bigint;
  leaves: { commitment: string; weight: string }[];
  myCommitment: string;
  choiceIndex: number;
  pollId: bigint;
}): Promise<{ proof: ZKProof; publicSignals: string[]; nullifier: string; weight: string }> {
  const wasmPath = "/circuits/vote_v2_js/vote_v2.wasm";
  const zkeyPath = "/circuits/vote_v2_final.zkey";
  const { merkleRoot, leafIndex, pathElements, pathIndices } = buildCommitmentMerkleProof(
    input.leaves,
    input.myCommitment
  );
  const weight = input.leaves[leafIndex].weight;
  const nullifier = voteNullifier(input.identitySecret, input.pollId).toString();

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      merkleRoot,
      nullifierHash: nullifier,
      choiceIndex: input.choiceIndex,
      pollId: input.pollId.toString(),
      weight,
      identitySecret: input.identitySecret.toString(),
      pathElements,
      pathIndices,
    },
    wasmPath,
    zkeyPath
  );
  return { proof: proof as ZKProof, publicSignals: publicSignals as string[], nullifier, weight };
}

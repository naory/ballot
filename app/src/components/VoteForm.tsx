"use client";

import { useState, useEffect } from "react";
import { generateVoteProof } from "@/lib/zk";
import { fetchMerkleProof } from "@/lib/indexer";
import { getReadOnlyClient, submitVote } from "@/lib/hedera";
import type { ZKProof } from "@ballot/core";

interface VoteFormProps {
  topicId: string;
  choices: string[];
  merkleRoot: string;
}

type Step =
  | { kind: "idle" }
  | { kind: "proving" }
  | { kind: "proved"; proof: ZKProof; publicSignals: string[]; nullifier: string }
  | { kind: "submitting"; proof: ZKProof; publicSignals: string[]; nullifier: string }
  | { kind: "submitted"; nullifier: string }
  | { kind: "error"; message: string };

const SECRET_KEY = (topicId: string, serial: string) =>
  `ballot_secret_${topicId}_${serial}`;

/** Retrieve or generate a stable secret for (topicId, serial). Stored in localStorage. */
function getOrCreateSecret(topicId: string, serial: string): string {
  const key = SECRET_KEY(topicId, serial);
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  // Keep within BN254 field (< 2^254) — drop top 2 bits
  const secret = (BigInt("0x" + hex) >> 2n).toString();
  localStorage.setItem(key, secret);
  return secret;
}

export function VoteForm({ topicId, choices, merkleRoot }: VoteFormProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [serial, setSerial] = useState("");
  const [step, setStep] = useState<Step>({ kind: "idle" });

  // Warn if circuit artifacts aren't present (dev convenience)
  const [artifactsPresent, setArtifactsPresent] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/circuits/vote_js/vote.wasm", { method: "HEAD" })
      .then((r) => setArtifactsPresent(r.ok))
      .catch(() => setArtifactsPresent(false));
  }, []);

  const handleGenerateProof = async () => {
    if (selected === null || !serial.trim()) return;

    setStep({ kind: "proving" });
    try {
      // 1. Fetch Merkle proof from indexer
      const proofData = await fetchMerkleProof(topicId, serial.trim());

      // Sanity-check: merkleRoot from indexer must match what the poll page fetched
      if (proofData.merkleRoot !== merkleRoot) {
        throw new Error(
          "Merkle root mismatch — the eligible set may have changed. Refresh the page."
        );
      }

      // 2. Retrieve or generate a stable secret for this (topicId, serial) pair
      const secret = getOrCreateSecret(topicId, serial.trim());

      // 3. Generate ZK proof client-side (requires compiled circuit artifacts)
      const { proof, publicSignals, nullifier } = await generateVoteProof({
        merkleRoot:   proofData.merkleRoot,
        serial:       serial.trim(),
        secret,
        pathElements: proofData.pathElements,
        pathIndices:  proofData.pathIndices,
        choiceIndex:  selected,
      });

      setStep({ kind: "proved", proof, publicSignals, nullifier });
    } catch (err) {
      setStep({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleSubmit = async () => {
    if (step.kind !== "proved") return;
    const { proof, publicSignals, nullifier } = step;

    setStep({ kind: "submitting", proof, publicSignals, nullifier });
    try {
      // 4. Submit the vote message to the HCS topic
      // Requires a wallet-connected Hedera client (Phase 3: HashConnect integration)
      const client = getReadOnlyClient();
      await submitVote(client, topicId, {
        type:         "vote",
        pollTopicId:  topicId,
        choiceIndex:  selected!,
        nullifier,
        proof,
        publicSignals,
      });

      setStep({ kind: "submitted", nullifier });
    } catch (err) {
      setStep({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "HCS submission failed. A wallet connection (HashConnect) is required.",
      });
    }
  };

  const reset = () => {
    setStep({ kind: "idle" });
    setSelected(null);
    setSerial("");
  };

  // --- Render ---

  if (step.kind === "submitted") {
    return (
      <div className="rounded-xl border border-green-700 bg-green-950 p-5 text-sm">
        <p className="font-semibold text-green-400">Vote submitted!</p>
        <p className="mt-1 text-gray-400">
          Your nullifier:{" "}
          <code className="break-all text-xs text-gray-300">{step.nullifier}</code>
        </p>
        <button onClick={reset} className="mt-3 text-indigo-400 underline">
          Vote again (different poll)
        </button>
      </div>
    );
  }

  if (step.kind === "error") {
    return (
      <div className="rounded-xl border border-red-800 bg-red-950 p-5 text-sm">
        <p className="font-semibold text-red-400">Error</p>
        <p className="mt-1 text-gray-300">{step.message}</p>
        <button onClick={reset} className="mt-3 text-indigo-400 underline">
          Try again
        </button>
      </div>
    );
  }

  const isProving = step.kind === "proving";
  const isProved = step.kind === "proved";
  const isSubmitting = step.kind === "submitting";
  const busy = isProving || isSubmitting;

  return (
    <div className="space-y-4">
      {/* Choice selection */}
      <div className="space-y-2">
        {choices.map((choice, i) => (
          <button
            key={i}
            disabled={busy || isProved}
            onClick={() => setSelected(i)}
            className={`w-full rounded-lg border px-4 py-3 text-left transition ${
              selected === i
                ? "border-indigo-500 bg-indigo-950"
                : "border-gray-700 hover:border-gray-600 disabled:opacity-50"
            }`}
          >
            {choice}
          </button>
        ))}
      </div>

      {/* Serial input */}
      {!isProved && (
        <div>
          <label className="mb-1 block text-sm text-gray-400">
            Your NFT serial number
          </label>
          <input
            type="text"
            value={serial}
            disabled={busy}
            onChange={(e) => setSerial(e.target.value)}
            placeholder="e.g. 42"
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
          />
        </div>
      )}

      {/* Circuit artifact warning */}
      {artifactsPresent === false && (
        <p className="rounded-lg border border-yellow-800 bg-yellow-950 px-3 py-2 text-xs text-yellow-400">
          Circuit artifacts not found. Run{" "}
          <code>circuits/scripts/compile.sh</code> +{" "}
          <code>scripts/setup.sh</code> and copy outputs to{" "}
          <code>app/public/circuits/</code>.
        </p>
      )}

      {/* Step 1 — Generate proof */}
      {!isProved && (
        <button
          onClick={handleGenerateProof}
          disabled={selected === null || !serial.trim() || busy}
          className="w-full rounded-lg bg-indigo-600 py-2.5 font-medium hover:bg-indigo-500 disabled:opacity-40"
        >
          {isProving ? "Generating ZK proof…" : "Generate Proof"}
        </button>
      )}

      {/* Step 2 — Submit to HCS (shown after proof is ready) */}
      {isProved && (
        <div className="space-y-3">
          <div className="rounded-lg border border-green-800 bg-green-950 px-3 py-2 text-xs text-green-400">
            Proof generated. Your vote is ready to submit.
          </div>
          <button
            onClick={handleSubmit}
            className="w-full rounded-lg bg-green-700 py-2.5 font-medium hover:bg-green-600"
          >
            Submit Vote to HCS
          </button>
          <p className="text-xs text-gray-500">
            Submitting requires a connected Hedera wallet (HashConnect — Phase 3).
          </p>
          <button onClick={reset} className="text-xs text-gray-500 underline">
            Cancel
          </button>
        </div>
      )}

      {isSubmitting && (
        <p className="text-center text-sm text-gray-400">Submitting to HCS…</p>
      )}
    </div>
  );
}

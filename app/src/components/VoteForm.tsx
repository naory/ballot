"use client";

import { useState } from "react";
import { getIdentityProvider } from "@/lib/identity";
import { generateVoteProofV2 } from "@/lib/zk";
import { submitVote } from "@/lib/hedera";
import { pollIdFromTopic } from "@ballot/core";
import { getWalletSigner } from "@/lib/wallet";
import type { ZKProof } from "@ballot/core";

interface VoteFormProps {
  topicId: string;
  choices: string[];
  merkleRoot: string;
  /** Eligible identity commitments + weights for this poll (F1/F2). */
  leaves: { commitment: string; weight: string }[];
}

type Step =
  | { kind: "idle" }
  | { kind: "proving" }
  | { kind: "proved"; proof: ZKProof; publicSignals: string[]; nullifier: string; weight: string }
  | { kind: "submitting"; proof: ZKProof; publicSignals: string[]; nullifier: string; weight: string }
  | { kind: "submitted"; nullifier: string }
  | { kind: "error"; message: string };

export function VoteForm({ topicId, choices, merkleRoot: _merkleRoot, leaves }: VoteFormProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });

  const wallet = getWalletSigner();

  // Wallet not connected — show disabled state, keep choices visible
  if (wallet === null) {
    return (
      <div className="space-y-4">
        {/* Choice list — visible but submission disabled */}
        <div className="space-y-2">
          {choices.map((choice, i) => (
            <button
              key={i}
              disabled
              className="w-full rounded-lg border border-gray-700 px-4 py-3 text-left opacity-50"
            >
              {choice}
            </button>
          ))}
        </div>
        <p className="rounded-lg border border-yellow-800 bg-yellow-950 px-3 py-2 text-sm text-yellow-400">
          Connect a Hedera wallet to vote.
        </p>
      </div>
    );
  }

  const handleGenerateProof = async () => {
    if (selected === null) return;

    setStep({ kind: "proving" });
    try {
      const provider = getIdentityProvider(wallet.accountId, wallet.signMessage);
      const commitment = await provider.getCommitment();

      // Eligibility check: must be in the poll's committed leaf set
      if (!leaves.some((l) => l.commitment === commitment)) {
        throw new Error(
          "You're not eligible for this poll — register before the snapshot, or you didn't hold the token at snapshot."
        );
      }

      const secret = await provider.getIdentitySecret();
      const pollId = pollIdFromTopic(topicId);

      const { proof, publicSignals, nullifier, weight } = await generateVoteProofV2({
        identitySecret: secret,
        leaves,
        myCommitment: commitment,
        choiceIndex: selected,
        pollId,
      });

      setStep({ kind: "proved", proof, publicSignals, nullifier, weight });
    } catch (err) {
      setStep({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleSubmit = async () => {
    if (step.kind !== "proved") return;
    const { proof, publicSignals, nullifier, weight } = step;

    setStep({ kind: "submitting", proof, publicSignals, nullifier, weight });
    try {
      await submitVote(wallet.client, topicId, {
        type: "vote",
        pollTopicId: topicId,
        choiceIndex: selected!,
        nullifier,
        weight,
        proof,
        publicSignals,
      });

      setStep({ kind: "submitted", nullifier });
    } catch (err) {
      setStep({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const reset = () => {
    setStep({ kind: "idle" });
    setSelected(null);
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

      {/* Step 1 — Generate proof */}
      {!isProved && (
        <button
          onClick={handleGenerateProof}
          disabled={selected === null || busy}
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

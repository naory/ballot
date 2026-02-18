"use client";

import { useState } from "react";

interface VoteFormProps {
  choices: string[];
  topicId: string;
}

export function VoteForm({ choices, topicId }: VoteFormProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleVote = async () => {
    if (selected === null) return;
    setSubmitting(true);

    // TODO:
    // 1. Fetch Merkle tree for the poll from indexer
    // 2. Generate ZK proof client-side (snarkjs.groth16.fullProve)
    // 3. Submit vote message to HCS topic
    alert(
      `Vote submission not yet implemented.\nChoice: ${choices[selected]}\nTopic: ${topicId}`
    );

    setSubmitting(false);
  };

  return (
    <div className="space-y-3">
      {choices.map((choice, i) => (
        <button
          key={i}
          onClick={() => setSelected(i)}
          className={`w-full rounded-lg border px-4 py-3 text-left transition ${
            selected === i
              ? "border-indigo-500 bg-indigo-950"
              : "border-gray-700 hover:border-gray-600"
          }`}
        >
          {choice}
        </button>
      ))}
      <button
        onClick={handleVote}
        disabled={selected === null || submitting}
        className="mt-2 w-full rounded-lg bg-indigo-600 py-2.5 font-medium hover:bg-indigo-500 disabled:opacity-40"
      >
        {submitting ? "Generating proof..." : "Submit Vote"}
      </button>
    </div>
  );
}

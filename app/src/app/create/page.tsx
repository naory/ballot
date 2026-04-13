"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | { kind: "error"; message: string }
  | { kind: "done"; topicId: string; holderCount: number };

/** ISO datetime string for N days from now, rounded to the minute */
function isoInDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
}

export default function CreatePollPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [choices, setChoices] = useState(["", ""]);
  const [startsAt, setStartsAt] = useState(isoInDays(0));
  const [endsAt, setEndsAt] = useState(isoInDays(7));
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const addChoice = () => setChoices([...choices, ""]);
  const removeChoice = (i: number) =>
    setChoices(choices.filter((_, idx) => idx !== i));
  const updateChoice = (i: number, value: string) => {
    const next = [...choices];
    next[i] = value;
    setChoices(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validChoices = choices.map((c) => c.trim()).filter(Boolean);
    if (validChoices.length < 2) {
      setStatus({ kind: "error", message: "At least 2 non-empty choices are required." });
      return;
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      setStatus({ kind: "error", message: "End date must be after start date." });
      return;
    }

    setStatus({ kind: "busy", step: "Snapshotting NFT holders from Mirror Node…" });

    try {
      const res = await fetch("/api/create-poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          tokenId: tokenId.trim(),
          choices: validChoices,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((body as { error: string }).error ?? res.statusText);
      }

      const { topicId, holderCount } = (await res.json()) as {
        topicId: string;
        holderCount: number;
        merkleRoot: string;
      };

      setStatus({ kind: "done", topicId, holderCount });

      // Poll the indexer until the poll record is available (HCS consensus ~3-5s,
      // indexer polling interval ~5s), then redirect. Give up after 30s.
      const indexerBase =
        process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:4000";
      const deadline = Date.now() + 30_000;
      const waitForPoll = async () => {
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2_000));
          try {
            const check = await fetch(
              `${indexerBase}/api/polls/${encodeURIComponent(topicId)}`
            );
            if (check.ok) {
              router.push(`/poll/${encodeURIComponent(topicId)}`);
              return;
            }
          } catch {
            // indexer not yet reachable — keep waiting
          }
        }
        // Timed out — redirect anyway and let the poll page handle 404
        router.push(`/poll/${encodeURIComponent(topicId)}`);
      };
      waitForPoll();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const busy = status.kind === "busy" || status.kind === "done";

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">Create a Poll</h1>

      {status.kind === "error" && (
        <div className="mb-5 rounded-xl border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-400">
          {status.message}
          <button
            onClick={() => setStatus({ kind: "idle" })}
            className="ml-3 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {status.kind === "done" && (
        <div className="mb-5 rounded-xl border border-green-700 bg-green-950 px-4 py-3 text-sm text-green-400">
          Poll created with {status.holderCount} eligible voters. Redirecting…
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-1 block text-sm font-medium">Title</label>
          <input
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Description <span className="text-gray-500">(optional)</span>
          </label>
          <textarea
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={2}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">HTS NFT Token ID</label>
          <input
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            placeholder="0.0.XXXXXX"
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
            disabled={busy}
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            All current holders of this NFT will be eligible to vote.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Starts</label>
            <input
              type="datetime-local"
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              disabled={busy}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Ends</label>
            <input
              type="datetime-local"
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              disabled={busy}
              required
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Choices</label>
          <div className="space-y-2">
            {choices.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                  placeholder={`Choice ${i + 1}`}
                  value={c}
                  onChange={(e) => updateChoice(i, e.target.value)}
                  disabled={busy}
                />
                {choices.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeChoice(i)}
                    disabled={busy}
                    className="rounded-lg border border-gray-700 px-3 text-gray-500 hover:text-red-400 disabled:opacity-40"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addChoice}
            disabled={busy}
            className="mt-2 text-sm text-indigo-400 hover:text-indigo-300 disabled:opacity-40"
          >
            + Add choice
          </button>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-indigo-600 py-2.5 font-medium hover:bg-indigo-500 disabled:opacity-40"
        >
          {status.kind === "busy" ? status.step : "Create Poll"}
        </button>

        <p className="text-center text-xs text-gray-500">
          Requires <code>HEDERA_OPERATOR_ID</code> +{" "}
          <code>HEDERA_OPERATOR_KEY</code> on the server.
        </p>
      </form>
    </div>
  );
}

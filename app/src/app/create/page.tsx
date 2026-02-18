"use client";

import { useState } from "react";

export default function CreatePollPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [choices, setChoices] = useState(["", ""]);

  const addChoice = () => setChoices([...choices, ""]);
  const updateChoice = (i: number, value: string) => {
    const next = [...choices];
    next[i] = value;
    setChoices(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Create HCS topic, snapshot NFT holders, build Merkle tree,
    //       publish poll metadata to HCS topic
    alert("Poll creation not yet implemented — see TODO in source.");
  };

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">Create a Poll</h1>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-1 block text-sm font-medium">Title</label>
          <input
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 focus:border-indigo-500 focus:outline-none"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Description</label>
          <textarea
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 focus:border-indigo-500 focus:outline-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            HTS NFT Token ID
          </label>
          <input
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 focus:border-indigo-500 focus:outline-none"
            placeholder="0.0.XXXXXX"
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Choices</label>
          <div className="space-y-2">
            {choices.map((c, i) => (
              <input
                key={i}
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 focus:border-indigo-500 focus:outline-none"
                placeholder={`Choice ${i + 1}`}
                value={c}
                onChange={(e) => updateChoice(i, e.target.value)}
                required
              />
            ))}
          </div>
          <button
            type="button"
            onClick={addChoice}
            className="mt-2 text-sm text-indigo-400 hover:text-indigo-300"
          >
            + Add choice
          </button>
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-indigo-600 py-2.5 font-medium hover:bg-indigo-500"
        >
          Create Poll
        </button>
      </form>
    </div>
  );
}

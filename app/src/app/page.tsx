import { PollCard } from "@/components/PollCard";

/** Placeholder polls for the scaffold */
const MOCK_POLLS = [
  {
    topicId: "0.0.123456",
    title: "Community Treasury Allocation",
    description: "How should we allocate the Q1 treasury funds?",
    choices: ["Development", "Marketing", "Community Events", "Save"],
    tokenId: "0.0.654321",
    startsAt: "2025-03-01T00:00:00Z",
    endsAt: "2025-03-15T00:00:00Z",
  },
  {
    topicId: "0.0.789012",
    title: "Logo Redesign",
    description: "Pick the new project logo.",
    choices: ["Option A", "Option B", "Option C"],
    tokenId: "0.0.654321",
    startsAt: "2025-03-01T00:00:00Z",
    endsAt: "2025-04-01T00:00:00Z",
  },
];

export default function HomePage() {
  return (
    <div>
      <h1 className="mb-2 text-3xl font-bold">Active Polls</h1>
      <p className="mb-8 text-gray-400">
        Vote privately using zero-knowledge proofs. Your NFT proves eligibility
        without revealing your identity.
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        {MOCK_POLLS.map((poll) => (
          <PollCard key={poll.topicId} poll={poll} />
        ))}
      </div>
    </div>
  );
}

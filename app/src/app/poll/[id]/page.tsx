import { VoteForm } from "@/components/VoteForm";
import { Results } from "@/components/Results";

interface Props {
  params: { id: string };
}

/** Placeholder poll data — in production this comes from the indexer */
const MOCK_POLL = {
  topicId: "0.0.123456",
  title: "Community Treasury Allocation",
  description: "How should we allocate the Q1 treasury funds?",
  choices: ["Development", "Marketing", "Community Events", "Save"],
  tokenId: "0.0.654321",
  startsAt: "2025-03-01T00:00:00Z",
  endsAt: "2025-03-15T00:00:00Z",
};

const MOCK_RESULTS = {
  counts: { 0: 12, 1: 8, 2: 5, 3: 3 },
  totalVotes: 28,
};

export default function PollPage({ params }: Props) {
  const poll = MOCK_POLL; // TODO: fetch from indexer by params.id

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-2xl font-bold">{poll.title}</h1>
      {poll.description && (
        <p className="mb-1 text-gray-400">{poll.description}</p>
      )}
      <p className="mb-8 text-sm text-gray-500">
        Token gate: {poll.tokenId} &middot; Topic: {params.id}
      </p>

      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="mb-4 text-lg font-semibold">Cast Your Vote</h2>
          <VoteForm choices={poll.choices} topicId={poll.topicId} />
        </div>
        <div>
          <h2 className="mb-4 text-lg font-semibold">Results</h2>
          <Results
            choices={poll.choices}
            counts={MOCK_RESULTS.counts}
            totalVotes={MOCK_RESULTS.totalVotes}
          />
        </div>
      </div>
    </div>
  );
}

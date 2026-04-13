import { notFound } from "next/navigation";
import { VoteForm } from "@/components/VoteForm";
import { Results } from "@/components/Results";
import { fetchPoll } from "@/lib/indexer";

interface Props {
  params: { id: string };
}

export default async function PollPage({ params }: Props) {
  const topicId = decodeURIComponent(params.id);
  const poll = await fetchPoll(topicId);

  if (!poll) notFound();

  const counts = Object.fromEntries(
    poll.tally.counts.map(({ choiceIndex, count }) => [choiceIndex, count])
  ) as Record<number, number>;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-2xl font-bold">{poll.title}</h1>
      {poll.description && (
        <p className="mb-1 text-gray-400">{poll.description}</p>
      )}
      <p className="mb-8 text-sm text-gray-500">
        Token gate: {poll.tokenId} &middot; Topic: {topicId}
      </p>

      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="mb-4 text-lg font-semibold">Cast Your Vote</h2>
          <VoteForm
            topicId={topicId}
            choices={poll.choices}
            merkleRoot={poll.merkleRoot}
          />
        </div>
        <div>
          <h2 className="mb-4 text-lg font-semibold">Results</h2>
          <Results
            choices={poll.choices}
            counts={counts}
            totalVotes={poll.tally.totalVotes}
          />
        </div>
      </div>
    </div>
  );
}

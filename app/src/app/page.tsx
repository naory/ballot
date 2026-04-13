import { PollCard } from "@/components/PollCard";
import { fetchPolls } from "@/lib/indexer";

export default async function HomePage() {
  const polls = await fetchPolls();

  return (
    <div>
      <h1 className="mb-2 text-3xl font-bold">Active Polls</h1>
      <p className="mb-8 text-gray-400">
        Vote privately using zero-knowledge proofs. Your NFT proves eligibility
        without revealing your identity.
      </p>

      {polls.length === 0 ? (
        <div className="rounded-xl border border-gray-800 p-10 text-center text-gray-500">
          <p className="text-lg">No polls yet.</p>
          <p className="mt-1 text-sm">
            Create the first one or make sure the indexer is running.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {polls.map((poll) => (
            <PollCard
                key={poll.topicId}
                poll={{ ...poll, description: poll.description ?? undefined }}
              />
          ))}
        </div>
      )}
    </div>
  );
}

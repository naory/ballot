interface PollCardProps {
  poll: {
    topicId: string;
    title: string;
    description?: string;
    choices: string[];
    tokenId: string;
    endsAt: string;
  };
}

export function PollCard({ poll }: PollCardProps) {
  return (
    <a
      href={`/poll/${poll.topicId}`}
      className="block rounded-xl border border-gray-800 p-5 transition hover:border-indigo-600"
    >
      <h2 className="mb-1 text-lg font-semibold">{poll.title}</h2>
      {poll.description && (
        <p className="mb-3 text-sm text-gray-400">{poll.description}</p>
      )}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{poll.choices.length} choices</span>
        <span>Ends {new Date(poll.endsAt).toLocaleDateString()}</span>
      </div>
    </a>
  );
}

interface ResultsProps {
  choices: string[];
  counts: Record<number, number>;
  totalVotes: number;
}

export function Results({ choices, counts, totalVotes }: ResultsProps) {
  return (
    <div className="space-y-3">
      {choices.map((choice, i) => {
        const count = counts[i] ?? 0;
        const pct = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
        return (
          <div key={i}>
            <div className="mb-1 flex justify-between text-sm">
              <span>{choice}</span>
              <span className="text-gray-400">
                {count} ({pct.toFixed(1)}%)
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
      <p className="pt-2 text-sm text-gray-500">
        {totalVotes} verified vote{totalVotes !== 1 && "s"}
      </p>
    </div>
  );
}

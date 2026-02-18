/**
 * Vote counting logic.
 * Reads verified votes from SQLite and computes tallies.
 */

import { getTally as dbGetTally } from "./db.js";
import type { Tally } from "@ballot/core";

/** Compute the tally for a poll */
export function computeTally(topicId: string): Tally {
  const rows = dbGetTally(topicId);

  const counts: Record<number, number> = {};
  let totalVotes = 0;

  for (const row of rows) {
    counts[row.choiceIndex] = row.count;
    totalVotes += row.count;
  }

  return {
    topicId,
    counts,
    totalVotes,
    nullifiers: new Set(), // populated at query time if needed
  };
}

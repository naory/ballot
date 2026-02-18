/**
 * GraphQL API using Yoga.
 * Exposes polls, votes, and tally data.
 */

import { createSchema, createYoga } from "graphql-yoga";
import { createServer } from "node:http";
import { getAllPolls, getPoll } from "./db.js";
import { computeTally } from "./tally.js";

const schema = createSchema({
  typeDefs: /* GraphQL */ `
    type Poll {
      topicId: String!
      title: String!
      description: String
      choices: [String!]!
      tokenId: String!
      merkleRoot: String!
      startsAt: String!
      endsAt: String!
      creator: String
    }

    type TallyEntry {
      choiceIndex: Int!
      count: Int!
    }

    type Tally {
      topicId: String!
      totalVotes: Int!
      counts: [TallyEntry!]!
    }

    type Query {
      polls: [Poll!]!
      poll(topicId: String!): Poll
      tally(topicId: String!): Tally
    }
  `,
  resolvers: {
    Query: {
      polls: () => {
        const rows = getAllPolls() as Record<string, unknown>[];
        return rows.map(formatPoll);
      },
      poll: (_, { topicId }: { topicId: string }) => {
        const row = getPoll(topicId) as Record<string, unknown> | undefined;
        return row ? formatPoll(row) : null;
      },
      tally: (_, { topicId }: { topicId: string }) => {
        const t = computeTally(topicId);
        return {
          topicId: t.topicId,
          totalVotes: t.totalVotes,
          counts: Object.entries(t.counts).map(([choiceIndex, count]) => ({
            choiceIndex: Number(choiceIndex),
            count,
          })),
        };
      },
    },
  },
});

function formatPoll(row: Record<string, unknown>) {
  return {
    topicId: row.topic_id,
    title: row.title,
    description: row.description,
    choices: JSON.parse(row.choices as string),
    tokenId: row.token_id,
    merkleRoot: row.merkle_root,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    creator: row.creator,
  };
}

export function startApi(port = 4000): void {
  const yoga = createYoga({ schema });
  const server = createServer(yoga);
  server.listen(port, () => {
    console.log(`[api] GraphQL API at http://localhost:${port}/graphql`);
  });
}

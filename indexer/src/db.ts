/**
 * SQLite schema and queries for the indexer.
 * Uses better-sqlite3 for synchronous, fast access.
 */

import Database from "better-sqlite3";
import path from "node:path";
import type { IdosConfig, PollLeaf } from "@ballot/core";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "ballot.sqlite");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    migrate(db);
  }
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      topic_id          TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      description       TEXT,
      choices           TEXT NOT NULL, -- JSON array
      token_id          TEXT NOT NULL,
      merkle_root       TEXT NOT NULL,
      serials           TEXT,          -- JSON array of NFT serial strings (snapshot)
      starts_at         TEXT NOT NULL,
      ends_at           TEXT NOT NULL,
      creator           TEXT,
      idos_config       TEXT,          -- JSON IdosConfig (optional)
      credential_ids    TEXT,          -- JSON array of credential ID strings (snapshot)
      leaves            TEXT,          -- JSON array of PollLeaf {commitment, weight} (optional)
      created_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS votes (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id              TEXT NOT NULL REFERENCES polls(topic_id),
      choice_index          INTEGER NOT NULL,
      weight                TEXT NOT NULL DEFAULT '1',
      nullifier             TEXT NOT NULL UNIQUE,
      credential_nullifier  TEXT UNIQUE, -- Poseidon(credentialId, credentialSecret), for credential-gated polls
      proof                 TEXT NOT NULL, -- JSON
      public_signals        TEXT NOT NULL, -- JSON array
      verified              INTEGER NOT NULL DEFAULT 0,
      consensus_ts          TEXT,
      created_at            TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS registrations (
      account_id   TEXT PRIMARY KEY,
      commitment   TEXT NOT NULL,
      consensus_ts TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_votes_topic ON votes(topic_id);
    CREATE INDEX IF NOT EXISTS idx_votes_nullifier ON votes(nullifier);
  `);

  // Idempotent migrations for existing DBs (silently ignored if column already present)
  for (const sql of [
    "ALTER TABLE polls ADD COLUMN serials TEXT",
    "ALTER TABLE polls ADD COLUMN idos_config TEXT",
    "ALTER TABLE polls ADD COLUMN credential_ids TEXT",
    "ALTER TABLE polls ADD COLUMN leaves TEXT",
    "ALTER TABLE votes ADD COLUMN credential_nullifier TEXT UNIQUE",
    "ALTER TABLE votes ADD COLUMN weight TEXT NOT NULL DEFAULT '1'",
  ]) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }
}

/** Insert a poll record */
export function insertPoll(poll: {
  topicId: string;
  title: string;
  description?: string;
  choices: string[];
  tokenId: string;
  merkleRoot: string;
  serials?: string[];
  startsAt: string;
  endsAt: string;
  creator?: string;
  idosConfig?: IdosConfig;
  credentialIds?: string[];
  leaves?: PollLeaf[];
}): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO polls
      (topic_id, title, description, choices, token_id, merkle_root, serials, starts_at, ends_at, creator, idos_config, credential_ids, leaves)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    poll.topicId,
    poll.title,
    poll.description ?? null,
    JSON.stringify(poll.choices),
    poll.tokenId,
    poll.merkleRoot,
    poll.serials ? JSON.stringify(poll.serials) : null,
    poll.startsAt,
    poll.endsAt,
    poll.creator ?? null,
    poll.idosConfig ? JSON.stringify(poll.idosConfig) : null,
    poll.credentialIds ? JSON.stringify(poll.credentialIds) : null,
    poll.leaves ? JSON.stringify(poll.leaves) : null
  );
}

/** Insert a verified vote */
export function insertVote(vote: {
  topicId: string;
  choiceIndex: number;
  nullifier: string;
  weight: string;
  proof: string;
  publicSignals: string[];
  consensusTs?: string;
  credentialNullifier?: string;
}): boolean {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO votes (topic_id, choice_index, weight, nullifier, credential_nullifier, proof, public_signals, verified, consensus_ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      vote.topicId,
      vote.choiceIndex,
      vote.weight ?? "1",
      vote.nullifier,
      vote.credentialNullifier ?? null,
      vote.proof,
      JSON.stringify(vote.publicSignals),
      vote.consensusTs ?? null
    );
    return true;
  } catch {
    // UNIQUE constraint on nullifier or credential_nullifier — duplicate vote
    return false;
  }
}

/** Get tally for a poll */
export function getTally(topicId: string): { choiceIndex: number; count: number }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT choice_index as choiceIndex, CAST(SUM(CAST(weight AS INTEGER)) AS INTEGER) as count
       FROM votes WHERE topic_id = ? AND verified = 1
       GROUP BY choice_index ORDER BY choice_index`
    )
    .all(topicId) as { choiceIndex: number; count: number }[];
}

/** Get all polls */
export function getAllPolls() {
  const db = getDb();
  return db.prepare("SELECT * FROM polls ORDER BY created_at DESC").all();
}

/** Get a poll by topic ID */
export function getPoll(topicId: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM polls WHERE topic_id = ?").get(topicId);
}

/** Upsert a registration record (latest-wins on consensus_ts) */
export function upsertRegistration(r: { accountId: string; commitment: string; consensusTs: string }): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO registrations (account_id, commitment, consensus_ts)
     VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       commitment = excluded.commitment,
       consensus_ts = excluded.consensus_ts
     WHERE excluded.consensus_ts > registrations.consensus_ts`
  ).run(r.accountId, r.commitment, r.consensusTs);
}

/** Get a registration by account ID */
export function getRegistration(accountId: string): { commitment: string; consensus_ts: string } | undefined {
  const db = getDb();
  return db.prepare(`SELECT commitment, consensus_ts FROM registrations WHERE account_id = ?`).get(accountId) as
    | { commitment: string; consensus_ts: string }
    | undefined;
}

/** Get all registrations */
export function getAllRegistrations(): { account_id: string; commitment: string }[] {
  const db = getDb();
  return db.prepare(`SELECT account_id, commitment FROM registrations`).all() as
    { account_id: string; commitment: string }[];
}

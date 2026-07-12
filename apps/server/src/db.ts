import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PlayerRow {
  id: string;
  secret: string;
  name: string;
  decisions: number;
  correct: number;
  /** JSON array of booleans — the rolling rank window (≤200). */
  rolling: string;
  best_streak: number;
  rounds: number;
  net: number;
  ev_loss: number;
  rules_key: string;
  banned: number;
  created_at: number;
  updated_at: number;
  /** Opaque JSON snapshot of the client profile, for cross-device recovery. */
  profile: string;
  /** Optional email for magic-link recovery. Never shown publicly. */
  email: string | null;
  counting_decisions: number;
  counting_correct: number;
  /** JSON array of booleans — the rolling counting-rank window (≤200). */
  counting_rolling: string;
}

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      secret TEXT NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      decisions INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      rolling TEXT NOT NULL DEFAULT '[]',
      best_streak INTEGER NOT NULL DEFAULT 0,
      rounds INTEGER NOT NULL DEFAULT 0,
      net REAL NOT NULL DEFAULT 0,
      ev_loss REAL NOT NULL DEFAULT 0,
      rules_key TEXT NOT NULL DEFAULT '',
      banned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      profile TEXT NOT NULL DEFAULT '',
      email TEXT,
      counting_decisions INTEGER NOT NULL DEFAULT 0,
      counting_correct INTEGER NOT NULL DEFAULT 0,
      counting_rolling TEXT NOT NULL DEFAULT '[]'
    );
  `);
  // Migrations for databases created before these columns existed (must run
  // before anything below references the new columns).
  for (const stmt of [
    `ALTER TABLE players ADD COLUMN profile TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE players ADD COLUMN email TEXT`,
    `ALTER TABLE players ADD COLUMN counting_decisions INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE players ADD COLUMN counting_correct INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE players ADD COLUMN counting_rolling TEXT NOT NULL DEFAULT '[]'`,
  ]) {
    try {
      db.exec(stmt);
    } catch {
      // column already exists
    }
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS players_email ON players (email) WHERE email IS NOT NULL;
    CREATE TABLE IF NOT EXISTS login_tokens (
      token_hash TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  return db;
}

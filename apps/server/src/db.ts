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
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

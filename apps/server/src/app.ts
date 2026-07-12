import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { RANK_MIN_DECISIONS, computeRank } from '@perfect21/engine';
import type { PlayerRow } from './db';

const NAME_RE = /^[A-Za-z0-9 _.\-]{3,20}$/;
const RESERVED = new Set(['admin', 'moderator', 'system', 'dealer', 'perfect21', 'perfect 21']);
const ROLLING_CAP = 200;
/** Client profile snapshots are opaque, but bounded and must parse as a JSON object. */
const PROFILE_SNAPSHOT_CAP = 24_000;

function validSnapshot(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > PROFILE_SNAPSHOT_CAP) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

export interface AppOptions {
  db: DatabaseSync;
  adminToken?: string;
  /** Absolute path to the built game client; omit to skip static serving. */
  staticDir?: string;
  /** Transactional mail sender; omit to disable email recovery entirely. */
  sendMail?: (to: string, subject: string, text: string) => Promise<void>;
  /** Origin used in recovery links, e.g. https://perfect21.example. */
  publicUrl?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_MS = 15 * 60_000;

function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(name) || RESERVED.has(name.toLowerCase())) return null;
  return name;
}

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isNumIn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function publicView(row: PlayerRow) {
  const rolling = JSON.parse(row.rolling) as boolean[];
  const rank = computeRank(rolling);
  return {
    name: row.name,
    tier: rank.tier ? { id: rank.tier.id, name: rank.tier.name, color: rank.tier.color } : null,
    rollingAccuracy: rank.rollingAccuracy,
    decisions: row.decisions,
    accuracy: row.decisions > 0 ? row.correct / row.decisions : 0,
    bestStreak: row.best_streak,
    rounds: row.rounds,
    updatedAt: row.updated_at,
  };
}

export function createApp({ db, adminToken, staticDir, sendMail, publicUrl }: AppOptions) {
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  // Same-origin in production; permissive CORS keeps local dev and static
  // mirrors working. Nothing here is sensitive without a player secret.
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    next();
  });
  app.options('/api/*', (_req, res) => void res.sendStatus(204));

  // Naive per-IP write throttle: 60 mutations/minute.
  const writes = new Map<string, { count: number; resetAt: number }>();
  const throttle = (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const slot = writes.get(key);
    if (!slot || slot.resetAt < now) {
      writes.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    if (++slot.count > 60) return void res.status(429).json({ error: 'slow down' });
    next();
  };

  // Email recovery is much more abusable than stat writes: cap sends hard,
  // per IP and per address, and never reveal whether an address is registered.
  const mailSends = new Map<string, { count: number; resetAt: number }>();
  const mailAllowed = (key: string, max: number): boolean => {
    const now = Date.now();
    const slot = mailSends.get(key);
    if (!slot || slot.resetAt < now) {
      mailSends.set(key, { count: 1, resetAt: now + 3_600_000 });
      return true;
    }
    return ++slot.count <= max;
  };

  app.get('/api/health', (_req, res) => void res.json({ ok: true, email: Boolean(sendMail) }));

  /** Join the leaderboard: returns the credentials the client stores locally. */
  app.post('/api/players', throttle, (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) {
      return void res
        .status(400)
        .json({ error: 'Name must be 3-20 characters: letters, numbers, spaces, _ . -' });
    }
    const exists = db.prepare('SELECT 1 FROM players WHERE name = ?').get(name);
    if (exists) return void res.status(409).json({ error: 'That name is taken' });
    const id = randomUUID();
    const secret = randomBytes(24).toString('hex');
    const now = Date.now();
    db.prepare(
      'INSERT INTO players (id, secret, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, secret, name, now, now);
    res.status(201).json({ id, secret, name });
  });

  /** Sync a player's stats. Requires the player's secret. */
  app.put('/api/players/:id', throttle, (req, res) => {
    const row = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id) as
      | PlayerRow
      | undefined;
    const secret = req.body?.secret;
    if (!row || typeof secret !== 'string' || !safeEqual(secret, row.secret)) {
      return void res.status(403).json({ error: 'unknown player or bad secret' });
    }
    if (row.banned) return void res.status(403).json({ error: 'account banned' });

    const b = req.body ?? {};
    const rolling = b.rolling;
    if (
      !isIntIn(b.decisions, row.decisions, row.decisions + 100_000) ||
      !isIntIn(b.correct, row.correct, b.decisions) ||
      !isIntIn(b.bestStreak, row.best_streak, 1_000_000) ||
      !isIntIn(b.rounds, row.rounds, row.rounds + 100_000) ||
      !isNumIn(b.net, -b.rounds * 10, b.rounds * 10) ||
      !isNumIn(b.evLoss, -b.decisions, b.decisions) ||
      !Array.isArray(rolling) ||
      rolling.length > ROLLING_CAP ||
      !rolling.every((x: unknown) => typeof x === 'boolean') ||
      typeof (b.rulesKey ?? '') !== 'string' ||
      (b.profile !== undefined && !validSnapshot(b.profile))
    ) {
      return void res.status(400).json({ error: 'invalid stats payload' });
    }

    db.prepare(
      `UPDATE players SET decisions=?, correct=?, rolling=?, best_streak=?, rounds=?, net=?,
         ev_loss=?, rules_key=?, profile=?, updated_at=? WHERE id=?`
    ).run(
      b.decisions,
      b.correct,
      JSON.stringify(rolling),
      b.bestStreak,
      b.rounds,
      b.net,
      b.evLoss,
      String(b.rulesKey ?? '').slice(0, 60),
      typeof b.profile === 'string' ? b.profile : row.profile,
      Date.now(),
      row.id
    );
    res.json({ ok: true });
  });

  /**
   * Cross-device recovery: the id+secret pair (shown to players as a recovery
   * code) returns the account and its last-synced profile snapshot. POST so
   * the secret stays out of URLs and logs.
   */
  app.post('/api/players/recover', throttle, (req, res) => {
    const id = req.body?.id;
    const secret = req.body?.secret;
    if (typeof id !== 'string' || typeof secret !== 'string') {
      return void res.status(400).json({ error: 'invalid recovery code' });
    }
    const row = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow | undefined;
    if (!row || !safeEqual(secret, row.secret)) {
      return void res.status(403).json({ error: 'unknown player or bad recovery code' });
    }
    if (row.banned) return void res.status(403).json({ error: 'account banned' });
    let snapshot: unknown = null;
    try {
      snapshot = row.profile ? JSON.parse(row.profile) : null;
    } catch {
      snapshot = null;
    }
    res.json({
      id: row.id,
      name: row.name,
      profile: snapshot,
      // Fallback for accounts synced before profile snapshots existed.
      stats: {
        decisions: row.decisions,
        correct: row.correct,
        rolling: JSON.parse(row.rolling) as boolean[],
        bestStreak: row.best_streak,
        rounds: row.rounds,
        net: row.net,
        evLoss: row.ev_loss,
      },
    });
  });

  // ---- optional email account (magic links, no passwords) ----

  /** Attach (or detach with email: null) the recovery email. Requires the secret. */
  app.put('/api/players/:id/email', throttle, (req, res) => {
    const row = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id) as
      | PlayerRow
      | undefined;
    const secret = req.body?.secret;
    if (!row || typeof secret !== 'string' || !safeEqual(secret, row.secret)) {
      return void res.status(403).json({ error: 'unknown player or bad secret' });
    }
    if (row.banned) return void res.status(403).json({ error: 'account banned' });
    if (req.body?.email === null) {
      db.prepare('UPDATE players SET email = NULL WHERE id = ?').run(row.id);
      return void res.json({ ok: true, email: null });
    }
    const email = cleanEmail(req.body?.email);
    if (!email) return void res.status(400).json({ error: 'invalid email address' });
    const taken = db
      .prepare('SELECT 1 FROM players WHERE email = ? AND id != ?')
      .get(email, row.id);
    if (taken) {
      return void res.status(409).json({ error: 'that email is linked to another player' });
    }
    db.prepare('UPDATE players SET email = ? WHERE id = ?').run(email, row.id);
    res.json({ ok: true, email });
  });

  /** Send a magic recovery link. Always claims success — no address enumeration. */
  app.post('/api/recover/email', throttle, (req, res) => {
    if (!sendMail) {
      return void res
        .status(503)
        .json({ error: 'email recovery is not configured on this server' });
    }
    const email = cleanEmail(req.body?.email);
    if (!email) return void res.status(400).json({ error: 'invalid email address' });
    if (!mailAllowed(`ip:${req.ip ?? 'unknown'}`, 6) || !mailAllowed(`to:${email}`, 3)) {
      return void res.status(429).json({ error: 'too many recovery emails — try again later' });
    }
    const row = db.prepare('SELECT * FROM players WHERE email = ? AND banned = 0').get(email) as
      | PlayerRow
      | undefined;
    const now = Date.now();
    db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').run(now);
    if (row) {
      const raw = randomBytes(32).toString('hex');
      db.prepare(
        'INSERT INTO login_tokens (token_hash, player_id, expires_at) VALUES (?, ?, ?)'
      ).run(hashToken(raw), row.id, now + TOKEN_TTL_MS);
      const link = `${(publicUrl ?? '').replace(/\/$/, '')}/#recover=${raw}`;
      void sendMail(
        email,
        'Restore your Perfect 21 progress',
        `Someone asked to restore the Perfect 21 progress linked to this email ` +
          `(player "${row.name}").\n\nOpen this link on the device you want to play on:\n\n` +
          `${link}\n\nThe link works once and expires in 15 minutes. ` +
          `If this wasn't you, ignore this email — nothing changes.`
      ).catch(() => {
        // Sending is best-effort; the client message stays the same either way.
      });
    }
    res.json({ ok: true });
  });

  /** Trade a magic-link token for the account and its profile snapshot. */
  app.post('/api/recover/claim', throttle, (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) {
      return void res.status(400).json({ error: 'invalid recovery link' });
    }
    const now = Date.now();
    const hash = hashToken(token);
    const entry = db
      .prepare('SELECT * FROM login_tokens WHERE token_hash = ? AND expires_at >= ?')
      .get(hash, now) as { player_id: string } | undefined;
    // Single use: gone whether or not the claim succeeds further down.
    db.prepare('DELETE FROM login_tokens WHERE token_hash = ?').run(hash);
    const row = entry
      ? (db.prepare('SELECT * FROM players WHERE id = ?').get(entry.player_id) as
          | PlayerRow
          | undefined)
      : undefined;
    if (!row || row.banned) {
      return void res.status(403).json({ error: 'this recovery link is invalid or expired' });
    }
    let snapshot: unknown = null;
    try {
      snapshot = row.profile ? JSON.parse(row.profile) : null;
    } catch {
      snapshot = null;
    }
    res.json({
      id: row.id,
      secret: row.secret,
      name: row.name,
      email: row.email,
      profile: snapshot,
      stats: {
        decisions: row.decisions,
        correct: row.correct,
        rolling: JSON.parse(row.rolling) as boolean[],
        bestStreak: row.best_streak,
        rounds: row.rounds,
        net: row.net,
        evLoss: row.ev_loss,
      },
    });
  });

  app.get('/api/leaderboard', (_req, res) => {
    const rows = db
      .prepare('SELECT * FROM players WHERE banned = 0 AND decisions >= ?')
      .all(RANK_MIN_DECISIONS) as unknown as PlayerRow[];
    const players = rows
      .map(publicView)
      .sort(
        (a, b) =>
          b.rollingAccuracy - a.rollingAccuracy ||
          b.decisions - a.decisions ||
          b.bestStreak - a.bestStreak
      )
      .slice(0, 100);
    const streaks = rows
      .map(publicView)
      .filter((p) => p.bestStreak > 0)
      .sort((a, b) => b.bestStreak - a.bestStreak || b.rollingAccuracy - a.rollingAccuracy)
      .slice(0, 20)
      .map((p) => ({ name: p.name, bestStreak: p.bestStreak, tier: p.tier }));
    res.json({ players, streaks, minDecisions: RANK_MIN_DECISIONS });
  });

  // ---- admin ----

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!adminToken) return void res.status(503).json({ error: 'admin disabled: set ADMIN_TOKEN' });
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !safeEqual(token, adminToken)) {
      return void res.status(401).json({ error: 'bad admin token' });
    }
    next();
  };

  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    const agg = db
      .prepare(
        `SELECT COUNT(*) AS players,
                COALESCE(SUM(decisions),0) AS decisions,
                COALESCE(SUM(correct),0) AS correct,
                COALESCE(SUM(rounds),0) AS rounds,
                COALESCE(SUM(net),0) AS net,
                COALESCE(SUM(banned),0) AS banned
         FROM players`
      )
      .get() as Record<string, number>;
    const day = Date.now() - 86_400_000;
    const active = db
      .prepare('SELECT COUNT(*) AS n FROM players WHERE updated_at > ?')
      .get(day) as { n: number };
    res.json({
      players: agg.players,
      banned: agg.banned,
      activeToday: active.n,
      decisions: agg.decisions,
      accuracy: agg.decisions > 0 ? agg.correct / agg.decisions : null,
      rounds: agg.rounds,
      net: agg.net,
    });
  });

  app.get('/api/admin/players', requireAdmin, (_req, res) => {
    const rows = db
      .prepare('SELECT * FROM players ORDER BY updated_at DESC LIMIT 500')
      .all() as unknown as PlayerRow[];
    res.json({
      players: rows.map((r) => ({
        id: r.id,
        ...publicView(r),
        banned: !!r.banned,
        rulesKey: r.rules_key,
        createdAt: r.created_at,
        email: r.email ?? null,
      })),
    });
  });

  app.delete('/api/admin/players/:id', requireAdmin, (req, res) => {
    const info = db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
    res.json({ deleted: info.changes > 0 });
  });

  app.post('/api/admin/players/:id/ban', requireAdmin, (req, res) => {
    const banned = req.body?.banned === true ? 1 : 0;
    const info = db.prepare('UPDATE players SET banned = ? WHERE id = ?').run(banned, req.params.id);
    res.json({ updated: info.changes > 0, banned: !!banned });
  });

  // ---- static site ----

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(join(staticDir, 'index.html'));
    });
  }

  return app;
}

export function defaultStaticDir(): string {
  return fileURLToPath(new URL('../../game/dist', import.meta.url));
}

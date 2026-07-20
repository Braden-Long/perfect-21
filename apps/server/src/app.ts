import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { RANK_MIN_DECISIONS, computeRank } from '@perfect21/engine';
import { sha256Hex } from './db';
import type { PlayerRow } from './db';
import { SOLANA_ADDRESS_RE } from './solana';
import type { DonationChecker } from './solana';

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
  /** Solana donation lookup (deck-skin goals); omit to disable the feature. */
  checkDonations?: DonationChecker;
  /** The tip wallet donations arrive at — advertised to clients via /api/health. */
  solanaTipAddress?: string;
  /**
   * Express `trust proxy` setting. Enable (e.g. `1` behind one reverse proxy)
   * only when actually deployed behind a proxy, so the per-IP throttle keys on
   * the real client IP. Leave undefined when directly exposed — otherwise a
   * client could spoof `X-Forwarded-For` and evade the throttle.
   */
  trustProxy?: boolean | number | string;
}

/**
 * Parse the TRUST_PROXY env string into Express's `trust proxy` value.
 * Case-insensitive; `''`/unset → undefined (don't touch Express's default).
 * Hop counts above MAX_PROXY_HOPS throw: a typo'd subnet like `10000000`
 * would otherwise silently trust arbitrarily long X-Forwarded-For chains and
 * let clients spoof req.ip past the throttle this setting exists to protect.
 */
export const MAX_PROXY_HOPS = 10;
export function parseTrustProxy(raw: string | undefined): boolean | number | string | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (n > MAX_PROXY_HOPS) {
      throw new Error(
        `TRUST_PROXY=${raw}: hop count ${n} is implausibly large (max ${MAX_PROXY_HOPS}) — ` +
          `did you mean a subnet like 10.0.0.0/8?`
      );
    }
    return n;
  }
  // Subnet or keyword ('loopback', '10.0.0.0/8', …) — Express validates it.
  return v;
}

/**
 * Response security headers. The site has no inline <script> (only a module
 * src) so `script-src 'self'` holds; React sets inline `style=` attributes, so
 * `style-src` keeps `'unsafe-inline'`. `frame-ancestors 'none'` (plus the
 * legacy X-Frame-Options) blocks clickjacking; HSTS is ignored by browsers
 * over plain HTTP, so it's safe to send unconditionally.
 *
 * The CSP constrains the CLIENT the server serves — and the Vite dev server
 * does NOT send it (dev needs Vite's inline scripts), so external resources
 * added to apps/game work in dev but break in production. A note in
 * apps/game/index.html points here, and apps/game/test/csp.test.ts scans the
 * built bundle for external origins.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_MS = 15 * 60_000;

function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

const hashToken = sha256Hex;

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

/** Check a client-supplied secret against the stored hash. */
function secretOk(provided: unknown, row: PlayerRow): boolean {
  return (
    typeof provided === 'string' &&
    typeof row.secret_hash === 'string' &&
    safeEqual(sha256Hex(provided), row.secret_hash)
  );
}

function publicView(row: PlayerRow) {
  const rolling = JSON.parse(row.rolling) as boolean[];
  const rank = computeRank(rolling);
  const countingRank = computeRank(JSON.parse(row.counting_rolling ?? '[]') as boolean[]);
  return {
    name: row.name,
    tier: rank.tier ? { id: rank.tier.id, name: rank.tier.name, color: rank.tier.color } : null,
    rollingAccuracy: rank.rollingAccuracy,
    decisions: row.decisions,
    accuracy: row.decisions > 0 ? row.correct / row.decisions : 0,
    bestStreak: row.best_streak,
    rounds: row.rounds,
    // Day precision only: the exact timestamp is a "when was this person
    // online" leak on a public endpoint. Admin views override with the real one.
    updatedAt: Math.floor(row.updated_at / 86_400_000) * 86_400_000,
    countingTier: countingRank.tier
      ? { id: countingRank.tier.id, name: countingRank.tier.name, color: countingRank.tier.color }
      : null,
    countingAccuracy: countingRank.rollingAccuracy,
    countingDecisions: row.counting_decisions ?? 0,
  };
}

export function createApp({
  db,
  adminToken,
  staticDir,
  sendMail,
  publicUrl,
  checkDonations,
  solanaTipAddress,
  trustProxy,
}: AppOptions) {
  const app = express();
  // Only trust proxy headers when explicitly configured (see AppOptions): the
  // throttle keys on req.ip, which reflects X-Forwarded-For only when trusted.
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);

  // Constant headers on every response, in one hop registered before
  // express.json so even a body-parser error (413 too large, 400 malformed
  // JSON) carries all of them:
  // - security: CSP, anti-clickjacking, no MIME sniffing, no referrer leak
  //   (harmless on API JSON, essential on the served HTML);
  // - CORS: same-origin in production; permissive CORS keeps local dev and
  //   static mirrors working — nothing here is sensitive without a player
  //   secret.
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    next();
  });

  app.use(express.json({ limit: '32kb' }));
  app.options('/api/*', (_req, res) => void res.sendStatus(204));

  // Expired throttle slots are only ever overwritten per key, so without a
  // sweep the maps grow by one entry per IP/address ever seen. Swept lazily
  // when a map gets big — no timers to leak in tests.
  const SWEEP_AT = 1_000;
  const sweepExpired = (map: Map<string, { count: number; resetAt: number }>) => {
    const now = Date.now();
    for (const [key, slot] of map) if (slot.resetAt < now) map.delete(key);
  };

  // Naive per-IP write throttle: 60 mutations/minute.
  const writes = new Map<string, { count: number; resetAt: number }>();
  const throttle = (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const slot = writes.get(key);
    if (!slot || slot.resetAt < now) {
      if (writes.size >= SWEEP_AT) sweepExpired(writes);
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
      if (mailSends.size >= SWEEP_AT) sweepExpired(mailSends);
      mailSends.set(key, { count: 1, resetAt: now + 3_600_000 });
      return true;
    }
    return ++slot.count <= max;
  };

  // /api/leaderboard runs three full-table scans (plus a JSON.parse per row)
  // and needs no auth, making it the cheapest endpoint to hammer. A short
  // cache, busted by every stats write, absorbs bursts without serving stale
  // standings.
  const BOARD_CACHE_MS = 15_000;
  let boardCache: { body: object; at: number } | null = null;
  const bustBoardCache = () => {
    boardCache = null;
  };

  app.get('/api/health', (_req, res) =>
    void res.json({
      ok: true,
      email: Boolean(sendMail),
      // Non-null advertises the deck-skin donation goals AND tells the client
      // exactly which address is being scanned — no second config to drift.
      solana: (checkDonations && solanaTipAddress) || null,
    })
  );

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
    try {
      // Only the hash is stored; the plaintext lives with the client alone.
      db.prepare(
        'INSERT INTO players (id, secret_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, sha256Hex(secret), name, now, now);
    } catch {
      // Concurrent claim of the same name: the UNIQUE constraint is the
      // authority, the SELECT above is just the friendly fast path.
      return void res.status(409).json({ error: 'That name is taken' });
    }
    bustBoardCache();
    res.status(201).json({ id, secret, name });
  });

  /** Sync a player's stats. Requires the player's secret. */
  app.put('/api/players/:id', throttle, (req, res) => {
    const row = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id) as
      | PlayerRow
      | undefined;
    if (!row || !secretOk(req.body?.secret, row)) {
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
      // Cumulative EV given away: monotonic like every other lifetime counter.
      !isNumIn(b.evLoss, row.ev_loss, b.decisions) ||
      !Array.isArray(rolling) ||
      rolling.length > ROLLING_CAP ||
      !rolling.every((x: unknown) => typeof x === 'boolean') ||
      typeof (b.rulesKey ?? '') !== 'string' ||
      (b.profile !== undefined && !validSnapshot(b.profile))
    ) {
      return void res.status(400).json({ error: 'invalid stats payload' });
    }
    // Counting-rank fields arrived later and stay optional.
    const cd = b.countingDecisions ?? row.counting_decisions ?? 0;
    const cc = b.countingCorrect ?? row.counting_correct ?? 0;
    const cRolling = b.countingRolling ?? JSON.parse(row.counting_rolling ?? '[]');
    if (
      !isIntIn(cd, row.counting_decisions ?? 0, (row.counting_decisions ?? 0) + 100_000) ||
      !isIntIn(cc, 0, cd) ||
      !Array.isArray(cRolling) ||
      cRolling.length > ROLLING_CAP ||
      !cRolling.every((x: unknown) => typeof x === 'boolean')
    ) {
      return void res.status(400).json({ error: 'invalid counting payload' });
    }

    db.prepare(
      `UPDATE players SET decisions=?, correct=?, rolling=?, best_streak=?, rounds=?, net=?,
         ev_loss=?, rules_key=?, profile=?, counting_decisions=?, counting_correct=?,
         counting_rolling=?, updated_at=? WHERE id=?`
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
      cd,
      cc,
      JSON.stringify(cRolling),
      Date.now(),
      row.id
    );
    bustBoardCache();
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
    if (!row || !secretOk(secret, row)) {
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
      wallet: row.wallet ?? null,
      donatedUsd: row.donated_usd ?? 0,
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
    if (!row || !secretOk(req.body?.secret, row)) {
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
    try {
      db.prepare('UPDATE players SET email = ? WHERE id = ?').run(email, row.id);
    } catch {
      // Concurrent attach of the same address: the partial UNIQUE index wins.
      return void res.status(409).json({ error: 'that email is linked to another player' });
    }
    res.json({ ok: true, email });
  });

  // ---- deck-skin donation goals (optional, Solana) ----

  /**
   * Link (or unlink with wallet: null) the Solana address the player donates
   * from. First come, first served per address, like emails: senders are
   * attributed by on-chain `from` address, which can't be forged, but an
   * address can only back one account.
   */
  app.put('/api/players/:id/wallet', throttle, (req, res) => {
    const row = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id) as
      | PlayerRow
      | undefined;
    if (!row || !secretOk(req.body?.secret, row)) {
      return void res.status(403).json({ error: 'unknown player or bad secret' });
    }
    if (row.banned) return void res.status(403).json({ error: 'account banned' });
    if (req.body?.wallet === null) {
      db.prepare('UPDATE players SET wallet = NULL WHERE id = ?').run(row.id);
      return void res.json({ ok: true, wallet: null });
    }
    const wallet = typeof req.body?.wallet === 'string' ? req.body.wallet.trim() : '';
    if (!SOLANA_ADDRESS_RE.test(wallet)) {
      return void res.status(400).json({ error: 'that does not look like a Solana address' });
    }
    if (wallet === solanaTipAddress) {
      return void res.status(400).json({ error: 'that is the tip jar itself — link the wallet you send from' });
    }
    const taken = db.prepare('SELECT 1 FROM players WHERE wallet = ? AND id != ?').get(wallet, row.id);
    if (taken) {
      return void res.status(409).json({ error: 'that wallet is linked to another player' });
    }
    try {
      db.prepare('UPDATE players SET wallet = ? WHERE id = ?').run(wallet, row.id);
    } catch {
      return void res.status(409).json({ error: 'that wallet is linked to another player' });
    }
    res.json({ ok: true, wallet });
  });

  /**
   * Re-scan the chain and credit the player's donation total. The credited
   * value is monotonic: SOL is valued at the CURRENT price, so a price dip
   * must never take a skin away that an earlier scan granted.
   */
  app.post('/api/players/:id/donations', throttle, (req, res) => {
    if (!checkDonations) {
      return void res.status(503).json({ error: 'donation goals are not configured on this server' });
    }
    const row = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id) as
      | PlayerRow
      | undefined;
    if (!row || !secretOk(req.body?.secret, row)) {
      return void res.status(403).json({ error: 'unknown player or bad secret' });
    }
    if (row.banned) return void res.status(403).json({ error: 'account banned' });
    if (!row.wallet) {
      return void res.status(400).json({ error: 'link the wallet you donate from first' });
    }
    checkDonations(row.wallet)
      .then((scan) => {
        const credited = Math.max(row.donated_usd ?? 0, scan.usd);
        db.prepare('UPDATE players SET donated_usd = ? WHERE id = ?').run(credited, row.id);
        res.json({ ok: true, donatedUsd: credited, sol: scan.sol, usdc: scan.usdc });
      })
      .catch(() => {
        res.status(502).json({ error: 'could not reach the Solana network — try again in a minute' });
      });
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
    // Rotate the secret on every claim: the server only stores hashes, so a
    // fresh plaintext must be minted to hand to the claiming device. Side
    // effect (deliberate): other devices and previously written-down recovery
    // codes stop working — whoever holds the emailed link owns the account.
    const secret = randomBytes(24).toString('hex');
    db.prepare('UPDATE players SET secret_hash = ? WHERE id = ?').run(sha256Hex(secret), row.id);
    let snapshot: unknown = null;
    try {
      snapshot = row.profile ? JSON.parse(row.profile) : null;
    } catch {
      snapshot = null;
    }
    res.json({
      id: row.id,
      secret,
      name: row.name,
      email: row.email,
      wallet: row.wallet ?? null,
      donatedUsd: row.donated_usd ?? 0,
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
    if (boardCache && Date.now() - boardCache.at < BOARD_CACHE_MS) {
      return void res.json(boardCache.body);
    }
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
    // The endless board is its own game: a long run is proof of volume, so it
    // doesn't wait for the accuracy-rank decision floor.
    const streakRows = db
      .prepare('SELECT * FROM players WHERE banned = 0 AND best_streak > 0')
      .all() as unknown as PlayerRow[];
    const streaks = streakRows
      .map(publicView)
      .sort((a, b) => b.bestStreak - a.bestStreak || b.rollingAccuracy - a.rollingAccuracy)
      .slice(0, 20)
      .map((p) => ({ name: p.name, bestStreak: p.bestStreak, tier: p.tier }));
    // Card counters rank on their own window (index plays + insurance calls).
    const counterRows = db
      .prepare('SELECT * FROM players WHERE banned = 0 AND counting_decisions >= ?')
      .all(RANK_MIN_DECISIONS) as unknown as PlayerRow[];
    const counters = counterRows
      .map(publicView)
      .sort((a, b) => b.countingAccuracy - a.countingAccuracy || b.countingDecisions - a.countingDecisions)
      .slice(0, 100)
      .map((p) => ({
        name: p.name,
        tier: p.countingTier,
        rollingAccuracy: p.countingAccuracy,
        decisions: p.countingDecisions,
      }));
    const body = { players, streaks, counters, minDecisions: RANK_MIN_DECISIONS };
    boardCache = { body, at: Date.now() };
    res.json(body);
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
        updatedAt: r.updated_at,
        banned: !!r.banned,
        rulesKey: r.rules_key,
        createdAt: r.created_at,
        email: r.email ?? null,
        wallet: r.wallet ?? null,
        donatedUsd: r.donated_usd ?? 0,
        // Admin-only: lifetime net units, for spotting anomalous accounts.
        net: r.net,
      })),
    });
  });

  app.delete('/api/admin/players/:id', requireAdmin, (req, res) => {
    const info = db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
    // Outstanding magic-link tokens die with the account (claim would 403 on
    // the missing player anyway; this is hygiene, not a security gate).
    db.prepare('DELETE FROM login_tokens WHERE player_id = ?').run(req.params.id);
    bustBoardCache();
    res.json({ deleted: info.changes > 0 });
  });

  app.post('/api/admin/players/:id/ban', requireAdmin, (req, res) => {
    const banned = req.body?.banned === true ? 1 : 0;
    const info = db.prepare('UPDATE players SET banned = ? WHERE id = ?').run(banned, req.params.id);
    bustBoardCache();
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

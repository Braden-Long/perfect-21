import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MAX_PROXY_HOPS, createApp, parseTrustProxy } from '../src/app';
import { openDb, sha256Hex } from '../src/db';

let server: Server;
let base: string;
const ADMIN = 'test-admin-token';

beforeAll(async () => {
  const app = createApp({ db: openDb(':memory:'), adminToken: ADMIN });
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const addr = server.address();
  if (typeof addr === 'string' || !addr) throw new Error('no port');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function json(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

function stats(over: Record<string, unknown> = {}) {
  return {
    decisions: 60,
    correct: 57,
    rolling: Array.from({ length: 60 }, (_, i) => i % 20 !== 0),
    bestStreak: 12,
    rounds: 25,
    net: 3.5,
    evLoss: 0.4,
    rulesKey: '8d-s17-all-das1-none-peek1',
    ...over,
  };
}

describe('security headers', () => {
  it('sends CSP + anti-clickjacking/nosniff/referrer/HSTS on every response', async () => {
    const res = await fetch(base + '/api/health');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('still sends the headers when the JSON body parser rejects the request', async () => {
    // Malformed JSON makes express.json() error before routing; because the
    // headers middleware runs first, the 400 still carries our anti-clickjacking
    // / referrer / HSTS headers. (Express's finalhandler hardens CSP further to
    // default-src 'none' on error pages, which is strictly safer than ours.)
    const res = await fetch(base + '/api/players', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not valid json',
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('content-security-policy') ?? '').toContain('default-src');
    // CORS shares the pre-parser middleware, so cross-origin callers can read
    // even parser errors.
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('parseTrustProxy', () => {
  it('maps env strings to Express trust-proxy values', () => {
    expect(parseTrustProxy(undefined)).toBeUndefined();
    expect(parseTrustProxy('')).toBeUndefined();
    expect(parseTrustProxy('  ')).toBeUndefined();
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('True')).toBe(true); // env-file conventions vary
    expect(parseTrustProxy('FALSE')).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('01')).toBe(1); // must not reach proxy-addr as a string
    expect(parseTrustProxy(' 2 ')).toBe(2);
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(parseTrustProxy('loopback')).toBe('loopback');
  });

  it('rejects implausible hop counts instead of trusting arbitrary X-Forwarded-For chains', () => {
    expect(() => parseTrustProxy('10000000')).toThrow(/TRUST_PROXY/);
    expect(parseTrustProxy(String(MAX_PROXY_HOPS))).toBe(MAX_PROXY_HOPS);
    expect(() => parseTrustProxy(String(MAX_PROXY_HOPS + 1))).toThrow(/hop count/);
  });
});

describe('players API', () => {
  let id: string;
  let secret: string;

  it('creates a player with valid name', async () => {
    const r = await json('POST', '/api/players', { name: 'Card Shark 21' });
    expect(r.status).toBe(201);
    expect(r.body.id).toBeTruthy();
    expect(r.body.secret).toBeTruthy();
    id = r.body.id;
    secret = r.body.secret;
  });

  it('rejects bad and duplicate names', async () => {
    expect((await json('POST', '/api/players', { name: 'x' })).status).toBe(400);
    expect((await json('POST', '/api/players', { name: 'admin' })).status).toBe(400);
    expect((await json('POST', '/api/players', { name: '<script>' })).status).toBe(400);
    expect((await json('POST', '/api/players', { name: 'card shark 21' })).status).toBe(409);
  });

  it('syncs stats with the right secret only', async () => {
    expect((await json('PUT', `/api/players/${id}`, { secret: 'wrong', ...stats() })).status).toBe(403);
    const ok = await json('PUT', `/api/players/${id}`, { secret, ...stats() });
    expect(ok.status).toBe(200);
  });

  it('rejects regressions and nonsense payloads', async () => {
    // decisions cannot shrink
    expect(
      (await json('PUT', `/api/players/${id}`, { secret, ...stats({ decisions: 10, correct: 5 }) })).status
    ).toBe(400);
    // correct cannot exceed decisions
    expect(
      (await json('PUT', `/api/players/${id}`, { secret, ...stats({ decisions: 70, correct: 71 }) })).status
    ).toBe(400);
    // rolling must be booleans
    expect(
      (await json('PUT', `/api/players/${id}`, { secret, ...stats({ decisions: 70, rolling: [1, 2] }) })).status
    ).toBe(400);
  });

  it('exposes ranked players on the leaderboard', async () => {
    const r = await json('GET', '/api/leaderboard');
    expect(r.status).toBe(200);
    expect(r.body.players).toHaveLength(1);
    const p = r.body.players[0];
    expect(p.name).toBe('Card Shark 21');
    expect(p.tier.id).toBe('gold'); // 57/60 = 95%
    expect(p.bestStreak).toBe(12);
    expect(p).not.toHaveProperty('id');
    expect(p).not.toHaveProperty('secret');
    expect(r.body.streaks[0].bestStreak).toBe(12);
  });

  it('syncs counting stats and ranks counters on their own board', async () => {
    const counting = {
      countingDecisions: 60,
      countingCorrect: 59,
      countingRolling: Array.from({ length: 60 }, (_, i) => i !== 0),
    };
    const ok = await json('PUT', `/api/players/${id}`, {
      secret,
      ...stats({ decisions: 80, correct: 76 }),
      ...counting,
    });
    expect(ok.status).toBe(200);
    // Counting counters are monotonic too.
    expect(
      (
        await json('PUT', `/api/players/${id}`, {
          secret,
          ...stats({ decisions: 81, correct: 77 }),
          ...counting,
          countingDecisions: 10,
        })
      ).status
    ).toBe(400);

    const board = await json('GET', '/api/leaderboard');
    expect(board.body.counters).toHaveLength(1);
    expect(board.body.counters[0].name).toBe('Card Shark 21');
    expect(board.body.counters[0].tier.id).toBe('platinum'); // 59/60 = 98.3%, below diamond's 98.5%
    expect(board.body.counters[0].decisions).toBe(60);
  });

  it('hides players below the minimum decision count', async () => {
    const r2 = await json('POST', '/api/players', { name: 'Newbie' });
    await json('PUT', `/api/players/${r2.body.id}`, {
      secret: r2.body.secret,
      ...stats({ decisions: 10, correct: 10, rolling: Array(10).fill(true), rounds: 4, bestStreak: 3 }),
    });
    const board = await json('GET', '/api/leaderboard');
    expect(board.body.players.map((p: any) => p.name)).not.toContain('Newbie');
  });
});

describe('admin API', () => {
  it('requires the token', async () => {
    expect((await json('GET', '/api/admin/overview')).status).toBe(401);
    expect((await json('GET', '/api/admin/overview', undefined, 'nope')).status).toBe(401);
  });

  it('reports an overview', async () => {
    const r = await json('GET', '/api/admin/overview', undefined, ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.players).toBe(2);
    expect(r.body.decisions).toBe(90); // 80 (Card Shark, after the counting sync) + 10 (Newbie)
  });

  it('lists, bans and deletes players', async () => {
    const list = await json('GET', '/api/admin/players', undefined, ADMIN);
    expect(list.body.players).toHaveLength(2);
    const target = list.body.players.find((p: any) => p.name === 'Newbie');

    const ban = await json('POST', `/api/admin/players/${target.id}/ban`, { banned: true }, ADMIN);
    expect(ban.body.banned).toBe(true);

    // banned players cannot sync and are hidden from the board
    const banned = (await json('GET', '/api/admin/players', undefined, ADMIN)).body.players.find(
      (p: any) => p.id === target.id
    );
    expect(banned.banned).toBe(true);

    const del = await json('DELETE', `/api/admin/players/${target.id}`, undefined, ADMIN);
    expect(del.body.deleted).toBe(true);
    const after = await json('GET', '/api/admin/overview', undefined, ADMIN);
    expect(after.body.players).toBe(1);
  });
});

describe('accounts & recovery', () => {
  let mailServer: Server;
  let mailBase: string;
  const outbox: Array<{ to: string; text: string }> = [];

  beforeAll(async () => {
    const app = createApp({
      db: openDb(':memory:'),
      publicUrl: 'https://p21.test',
      sendMail: async (to, _subject, text) => {
        outbox.push({ to, text });
      },
    });
    await new Promise<void>((resolve) => {
      mailServer = app.listen(0, resolve);
    });
    const addr = mailServer.address();
    if (typeof addr === 'string' || !addr) throw new Error('no port');
    mailBase = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => new Promise<void>((resolve) => mailServer.close(() => resolve())));

  async function mjson(method: string, path: string, body?: unknown) {
    const res = await fetch(mailBase + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  let id: string;
  let secret: string;

  it('advertises email support in health when a mailer is configured', async () => {
    expect((await mjson('GET', '/api/health')).body.email).toBe(true);
    // The main test server has no mailer: feature hidden, endpoint disabled.
    expect((await json('GET', '/api/health')).body.email).toBe(false);
    expect((await json('POST', '/api/recover/email', { email: 'a@b.co' })).status).toBe(503);
  });

  it('stores a profile snapshot on sync and returns it for id+secret recovery', async () => {
    const joined = await mjson('POST', '/api/players', { name: 'Comeback Kid' });
    id = joined.body.id;
    secret = joined.body.secret;
    const snapshot = JSON.stringify({ bankroll: 940, misses: { 'h16-10': { n: 2 } } });
    const put = await mjson('PUT', `/api/players/${id}`, { secret, ...stats(), profile: snapshot });
    expect(put.status).toBe(200);
    // oversized/garbage snapshots are rejected
    expect(
      (await mjson('PUT', `/api/players/${id}`, { secret, ...stats(), profile: 'not json' })).status
    ).toBe(400);

    const rec = await mjson('POST', '/api/players/recover', { id, secret });
    expect(rec.status).toBe(200);
    expect(rec.body.name).toBe('Comeback Kid');
    expect(rec.body.profile.bankroll).toBe(940);
    expect((await mjson('POST', '/api/players/recover', { id, secret: 'wrong' })).status).toBe(403);
  });

  it('attaches an email with the secret only, unique per player', async () => {
    expect(
      (await mjson('PUT', `/api/players/${id}/email`, { secret: 'wrong', email: 'kid@x.co' })).status
    ).toBe(403);
    expect(
      (await mjson('PUT', `/api/players/${id}/email`, { secret, email: 'not-an-email' })).status
    ).toBe(400);
    const ok = await mjson('PUT', `/api/players/${id}/email`, { secret, email: 'Kid@X.co' });
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe('kid@x.co'); // normalized

    const other = await mjson('POST', '/api/players', { name: 'Copycat' });
    expect(
      (
        await mjson('PUT', `/api/players/${other.body.id}/email`, {
          secret: other.body.secret,
          email: 'kid@x.co',
        })
      ).status
    ).toBe(409);
  });

  it('sends a single-use magic link that restores the account', async () => {
    // Unknown address: same response, no email — no enumeration.
    expect((await mjson('POST', '/api/recover/email', { email: 'ghost@x.co' })).status).toBe(200);
    expect(outbox).toHaveLength(0);

    expect((await mjson('POST', '/api/recover/email', { email: 'kid@x.co' })).status).toBe(200);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe('kid@x.co');
    const token = /#recover=([0-9a-f]+)/.exec(outbox[0].text)?.[1];
    expect(token).toBeTruthy();
    expect(outbox[0].text).toContain('https://p21.test/#recover=');

    expect((await mjson('POST', '/api/recover/claim', { token: 'f'.repeat(64) })).status).toBe(403);

    const claim = await mjson('POST', '/api/recover/claim', { token });
    expect(claim.status).toBe(200);
    expect(claim.body.id).toBe(id);
    expect(claim.body.name).toBe('Comeback Kid');
    expect(claim.body.profile.bankroll).toBe(940);

    // The secret rotates on claim: whoever holds the emailed link owns the
    // account, and stale devices/recovery codes stop working.
    expect(claim.body.secret).toBeTruthy();
    expect(claim.body.secret).not.toBe(secret);
    expect((await mjson('PUT', `/api/players/${id}`, { secret, ...stats() })).status).toBe(403);
    expect(
      (await mjson('PUT', `/api/players/${id}`, { secret: claim.body.secret, ...stats() })).status
    ).toBe(200);

    // Single use: the same link never works twice.
    expect((await mjson('POST', '/api/recover/claim', { token })).status).toBe(403);
  });
});

describe('secret storage', () => {
  it('keeps only a hash column in the fresh schema', () => {
    const db = openDb(':memory:');
    const cols = (
      db.prepare(`SELECT name FROM pragma_table_info('players')`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toContain('secret_hash');
    expect(cols).not.toContain('secret');
  });

  it('hashes plaintext secrets when migrating an older database', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'p21-')), 'old.db');
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE players (
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
    )`);
    old
      .prepare('INSERT INTO players (id, secret, name, created_at, updated_at) VALUES (?,?,?,?,?)')
      .run('p1', 'plaintext-secret', 'Old Timer', 1, 1);
    old.close();

    const db = openDb(path);
    const row = db.prepare('SELECT * FROM players WHERE id = ?').get('p1') as Record<
      string,
      unknown
    >;
    expect(row.secret_hash).toBe(sha256Hex('plaintext-secret'));
    const cols = (
      db.prepare(`SELECT name FROM pragma_table_info('players')`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).not.toContain('secret');
  });
});

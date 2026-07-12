import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { openDb } from '../src/db';

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
    expect(r.body.decisions).toBe(70);
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
    expect(claim.body.secret).toBe(secret);
    expect(claim.body.name).toBe('Comeback Kid');
    expect(claim.body.profile.bankroll).toBe(940);

    // Single use: the same link never works twice.
    expect((await mjson('POST', '/api/recover/claim', { token })).status).toBe(403);
  });
});

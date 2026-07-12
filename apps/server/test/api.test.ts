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

import { rulesKey } from '@perfect21/engine';
import type { RankTier } from '@perfect21/engine';
import type { Profile } from './profile';

/**
 * Client for the Perfect 21 server. Everything degrades gracefully: when the
 * app runs without a backend (static hosting, Electron, dev without the API)
 * every call resolves to null/false and the UI shows its offline state.
 */

export function apiAvailable(): boolean {
  return typeof location !== 'undefined' && location.protocol !== 'file:';
}

async function request<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T } | null> {
  if (!apiAvailable()) return null;
  try {
    const res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(8000),
    });
    return { status: res.status, body: (await res.json()) as T };
  } catch {
    return null;
  }
}

export interface BoardTier extends Pick<RankTier, 'id' | 'name' | 'color'> {}

export interface BoardPlayer {
  name: string;
  tier: BoardTier | null;
  rollingAccuracy: number;
  decisions: number;
  accuracy: number;
  bestStreak: number;
  rounds: number;
}

export interface Leaderboard {
  players: BoardPlayer[];
  streaks: Array<{ name: string; bestStreak: number; tier: BoardTier | null }>;
  minDecisions: number;
}

export async function fetchLeaderboard(): Promise<Leaderboard | null> {
  const res = await request<Leaderboard>('/api/leaderboard');
  return res?.status === 200 ? res.body : null;
}

export async function joinLeaderboard(
  name: string
): Promise<{ ok: true; id: string; secret: string; name: string } | { ok: false; error: string }> {
  const res = await request<{ id: string; secret: string; name: string; error?: string }>(
    '/api/players',
    { method: 'POST', body: JSON.stringify({ name }) }
  );
  if (!res) return { ok: false, error: 'Server unreachable — try again later.' };
  if (res.status !== 201) return { ok: false, error: res.body.error ?? 'Could not join.' };
  return { ok: true, ...res.body };
}

export async function syncStats(profile: Profile): Promise<boolean> {
  if (!profile.player) return false;
  const res = await request(`/api/players/${profile.player.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      secret: profile.player.secret,
      decisions: profile.lifetimeDecisions,
      correct: profile.lifetimeCorrect,
      rolling: profile.history.slice(-200),
      bestStreak: profile.bestEndless,
      rounds: profile.totalRounds,
      net: profile.totalNet,
      evLoss: profile.totalEVLoss,
      rulesKey: rulesKey(profile.rules),
    }),
  });
  return res?.status === 200;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced background sync — call freely after every round. */
export function scheduleSync(profile: Profile): void {
  if (!profile.player || !apiAvailable()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncStats(profile);
  }, 4000);
}

// ---- admin ----

export async function adminRequest<T>(
  token: string,
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: T } | null> {
  return request<T>(path, { ...init, headers: { authorization: `Bearer ${token}` } });
}

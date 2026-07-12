import { rulesKey } from '@perfect21/engine';
import type { RankTier } from '@perfect21/engine';
import type { PlayerCred, Profile } from './profile';
import { parseRecoveryCode, profileSnapshot, restoreProfile } from './profile';

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
  counters?: Array<{
    name: string;
    tier: BoardTier | null;
    rollingAccuracy: number;
    decisions: number;
  }>;
  minDecisions: number;
}

export async function fetchLeaderboard(): Promise<Leaderboard | null> {
  const res = await request<Leaderboard>('/api/leaderboard');
  return res?.status === 200 ? res.body : null;
}

/** Which optional server features are live (email recovery hides itself when unconfigured). */
export async function serverFeatures(): Promise<{ email: boolean } | null> {
  const res = await request<{ ok: boolean; email?: boolean }>('/api/health');
  return res?.status === 200 ? { email: res.body.email === true } : null;
}

/** Attach a recovery email to the account (or detach with null). */
export async function attachEmail(
  profile: Profile,
  email: string | null
): Promise<{ ok: true; email: string | null } | { ok: false; error: string }> {
  if (!profile.player) return { ok: false, error: 'Claim a name first.' };
  const res = await request<{ ok?: boolean; email?: string | null; error?: string }>(
    `/api/players/${profile.player.id}/email`,
    { method: 'PUT', body: JSON.stringify({ secret: profile.player.secret, email }) }
  );
  if (!res) return { ok: false, error: 'Server unreachable — try again later.' };
  if (res.status !== 200) return { ok: false, error: res.body.error ?? 'Could not save email.' };
  return { ok: true, email: res.body.email ?? null };
}

/** Ask for a magic recovery link. Success only means "if registered, it was sent". */
export async function requestEmailRecovery(
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await request<{ ok?: boolean; error?: string }>('/api/recover/email', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  if (!res) return { ok: false, error: 'Server unreachable — try again later.' };
  if (res.status !== 200) return { ok: false, error: res.body.error ?? 'Could not send the link.' };
  return { ok: true };
}

/** Trade a magic-link token (from the #recover= URL) for the restored profile. */
export async function claimRecovery(
  token: string
): Promise<{ ok: true; profile: Profile } | { ok: false; error: string }> {
  const res = await request<{
    id: string;
    secret: string;
    name: string;
    profile: unknown;
    stats: {
      decisions: number;
      correct: number;
      rolling: boolean[];
      bestStreak: number;
      rounds: number;
      net: number;
      evLoss: number;
    };
    error?: string;
  }>('/api/recover/claim', { method: 'POST', body: JSON.stringify({ token }) });
  if (!res) return { ok: false, error: 'Server unreachable — try again later.' };
  if (res.status !== 200) {
    return { ok: false, error: res.body.error ?? 'This recovery link is invalid or expired.' };
  }
  const player: PlayerCred = { id: res.body.id, secret: res.body.secret, name: res.body.name };
  const snapshot = res.body.profile ?? {
    lifetimeDecisions: res.body.stats.decisions,
    lifetimeCorrect: res.body.stats.correct,
    history: res.body.stats.rolling,
    bestEndless: res.body.stats.bestStreak,
    totalRounds: res.body.stats.rounds,
    totalNet: res.body.stats.net,
    totalEVLoss: res.body.stats.evLoss,
  };
  return { ok: true, profile: restoreProfile(snapshot, player) };
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
      countingDecisions: profile.countingDecisions,
      countingCorrect: profile.countingCorrect,
      countingRolling: profile.countingHistory.slice(-200),
      // Full backup: whoever holds the recovery code can restore all of this.
      profile: JSON.stringify(profileSnapshot(profile)),
    }),
  });
  return res?.status === 200;
}

/** Restore an account from a recovery code. Overwrites the local profile on success. */
export async function recoverAccount(
  code: string
): Promise<{ ok: true; profile: Profile } | { ok: false; error: string }> {
  const cred = parseRecoveryCode(code);
  if (!cred) return { ok: false, error: 'That doesn’t look like a recovery code.' };
  const res = await request<{
    id: string;
    name: string;
    profile: unknown;
    stats: {
      decisions: number;
      correct: number;
      rolling: boolean[];
      bestStreak: number;
      rounds: number;
      net: number;
      evLoss: number;
    };
    error?: string;
  }>('/api/players/recover', { method: 'POST', body: JSON.stringify(cred) });
  if (!res) return { ok: false, error: 'Server unreachable — try again later.' };
  if (res.status !== 200) return { ok: false, error: res.body.error ?? 'Recovery failed.' };
  const player: PlayerCred = { id: res.body.id, secret: cred.secret, name: res.body.name };
  const snapshot =
    res.body.profile ??
    // Accounts synced before snapshots existed: rebuild what the server knows.
    {
      lifetimeDecisions: res.body.stats.decisions,
      lifetimeCorrect: res.body.stats.correct,
      history: res.body.stats.rolling,
      bestEndless: res.body.stats.bestStreak,
      totalRounds: res.body.stats.rounds,
      totalNet: res.body.stats.net,
      totalEVLoss: res.body.stats.evLoss,
    };
  return { ok: true, profile: restoreProfile(snapshot, player) };
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

import { DEFAULT_RULES, computeRank } from '@perfect21/engine';
import type { Action, RankResult, Rules } from '@perfect21/engine';

const KEY = 'perfect21.profile.v1';
const HISTORY_CAP = 1000;
const HAND_LOG_CAP = 60;
/** Correct reps on a leaky cell chip away at its miss count; ~3 clear one miss. */
const MISS_DECAY = 1 / 3;

/** Play chips only — worthless by design. See docs/REQUIREMENTS.md: no real money, ever. */
export const STARTING_BANKROLL = 1000;

/** Aggregated record of one chart cell the player keeps getting wrong. */
export interface MissStat {
  key: string; // chart cell key, e.g. 'h16-10'
  /** Net miss weight: +1 per miss, decays as correct reps prove mastery. */
  n: number;
  /** Cumulative EV given away on this cell (per initial bet). */
  evLost: number;
  recommended: Action;
  /** What the player picked instead, by action. */
  chosen: Partial<Record<Action, number>>;
  last: number;
}

/** One graded decision, for the history stream. */
export interface HandLogEntry {
  t: number;
  ranks: number[];
  up: number;
  chosen: Action;
  recommended: Action;
  correct: boolean;
  evLoss: number;
  mode: string;
}

export interface Profile {
  rules: Rules;
  /** Leaderboard identity, once the player claims a name. */
  player?: { id: string; secret: string; name: string };
  /** Rolling decision history (correct?), oldest first. */
  history: boolean[];
  lifetimeDecisions: number;
  lifetimeCorrect: number;
  totalRounds: number;
  totalNet: number;
  totalEVLoss: number;
  bestEndless: number;
  /** Persistent play-chip balance (practice/competitive; endless runs use their own stack). */
  bankroll: number;
  /** Times the player went broke and refilled — a stat, not a shame. */
  rebuys: number;
  /** Chart cells the player misses, keyed by cell key. Feeds drill mode. */
  misses: Record<string, MissStat>;
  /** Recent graded decisions, oldest first. */
  handLog: HandLogEntry[];
  /** Client-side display hint only; the server holds the authoritative email. */
  recoveryEmail?: string;
  /** Card-counting mode has its own rank: rolling window + lifetime counters. */
  countingHistory: boolean[];
  countingDecisions: number;
  countingCorrect: number;
  /**
   * Counting mode deals its own shoe: counters want few decks and deep
   * penetration, so this is separate from rules.decks (default 2 — the
   * classic double-deck pitch game).
   */
  countingDecks: number;
  /** Skill split inside the counting rank: bet-spread and insurance calls. */
  countingBets: number;
  countingBetsCorrect: number;
  countingIns: number;
  countingInsCorrect: number;
}

function fresh(): Profile {
  return {
    rules: { ...DEFAULT_RULES },
    history: [],
    lifetimeDecisions: 0,
    lifetimeCorrect: 0,
    totalRounds: 0,
    totalNet: 0,
    totalEVLoss: 0,
    bestEndless: 0,
    bankroll: STARTING_BANKROLL,
    rebuys: 0,
    misses: {},
    handLog: [],
    countingHistory: [],
    countingDecisions: 0,
    countingCorrect: 0,
    countingDecks: 2,
    countingBets: 0,
    countingBetsCorrect: 0,
    countingIns: 0,
    countingInsCorrect: 0,
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    return { ...fresh(), ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {
    return fresh();
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage may be unavailable (private mode); play on without persistence
  }
}

export function recordDecision(p: Profile, correct: boolean): void {
  p.history.push(correct);
  if (p.history.length > HISTORY_CAP) p.history.splice(0, p.history.length - HISTORY_CAP);
  p.lifetimeDecisions++;
  if (correct) p.lifetimeCorrect++;
}

/**
 * Feed the mistake memory and the hand-history stream. Called for every graded
 * decision in every mode (drill included — that's how weak spots heal).
 * Counting-mode calls pass trackMisses=false: an index miss is not a basic-
 * strategy leak and must not pollute the drill.
 */
export function logDecision(
  p: Profile,
  cellKey: string,
  entry: HandLogEntry,
  trackMisses = true
): void {
  p.handLog.push(entry);
  if (p.handLog.length > HAND_LOG_CAP) p.handLog.splice(0, p.handLog.length - HAND_LOG_CAP);
  if (!trackMisses) return;
  const miss = p.misses[cellKey];
  if (!entry.correct) {
    if (miss) {
      miss.n += 1;
      miss.evLost += Math.max(0, entry.evLoss);
      miss.recommended = entry.recommended;
      miss.chosen[entry.chosen] = (miss.chosen[entry.chosen] ?? 0) + 1;
      miss.last = entry.t;
    } else {
      p.misses[cellKey] = {
        key: cellKey,
        n: 1,
        evLost: Math.max(0, entry.evLoss),
        recommended: entry.recommended,
        chosen: { [entry.chosen]: 1 },
        last: entry.t,
      };
    }
  } else if (miss) {
    miss.n -= MISS_DECAY;
    if (miss.n < 0.5) delete p.misses[cellKey];
  }
}

/** Frequency × severity score used to rank (and sample) weak spots. */
export function missScore(m: MissStat): number {
  return m.n * (m.evLost / Math.max(1, m.n) + 0.01);
}

/** Misses worth training, most costly first. */
export function topMisses(p: Profile): MissStat[] {
  return Object.values(p.misses)
    .filter((m) => m.n >= 0.5)
    .sort((a, b) => missScore(b) - missScore(a));
}

export function rankOf(p: Profile): RankResult {
  return computeRank(p.history);
}

export type CountingSkill = 'play' | 'bet' | 'insurance';

/** Every counting call — index play, bet size, insurance — feeds one rank window. */
export function recordCountingDecision(
  p: Profile,
  correct: boolean,
  skill: CountingSkill = 'play'
): void {
  p.countingHistory.push(correct);
  if (p.countingHistory.length > HISTORY_CAP) {
    p.countingHistory.splice(0, p.countingHistory.length - HISTORY_CAP);
  }
  p.countingDecisions++;
  if (correct) p.countingCorrect++;
  if (skill === 'bet') {
    p.countingBets++;
    if (correct) p.countingBetsCorrect++;
  } else if (skill === 'insurance') {
    p.countingIns++;
    if (correct) p.countingInsCorrect++;
  }
}

export function countingRankOf(p: Profile): RankResult {
  return computeRank(p.countingHistory);
}

/**
 * Start one rank from scratch without touching anything else. Lifetime
 * counters stay (they're monotonic on the server); only the rolling window
 * that determines the rank is cleared.
 */
export function resetRankAspect(p: Profile, aspect: 'basic' | 'counting'): void {
  if (aspect === 'basic') p.history = [];
  else p.countingHistory = [];
  saveProfile(p);
}

// ---- cross-device recovery ----
// Claiming a leaderboard name IS the account: the id+secret pair, formatted
// as a recovery code, restores everything on any device. No email, no password.

export interface PlayerCred {
  id: string;
  secret: string;
  name: string;
}

export function recoveryCode(player: PlayerCred): string {
  return `p21.${player.id}.${player.secret}`;
}

export function parseRecoveryCode(code: string): { id: string; secret: string } | null {
  const parts = code.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'p21' || !parts[1] || !parts[2]) return null;
  return { id: parts[1], secret: parts[2] };
}

/** Everything worth backing up, trimmed to keep the sync payload small. */
export function profileSnapshot(p: Profile): Omit<Profile, 'player'> {
  const { player: _player, ...rest } = p;
  return {
    ...rest,
    history: p.history.slice(-200),
    countingHistory: p.countingHistory.slice(-200),
    handLog: p.handLog.slice(-60),
  };
}

/** Rebuild and persist a profile from a recovered server snapshot. */
export function restoreProfile(snapshot: unknown, player: PlayerCred): Profile {
  const partial =
    typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
      ? (snapshot as Partial<Profile>)
      : {};
  const p: Profile = { ...fresh(), ...partial, player };
  saveProfile(p);
  return p;
}

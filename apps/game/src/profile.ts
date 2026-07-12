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
 */
export function logDecision(p: Profile, cellKey: string, entry: HandLogEntry): void {
  p.handLog.push(entry);
  if (p.handLog.length > HAND_LOG_CAP) p.handLog.splice(0, p.handLog.length - HAND_LOG_CAP);
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

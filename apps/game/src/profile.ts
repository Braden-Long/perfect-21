import { DEFAULT_RULES, computeRank } from '@perfect21/engine';
import type { RankResult, Rules } from '@perfect21/engine';

const KEY = 'perfect21.profile.v1';
const HISTORY_CAP = 1000;

export interface Profile {
  rules: Rules;
  /** Rolling decision history (correct?), oldest first. */
  history: boolean[];
  lifetimeDecisions: number;
  lifetimeCorrect: number;
  totalRounds: number;
  totalNet: number;
  totalEVLoss: number;
  bestEndless: number;
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

export function rankOf(p: Profile): RankResult {
  return computeRank(p.history);
}

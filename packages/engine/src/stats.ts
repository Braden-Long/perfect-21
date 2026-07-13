import type { Action } from './types';
import type { RoundSummary } from './game';

export interface DecisionRecord {
  correct: boolean;
  /** EV(chart action) − EV(chosen), per initial unit. Slightly negative is
   *  possible when a composition-dependent play beats the chart. */
  evLoss: number;
  chosen: Action;
  recommended: Action;
}

/**
 * Per-session accounting. All RTP figures are expressed per initial bet,
 * matching how the theoretical figure is quoted.
 */
export class SessionStats {
  rounds = 0;
  net = 0;
  wagered = 0;
  decisions: DecisionRecord[] = [];

  addRound(summary: RoundSummary): void {
    this.rounds++;
    this.wagered += summary.initialBet;
    this.net += summary.net;
  }

  addDecision(record: DecisionRecord): void {
    this.decisions.push(record);
  }

  get decisionCount(): number {
    return this.decisions.length;
  }

  get correctCount(): number {
    return this.decisions.filter((d) => d.correct).length;
  }

  /** Fraction of decisions that matched basic strategy (1 when no decisions yet). */
  get accuracy(): number {
    return this.decisionCount === 0 ? 1 : this.correctCount / this.decisionCount;
  }

  get deviation(): number {
    return 1 - this.accuracy;
  }

  get totalEVLoss(): number {
    return this.decisions.reduce((s, d) => s + d.evLoss, 0);
  }

  /** Realized return this session — pure luck plus play quality. */
  get actualRTP(): number {
    return this.wagered === 0 ? 1 : 1 + this.net / this.wagered;
  }

  /** Theoretical RTP degraded by the EV given up on incorrect decisions. */
  expectedRTP(theoreticalRTP: number): number {
    if (this.wagered === 0) return theoreticalRTP;
    return theoreticalRTP - this.totalEVLoss / this.wagered;
  }
}

export interface RankTier {
  id: string;
  name: string;
  /** Minimum rolling accuracy (inclusive) to hold the tier. */
  min: number;
  color: string;
}

export const RANK_TIERS: RankTier[] = [
  { id: 'bronze', name: 'Bronze', min: 0, color: '#b07c4f' },
  { id: 'silver', name: 'Silver', min: 0.85, color: '#b9c4d0' },
  { id: 'gold', name: 'Gold', min: 0.92, color: '#e8bf5a' },
  { id: 'platinum', name: 'Platinum', min: 0.96, color: '#8fd8d2' },
  { id: 'diamond', name: 'Diamond', min: 0.985, color: '#7fb8f5' },
  { id: 'perfect', name: 'Perfect 21', min: 1, color: '#59e0a5' },
];

export const RANK_WINDOW = 200;
export const RANK_MIN_DECISIONS = 50;

export interface RankResult {
  tier: RankTier | null;
  /** Rolling accuracy over the rank window (last RANK_WINDOW decisions). */
  rollingAccuracy: number;
  /** Decisions still needed before a rank is assigned. */
  needed: number;
}

/** `recent` is the player's decision history, oldest first (booleans: correct?). */
export function computeRank(recent: boolean[]): RankResult {
  const window = recent.slice(-RANK_WINDOW);
  const rollingAccuracy =
    window.length === 0 ? 0 : window.filter(Boolean).length / window.length;
  if (recent.length < RANK_MIN_DECISIONS) {
    return { tier: null, rollingAccuracy, needed: RANK_MIN_DECISIONS - recent.length };
  }
  let tier = RANK_TIERS[0];
  for (const t of RANK_TIERS) {
    if (t.min === 1) {
      // Perfect 21 demands a full window without a single miss.
      if (window.length >= 100 && rollingAccuracy === 1) tier = t;
    } else if (rollingAccuracy >= t.min) {
      tier = t;
    }
  }
  return { tier, rollingAccuracy, needed: 0 };
}

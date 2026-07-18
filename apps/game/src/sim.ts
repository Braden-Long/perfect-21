import { Round, cardRanks, handValue } from '@perfect21/engine';
import type { Action, Shoe, Strategy } from '@perfect21/engine';

/**
 * Headless basic-strategy simulator. Virtual players hit thousands of hands a
 * second with no DOM — decisions come from the precomputed chart (total-
 * dependent lookups, no per-hand EV rebuild), so a full run is milliseconds.
 * A `skill` of 1 plays perfect basic strategy; below that, each decision is a
 * random legal action with probability (1 − skill), which is exactly how much
 * adherence erodes. Nothing here reads or writes the profile.
 */
export interface SimBatch {
  hands: number;
  net: number;
  /** Initial units wagered (one per hand); doubles/splits are extra risk, not extra rounds. */
  wagered: number;
  /** EV given up to non-optimal decisions, per the chart's aggregated cell EVs. */
  evLoss: number;
  decisions: number;
  /** Decisions that matched the chart's best available play. */
  matched: number;
}

const emptyBatch = (): SimBatch => ({
  hands: 0,
  net: 0,
  wagered: 0,
  evLoss: 0,
  decisions: 0,
  matched: 0,
});

/** The chart cell governing a live hand, matching Strategy.recommend's selection. */
function cellFor(strategy: Strategy, ranks: number[], up: number, available: Action[]) {
  const v = handValue(ranks);
  if (ranks.length === 2 && ranks[0] === ranks[1] && available.includes('split')) {
    const p = strategy.getCell(`p${ranks[0]}-${up}`);
    if (p) return p;
  }
  if (v.soft && v.total <= 20) {
    const s = strategy.getCell(`s${v.total}-${up}`);
    if (s) return s;
  }
  if (!v.soft && v.total <= 20) {
    const h = strategy.getCell(`h${v.total}-${up}`);
    if (h) return h;
  }
  return undefined;
}

/**
 * Play `count` rounds on the given shoe (reused across calls so penetration
 * and reshuffles behave like a real table), accumulating into `acc`.
 */
export function simulateBatch(
  strategy: Strategy,
  shoe: Shoe,
  count: number,
  skill: number,
  acc: SimBatch = emptyBatch(),
  rng: () => number = Math.random
): SimBatch {
  for (let i = 0; i < count; i++) {
    const round = new Round(strategy.rules, shoe);
    round.deal();
    let guard = 0;
    while (round.phase === 'player' && guard++ < 64) {
      const available = round.availableActions();
      if (available.length === 0) break;
      const ranks = cardRanks(round.activeHand.cards);
      const cell = cellFor(strategy, ranks, round.dealerUp.rank, available);
      const best = cell
        ? available.includes(cell.best)
          ? cell.best
          : cell.fallback
        : 'stand';
      const follow = rng() < skill;
      const chosen = follow
        ? best
        : available[Math.floor(rng() * available.length)];
      if (cell) {
        const bestEV = cell.evs[best] ?? 0;
        const chosenEV = cell.evs[chosen] ?? bestEV;
        acc.evLoss += Math.max(0, bestEV - chosenEV);
      }
      acc.decisions++;
      if (chosen === best) acc.matched++;
      round.act(chosen);
    }
    const summary = round.summary();
    acc.hands++;
    acc.net += summary.net;
    acc.wagered += summary.initialBet;
  }
  return acc;
}

export interface SweepPoint {
  skill: number;
  actualRTP: number;
  expectedRTP: number;
}

/** One sweep level: `hands` rounds at a fixed skill on a fresh shoe. */
export function sweepLevel(
  strategy: Strategy,
  shoe: Shoe,
  hands: number,
  skill: number,
  theoreticalRTP: number
): SweepPoint {
  const b = simulateBatch(strategy, shoe, hands, skill);
  return {
    skill,
    actualRTP: b.wagered === 0 ? 1 : 1 + b.net / b.wagered,
    expectedRTP: b.wagered === 0 ? theoreticalRTP : theoreticalRTP - b.evLoss / b.wagered,
  };
}

import type { Action, Card, Rules } from './types';

/**
 * Hi-Lo card counting: tags, true count, and the classic index plays.
 *
 * Indices are Donald Schlesinger's Illustrious 18 and Fab 4 (Blackjack
 * Attack, 1997), as reproduced by gamblingcalc.com's deviations calculator
 * and blackjackreview.com's encyclopedia. Baseline: multi-deck, S17. The one
 * play that materially changes under H17 — double 11 vs A — is already the
 * basic-strategy play there, so its index is skipped for H17 rule sets.
 *
 * Convention: true count = running count ÷ decks remaining (exact, no
 * flooring); an index play triggers when TC >= index.
 */

/** Hi-Lo tag: 2–6 → +1, 7–9 → 0, 10/A → −1. */
export function hiLoValue(rank: number): number {
  if (rank >= 2 && rank <= 6) return 1;
  if (rank === 10 || rank === 1) return -1;
  return 0;
}

export function countCards(cards: Card[]): number {
  return cards.reduce((s, c) => s + hiLoValue(c.rank), 0);
}

/** Exact true count. Guards the tail of the shoe against division blowups. */
export function trueCount(runningCount: number, cardsRemaining: number): number {
  const decks = Math.max(cardsRemaining / 52, 0.25);
  return runningCount / decks;
}

/** Take insurance at TC >= +3 (the single most valuable index play). */
export const INSURANCE_INDEX = 3;

/**
 * Hi-Lo rule of thumb: each true-count point swings the player's expectation
 * by about half a percent of the initial bet.
 */
export const EDGE_PER_TC = 0.005;

/** The counter's live edge: the game's base edge (theoretical RTP − 1) plus the count. */
export function counterEdge(baseEdge: number, tc: number): number {
  return baseEdge + EDGE_PER_TC * tc;
}

export interface BetRamp {
  /** Recommended bet in units at this true count. */
  units: number;
  /** Acceptable band (spreads are "more art than science" — allow ±½ TC of slack). */
  minUnits: number;
  maxUnits: number;
  /** The game's max spread: 1–8 for pitch games (1–2 decks), 1–12 for shoes. */
  spread: number;
}

/** Max spread by game: pitch games get less room before the ramp draws heat. */
export function maxSpread(decks: number): number {
  return decks <= 2 ? 8 : 12;
}

/**
 * Recommended bet in units, ~2 units per true-count point above +1 (each TC
 * point ≈ +0.5% edge; the edge typically crosses zero near TC +1). This
 * reproduces the classic taught ramps: shoe 1/2/4/6/8/12 at TC ≤1/2/3/4/5/6+,
 * pitch capped at 8 units.
 */
function rampUnits(tc: number, spread: number): number {
  if (tc < 1.5) return 1;
  return Math.min(spread, Math.max(1, Math.round(2 * (tc - 1))));
}

/**
 * The bet check for a true count: what a counter should have out, with half a
 * true count of tolerance on each side. Below +1 the answer is always the
 * table minimum — betting big into a negative or neutral shoe is the house's
 * favorite mistake.
 */
export function betRamp(tc: number, decks: number): BetRamp {
  const spread = maxSpread(decks);
  return {
    units: rampUnits(tc, spread),
    minUnits: rampUnits(tc - 0.5, spread),
    maxUnits: rampUnits(tc + 0.5, spread),
    spread,
  };
}

export interface Deviation {
  /** Chart cell key, e.g. 'h16-10' or 'p10-6'. */
  key: string;
  /** True-count threshold; at or above it, play `above`, else `below`. */
  index: number;
  above: Action;
  below: Action;
  /** Only meaningful when the dealer stands on soft 17. */
  s17Only?: boolean;
  /** Below the index this deviation abstains (next candidate/basic decides). */
  deferBelow?: boolean;
}

/** The Illustrious 18 (insurance lives in INSURANCE_INDEX). */
export const ILLUSTRIOUS_18: Deviation[] = [
  { key: 'h16-10', index: 0, above: 'stand', below: 'hit' },
  { key: 'h15-10', index: 4, above: 'stand', below: 'hit' },
  { key: 'p10-5', index: 5, above: 'split', below: 'stand' },
  { key: 'p10-6', index: 4, above: 'split', below: 'stand' },
  { key: 'h10-10', index: 4, above: 'double', below: 'hit' },
  { key: 'h12-3', index: 2, above: 'stand', below: 'hit' },
  { key: 'h12-2', index: 3, above: 'stand', below: 'hit' },
  { key: 'h11-1', index: 1, above: 'double', below: 'hit', s17Only: true },
  { key: 'h9-2', index: 1, above: 'double', below: 'hit' },
  { key: 'h10-1', index: 4, above: 'double', below: 'hit' },
  { key: 'h9-7', index: 3, above: 'double', below: 'hit' },
  { key: 'h16-9', index: 5, above: 'stand', below: 'hit' },
  { key: 'h13-2', index: -1, above: 'stand', below: 'hit' },
  { key: 'h12-4', index: 0, above: 'stand', below: 'hit' },
  { key: 'h12-5', index: -2, above: 'stand', below: 'hit' },
  { key: 'h12-6', index: -1, above: 'stand', below: 'hit' },
  { key: 'h13-3', index: -2, above: 'stand', below: 'hit' },
];

/**
 * The Fab 4 late-surrender indices: surrender at or above the index; below
 * it, the hand falls through to the Illustrious 18 / basic strategy.
 */
export const FAB_4: Deviation[] = [
  { key: 'h15-10', index: 0, above: 'surrender', below: 'hit', deferBelow: true },
  { key: 'h15-1', index: 1, above: 'surrender', below: 'hit', deferBelow: true },
  { key: 'h15-9', index: 2, above: 'surrender', below: 'hit', deferBelow: true },
  { key: 'h14-10', index: 3, above: 'surrender', below: 'hit', deferBelow: true },
];

export interface IndexPlay {
  /** What a counter should do here, given the true count. */
  action: Action;
  /** The deviation that decided it, if any (else pure basic strategy). */
  deviation: Deviation | null;
  /** True when the deviation fired its at-or-above branch. */
  triggered: boolean;
}

/**
 * The count-aware play for a chart cell: Fab 4 first when surrender is on the
 * table, then the Illustrious 18, else basic strategy. `basicAction` is the
 * engine's rule-derived recommendation; `available` are the actions the
 * player can actually take right now.
 */
export function indexPlay(
  cellKey: string,
  tc: number,
  basicAction: Action,
  available: Action[],
  rules: Rules
): IndexPlay {
  const candidates: Deviation[] = [];
  if (rules.surrender === 'late' && available.includes('surrender')) {
    const fab = FAB_4.find((d) => d.key === cellKey);
    if (fab) candidates.push(fab);
  }
  const ill = ILLUSTRIOUS_18.find(
    (d) => d.key === cellKey && !(d.s17Only && rules.soft17 === 'h17')
  );
  if (ill) candidates.push(ill);

  for (const deviation of candidates) {
    const triggered = tc >= deviation.index;
    if (!triggered && deviation.deferBelow) continue;
    const action = triggered ? deviation.above : deviation.below;
    if (available.includes(action)) return { action, deviation, triggered };
    // Deviation names an unavailable action (e.g. double on 3+ cards):
    // fall through to the next candidate or to basic strategy.
  }
  return { action: basicAction, deviation: null, triggered: false };
}

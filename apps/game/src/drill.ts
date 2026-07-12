import { handValue } from '@perfect21/engine';
import type { Action, Card, Rank, Rules, Suit } from '@perfect21/engine';
import type { Profile } from './profile';
import { missScore, topMisses } from './profile';

/**
 * Drill mode: flashcards with real cards. Each rep synthesizes a starting
 * hand for one chart cell — weighted toward the cells the player misses —
 * grades the first decision, and moves on. No shoe, no bets, no rank impact.
 */

export interface DrillHand {
  cellKey: string;
  playerCards: [Card, Card];
  upCard: Card;
  holeCard: Card;
  ranks: [number, number];
  up: number;
  /** True when this cell came from the player's miss list. */
  targeted: boolean;
}

/** Share of reps drawn from the miss list (the rest is coverage of tricky cells). */
const TARGET_SHARE = 0.75;

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
const TEN_FACES = ['10', 'J', 'Q', 'K'];

function cardFor(rank: number): Card {
  const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
  const face =
    rank === 1 ? 'A' : rank === 10 ? TEN_FACES[Math.floor(Math.random() * 4)] : String(rank);
  return { rank: rank as Rank, suit, face };
}

const UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];

/**
 * Cells worth drilling blind (coverage). Trivial always-hit hard totals are
 * left out — they still show up if the player somehow misses one.
 */
export function coverageCells(): string[] {
  const keys: string[] = [];
  for (const up of UPS) {
    for (let t = 9; t <= 17; t++) keys.push(`h${t}-${up}`);
    for (let t = 13; t <= 20; t++) keys.push(`s${t}-${up}`);
    for (let r = 1; r <= 10; r++) keys.push(`p${r}-${up}`);
  }
  return keys;
}

/** Two-card compositions for a hard total, excluding pairs and aces. */
function hardCompositions(total: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let c1 = Math.max(2, total - 10); c1 <= Math.floor(total / 2); c1++) {
    const c2 = total - c1;
    if (c1 === c2 || c2 > 10 || c2 < 2) continue;
    out.push([c1, c2]);
  }
  return out;
}

export function ranksForCell(key: string): [number, number] | null {
  const m = /^([hsp])(\d+)-(\d+)$/.exec(key);
  if (!m) return null;
  const total = Number(m[2]);
  switch (m[1]) {
    case 'p':
      return total >= 1 && total <= 10 ? [total, total] : null;
    case 's': {
      const kicker = total - 11;
      return kicker >= 2 && kicker <= 9 ? [1, kicker] : null;
    }
    default: {
      const comps = hardCompositions(total);
      if (comps.length === 0) return null;
      const pick = comps[Math.floor(Math.random() * comps.length)];
      return Math.random() < 0.5 ? pick : [pick[1], pick[0]];
    }
  }
}

function upForCell(key: string): number | null {
  const m = /-(\d+)$/.exec(key);
  if (!m) return null;
  const up = Number(m[1]);
  return up >= 1 && up <= 10 ? up : null;
}

/** Pick the next cell to drill: the player's leaks first, coverage second. */
export function sampleCell(profile: Profile, lastKey: string | null): { key: string; targeted: boolean } {
  const misses = topMisses(profile).filter(
    (miss) => miss.key !== lastKey && ranksForCell(miss.key) !== null
  );
  if (misses.length > 0 && Math.random() < TARGET_SHARE) {
    // Weighted roulette over frequency × severity.
    const total = misses.reduce((s, miss) => s + missScore(miss), 0);
    let roll = Math.random() * total;
    for (const miss of misses) {
      roll -= missScore(miss);
      if (roll <= 0) return { key: miss.key, targeted: true };
    }
    return { key: misses[0].key, targeted: true };
  }
  const pool = coverageCells().filter((k) => k !== lastKey);
  return { key: pool[Math.floor(Math.random() * pool.length)], targeted: false };
}

/** A hole card that can't give the dealer blackjack, so every rep reaches a decision. */
function holeFor(up: number): Card {
  for (;;) {
    // 13-face distribution so tens appear at the true 4/13 rate.
    const face = Math.floor(Math.random() * 13) + 1;
    const rank = Math.min(face, 10);
    if (up === 1 && rank === 10) continue;
    if (up === 10 && rank === 1) continue;
    return cardFor(rank);
  }
}

export function dealDrillHand(profile: Profile, lastKey: string | null): DrillHand {
  const { key, targeted } = sampleCell(profile, lastKey);
  const ranks = ranksForCell(key)!;
  const up = upForCell(key)!;
  return {
    cellKey: key,
    playerCards: [cardFor(ranks[0]), cardFor(ranks[1])],
    upCard: cardFor(up),
    holeCard: holeFor(up),
    ranks,
    up,
    targeted,
  };
}

/** First-decision actions for a fresh two-card hand (mirrors Round.availableActions). */
export function drillActions(rules: Rules, ranks: [number, number]): Action[] {
  const v = handValue([ranks[0], ranks[1]]);
  const actions: Action[] = ['hit', 'stand'];
  const dblRule =
    rules.double === 'all' ||
    (!v.soft &&
      (rules.double === '10-11' ? v.total === 10 || v.total === 11 : v.total >= 9 && v.total <= 11));
  if (dblRule) actions.push('double');
  if (ranks[0] === ranks[1]) actions.push('split');
  if (rules.surrender !== 'none') actions.push('surrender');
  return actions;
}

/** "16 vs 10", "A,7 vs 2", "8,8 vs A" — human labels for cells and hands. */
export function rankLabel(rank: number): string {
  return rank === 1 ? 'A' : String(rank);
}

export function handLabel(ranks: number[], up: number): string {
  return `${ranks.map(rankLabel).join(',')} vs ${rankLabel(up)}`;
}

export function cellLabel(key: string): string {
  const m = /^([hsp])(\d+)-(\d+)$/.exec(key);
  if (!m) return key;
  const total = Number(m[2]);
  const up = rankLabel(Number(m[3]));
  if (m[1] === 'p') return `${rankLabel(total)},${rankLabel(total)} vs ${up}`;
  if (m[1] === 's') return `soft ${total} (A,${total - 11}) vs ${up}`;
  return `hard ${total} vs ${up}`;
}

import { handValue } from './cards';
import type { Action, Rules } from './types';
import { rulesKey } from './types';

/**
 * Expected-value engine that derives basic strategy for any rule set in the
 * blackjackinfo.com engine parameter space. Decisions are total-dependent
 * (like the published charts); EVs are computed against the exact shoe
 * composition with the visible cards removed and player draws depleting
 * the shoe.
 *
 * Model: composition-dependent. The visible cards (player hand + upcard)
 * are removed from the shoe; player draws deplete it further, and the
 * dealer's outcome distribution is corrected for each card the player
 * draws via a first-order effect-of-removal term (exact for one-draw
 * resolutions like doubles, first-order for deeper hit lines). Razor-thin
 * cells (e.g. soft 13 vs 5 in 8 decks) genuinely hinge on these effects.
 *
 * Conventions:
 * - Ranks are 1 (ace) through 10 (any ten-value card).
 * - In peek games, in-play EVs are conditioned on the dealer NOT having
 *   blackjack (decisions happen after the peek). In no-peek games EVs are
 *   unconditional and the full stake (including doubles/splits) is lost to
 *   a dealer blackjack, per European no-hole-card rules.
 */

/** counts[r] = cards of rank r remaining, index 0 unused. */
type Counts = number[];

/** Dealer final-total distribution, conditioned on no blackjack. */
export interface DealerDist {
  /** probability of final total 17,18,19,20,21 */
  totals: Record<number, number>;
  bust: number;
}

export interface CellEVs {
  hit: number;
  stand: number;
  double?: number;
  split?: number;
  surrender?: number;
}

export interface ChartCell {
  /** e.g. "h16-10" (hard 16 vs ten), "s18-3" (soft 18 vs 3), "p8-1" (pair of 8s vs ace) */
  key: string;
  best: Action;
  /** Best of hit/stand — used when the primary action is unavailable (e.g. double with 3+ cards). */
  fallback: 'hit' | 'stand';
  evs: CellEVs;
}

function fullCounts(decks: number): Counts {
  const c = new Array(11).fill(0);
  for (let r = 1; r <= 9; r++) c[r] = decks * 4;
  c[10] = decks * 16;
  return c;
}

function countsTotal(c: Counts): number {
  let t = 0;
  for (let r = 1; r <= 10; r++) t += c[r];
  return t;
}

/** Stand EV for each player total 0..21 against a dealer distribution. */
function standTable(dist: DealerDist): number[] {
  const table = new Array<number>(22);
  for (let total = 0; total <= 21; total++) {
    let ev = dist.bust;
    for (let t = 17; t <= 21; t++) {
      const p = dist.totals[t] ?? 0;
      if (total > t) ev += p;
      else if (total < t) ev -= p;
    }
    table[total] = ev;
  }
  return table;
}

function doubleAllowedByRule(rules: Rules, ranks: number[]): boolean {
  if (ranks.length !== 2) return false;
  if (rules.double === 'all') return true;
  const v = handValue(ranks);
  if (v.soft) return false; // 9-11 / 10-11 restrictions apply to hard totals
  if (rules.double === '10-11') return v.total === 10 || v.total === 11;
  return v.total >= 9 && v.total <= 11;
}

/**
 * Evaluates all action EVs for one player hand against one dealer upcard,
 * with a specific shoe composition.
 */
class HandEval {
  private rules: Rules;
  private counts: Counts;
  /** Ranks the player has drawn beyond the starting hand (during recursion). */
  private drawn: number[] = [];
  private baseStand: number[];
  /** deltaStand[r][total]: change in stand EV when one extra card of rank r leaves the shoe. */
  private deltaStand: Array<number[] | null>;
  /** P(dealer blackjack) given the upcard and composition; 0 unless up is A/10. */
  readonly pDealerBJ: number;
  private hitMemo = new Map<string, number>();

  constructor(rules: Rules, playerRanks: number[], up: number) {
    this.rules = rules;
    this.counts = fullCounts(rules.decks);
    for (const r of playerRanks) this.counts[r]--;
    this.counts[up]--;
    for (let r = 1; r <= 10; r++) {
      if (this.counts[r] < 0) throw new Error('composition impossible for deck count');
    }
    const holeBJRank = up === 1 ? 10 : up === 10 ? 1 : 0;
    this.pDealerBJ = holeBJRank ? this.counts[holeBJRank] / countsTotal(this.counts) : 0;
    this.baseStand = standTable(dealerDistribution(rules, up, this.counts));
    this.deltaStand = new Array(11).fill(null);
    for (let r = 1; r <= 10; r++) {
      if (this.counts[r] === 0) continue;
      this.counts[r]--;
      const table = standTable(dealerDistribution(rules, up, this.counts));
      this.counts[r]++;
      this.deltaStand[r] = table.map((v, t) => v - this.baseStand[t]);
    }
  }

  standEV(total: number): number {
    if (total > 21) return -1;
    let ev = this.baseStand[total];
    for (const r of this.drawn) ev += this.deltaStand[r]![total];
    return ev;
  }

  /** EV of hitting once and then playing hit/stand optimally, per unit staked. */
  hitEV(ranks: number[]): number {
    const v = handValue(ranks);
    return this.hitRec(v.total, v.soft);
  }

  private hitRec(total: number, soft: boolean): number {
    // Hitting from 21 can never beat standing; short-circuit the recursion.
    if (total >= 21) return total > 21 ? -1 : this.standEV(21);
    const key = `${total}|${soft ? 1 : 0}|${this.counts.join(',')}`;
    const memo = this.hitMemo.get(key);
    if (memo !== undefined) return memo;
    const totalCards = countsTotal(this.counts);
    let ev = 0;
    for (let r = 1; r <= 10; r++) {
      if (this.counts[r] === 0) continue;
      const p = this.counts[r] / totalCards;
      let nt = total + r;
      let ns = soft;
      if (r === 1 && nt + 10 <= 21) {
        nt += 10;
        ns = true;
      }
      if (nt > 21 && ns) {
        nt -= 10;
        ns = false;
      }
      let sub: number;
      if (nt > 21) {
        sub = -1;
      } else {
        this.counts[r]--;
        this.drawn.push(r);
        sub = Math.max(this.standEV(nt), this.hitRec(nt, ns));
        this.drawn.pop();
        this.counts[r]++;
      }
      ev += p * sub;
    }
    this.hitMemo.set(key, ev);
    return ev;
  }

  /** EV of doubling: one card, forced stand, two units staked. Returned per hand (not per unit). */
  doubleEV(ranks: number[]): number {
    const totalCards = countsTotal(this.counts);
    let ev = 0;
    for (let r = 1; r <= 10; r++) {
      if (this.counts[r] === 0) continue;
      const p = this.counts[r] / totalCards;
      const nv = handValue([...ranks, r]);
      if (nv.bust) {
        ev += p * -2;
      } else {
        this.counts[r]--;
        this.drawn.push(r);
        ev += p * 2 * this.standEV(nv.total);
        this.drawn.pop();
        this.counts[r]++;
      }
    }
    return ev;
  }

  /**
   * EV of splitting a pair, approximated as twice the EV of one post-split
   * hand (no resplit). Split aces receive exactly one card.
   */
  splitEV(pairRank: number): number {
    const totalCards = countsTotal(this.counts);
    let evOne = 0;
    for (let r = 1; r <= 10; r++) {
      if (this.counts[r] === 0) continue;
      const p = this.counts[r] / totalCards;
      const ranks = [pairRank, r];
      const v = handValue(ranks);
      this.counts[r]--;
      this.drawn.push(r);
      let best: number;
      if (pairRank === 1) {
        best = this.standEV(v.total); // one card only on split aces
      } else {
        best = Math.max(this.standEV(v.total), this.hitRec(v.total, v.soft));
        if (this.rules.das && doubleAllowedByRule(this.rules, ranks)) {
          best = Math.max(best, this.doubleEV(ranks));
        }
      }
      this.drawn.pop();
      this.counts[r]++;
      evOne += p * best;
    }
    return 2 * evOne;
  }

  /**
   * All action EVs on the decision basis used for chart derivation:
   * conditional on no dealer blackjack in peek games, unconditional
   * (full-stake loss to dealer BJ) in no-peek games. `surrender` here is
   * late surrender; early surrender is handled by the caller.
   */
  actionEVs(ranks: number[], opts: { double: boolean; split: boolean; surrender: boolean }): CellEVs {
    const v = handValue(ranks);
    const evs: CellEVs = {
      stand: this.standEV(v.total),
      hit: this.hitEV(ranks),
    };
    if (opts.double) evs.double = this.doubleEV(ranks);
    if (opts.split && ranks.length === 2 && ranks[0] === ranks[1]) evs.split = this.splitEV(ranks[0]);
    if (opts.surrender) {
      evs.surrender = -0.5;
      if (this.rules.peek && this.rules.surrender === 'early' && this.pDealerBJ > 0) {
        // Early surrender is decided before the peek, so it costs exactly half
        // the bet unconditionally — even when the dealer turns over blackjack.
        // Expressed on this frame's conditional (no-dealer-BJ) basis, that is
        // the value which the standard pBJ·(−1) + (1−pBJ)·EV conversion maps
        // back to −0.5. Keeping one basis makes every comparison and the RTP
        // aggregation exact with no special cases downstream.
        evs.surrender = (-0.5 + this.pDealerBJ) / (1 - this.pDealerBJ);
      }
    }

    if (!this.rules.peek && this.pDealerBJ > 0) {
      const p = this.pDealerBJ;
      evs.stand = p * -1 + (1 - p) * evs.stand;
      evs.hit = p * -1 + (1 - p) * evs.hit;
      if (evs.double !== undefined) evs.double = p * -2 + (1 - p) * evs.double;
      if (evs.split !== undefined) evs.split = p * -2 + (1 - p) * evs.split;
      if (evs.surrender !== undefined) {
        // Early surrender is decided before the hole card settles anything —
        // it always costs exactly half the bet. Late surrender still loses
        // the full bet to a dealer blackjack in no-peek games.
        evs.surrender = this.rules.surrender === 'early' ? -0.5 : p * -1 + (1 - p) * -0.5;
      }
    }
    return evs;
  }
}

const dealerDistCache = new Map<string, DealerDist>();

/**
 * Distribution of dealer final totals, conditioned on no dealer blackjack.
 * Draws deplete the given composition.
 */
export function dealerDistribution(rules: Rules, up: number, counts: Counts): DealerDist {
  const cacheKey = `${rulesKey(rules)}|${up}|${counts.join(',')}`;
  const cached = dealerDistCache.get(cacheKey);
  if (cached) return cached;

  const totals: Record<number, number> = { 17: 0, 18: 0, 19: 0, 20: 0, 21: 0 };
  let bust = 0;
  const memo = new Map<string, Record<string, number>>();
  const work = counts.slice();

  const outcomes = (total: number, soft: boolean): Record<string, number> => {
    const stands =
      total > 17 ||
      (total === 17 && (!soft || rules.soft17 === 's17')) ||
      total > 21;
    if (total > 21) return { bust: 1 };
    if (stands) return { [total]: 1 };
    const key = `${total}|${soft ? 1 : 0}|${work.join(',')}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const totalCards = countsTotal(work);
    const acc: Record<string, number> = {};
    for (let r = 1; r <= 10; r++) {
      if (work[r] === 0) continue;
      const p = work[r] / totalCards;
      let nt = total + r;
      let ns = soft;
      if (r === 1 && nt + 10 <= 21) {
        nt += 10;
        ns = true;
      }
      if (nt > 21 && ns) {
        nt -= 10;
        ns = false;
      }
      work[r]--;
      const sub = outcomes(nt, ns);
      work[r]++;
      for (const k in sub) acc[k] = (acc[k] ?? 0) + p * sub[k];
    }
    memo.set(key, acc);
    return acc;
  };

  // First (hole) draw: exclude the blackjack-completing rank and renormalize —
  // this conditions the whole distribution on "no dealer blackjack".
  const upValue = handValue([up]);
  const holeBJRank = up === 1 ? 10 : up === 10 ? 1 : 0;
  const totalCards = countsTotal(work);
  const denom = totalCards - (holeBJRank ? work[holeBJRank] : 0);
  for (let r = 1; r <= 10; r++) {
    if (work[r] === 0 || r === holeBJRank) continue;
    const p = work[r] / denom;
    let nt = upValue.total + r;
    let ns = upValue.soft;
    if (r === 1 && nt + 10 <= 21) {
      nt += 10;
      ns = true;
    }
    if (nt > 21 && ns) {
      nt -= 10;
      ns = false;
    }
    work[r]--;
    const sub = outcomes(nt, ns);
    work[r]++;
    for (const k in sub) {
      if (k === 'bust') bust += p * sub[k];
      else totals[Number(k)] += p * sub[k];
    }
  }

  const dist: DealerDist = { totals, bust };
  dealerDistCache.set(cacheKey, dist);
  return dist;
}

export interface Recommendation {
  action: Action;
  /** The chart cell that produced the recommendation. */
  cell: ChartCell;
  /** Live EVs for the exact composition in play (per initial unit). */
  evs: CellEVs;
}

export class Strategy {
  readonly rules: Rules;
  private chart = new Map<string, ChartCell>();
  private rtp: number | null = null;

  constructor(rules: Rules) {
    this.rules = rules;
    this.buildChart();
  }

  getCell(key: string): ChartCell | undefined {
    return this.chart.get(key);
  }

  allCells(): ChartCell[] {
    return [...this.chart.values()];
  }

  private pickBest(evs: CellEVs): { best: Action; fallback: 'hit' | 'stand' } {
    // All EVs share one basis (actionEVs handles the early-surrender frame),
    // so the best action is a straight comparison.
    const fallback: 'hit' | 'stand' = evs.hit >= evs.stand ? 'hit' : 'stand';
    let best: Action = fallback;
    let bestEV = evs[fallback];
    for (const a of ['double', 'split', 'surrender'] as const) {
      const ev = evs[a];
      if (ev !== undefined && ev > bestEV) {
        best = a;
        bestEV = ev;
      }
    }
    return { best, fallback };
  }

  /** Weighted EVs across the 2-card compositions of a chart row. */
  private cellFor(
    key: string,
    compositions: Array<{ ranks: [number, number]; weight: number }>,
    up: number,
    opts: { split: boolean }
  ): ChartCell {
    const totalWeight = compositions.reduce((s, c) => s + c.weight, 0);
    const acc: CellEVs = { hit: 0, stand: 0 };
    let anyDouble = false;
    const surrender = this.rules.surrender !== 'none';
    for (const { ranks, weight } of compositions) {
      const ev = new HandEval(this.rules, ranks, up);
      const dbl = doubleAllowedByRule(this.rules, ranks);
      const evs = ev.actionEVs(ranks, { double: dbl, split: opts.split, surrender });
      const w = weight / totalWeight;
      acc.hit += w * evs.hit;
      acc.stand += w * evs.stand;
      if (evs.double !== undefined) {
        acc.double = (acc.double ?? 0) + w * evs.double;
        anyDouble = true;
      }
      if (evs.split !== undefined) acc.split = (acc.split ?? 0) + w * evs.split;
      if (evs.surrender !== undefined) acc.surrender = (acc.surrender ?? 0) + w * evs.surrender;
    }
    if (!anyDouble) delete acc.double;
    const { best, fallback } = this.pickBest(acc);
    return { key, best, fallback, evs: acc };
  }

  private buildChart(): void {
    const decks = this.rules.decks;
    const per = (r: number) => (r === 10 ? decks * 16 : decks * 4);

    for (let up = 1; up <= 10; up++) {
      // Hard totals 4-20 (no aces in hand; pair compositions only when unavoidable).
      for (let total = 4; total <= 20; total++) {
        const comps: Array<{ ranks: [number, number]; weight: number }> = [];
        for (let a = 2; a <= 10; a++) {
          const b = total - a;
          if (b < a || b > 10) continue;
          if (a === b && total !== 4 && total !== 20) continue; // pairs have their own row
          const weight = a === b ? per(a) * (per(a) - 1) : 2 * per(a) * per(b);
          comps.push({ ranks: [a, b], weight });
        }
        if (comps.length === 0) continue;
        this.chart.set(`h${total}-${up}`, this.cellFor(`h${total}-${up}`, comps, up, { split: false }));
      }
      // Soft totals 13-20 (A + 2..9).
      for (let kicker = 2; kicker <= 9; kicker++) {
        const total = 11 + kicker;
        const key = `s${total}-${up}`;
        this.chart.set(key, this.cellFor(key, [{ ranks: [1, kicker], weight: 1 }], up, { split: false }));
      }
      // Pairs A,A through 10,10.
      for (let r = 1; r <= 10; r++) {
        const key = `p${r}-${up}`;
        this.chart.set(key, this.cellFor(key, [{ ranks: [r, r], weight: 1 }], up, { split: true }));
      }
    }
  }

  /**
   * Recommended action for a live hand given the actions currently available.
   * Grades against the total-dependent chart (the source-of-truth format).
   */
  recommend(ranks: number[], up: number, available: Action[]): Recommendation {
    const v = handValue(ranks);
    let cell: ChartCell | undefined;
    if (ranks.length === 2 && ranks[0] === ranks[1] && available.includes('split')) {
      cell = this.chart.get(`p${ranks[0]}-${up}`);
    }
    if (!cell && v.soft && v.total <= 20) cell = this.chart.get(`s${v.total}-${up}`);
    if (!cell && !v.soft && v.total <= 20) cell = this.chart.get(`h${v.total}-${up}`);
    if (!cell) {
      // 21s and hard totals with no chart row: always stand.
      cell = { key: `h${v.total}-${up}`, best: 'stand', fallback: 'stand', evs: { hit: -1, stand: 0 } };
    }
    const action = available.includes(cell.best) ? cell.best : cell.fallback;

    // Live EVs for the exact cards in play (shown in the feedback popup).
    const ev = new HandEval(this.rules, ranks, up);
    const evs = ev.actionEVs(ranks, {
      double: available.includes('double'),
      split: available.includes('split'),
      surrender: available.includes('surrender'),
    });
    return { action, cell, evs };
  }

  /** Dealer bust probability for an upcard (fresh shoe), for explanations. */
  dealerBust(up: number): number {
    return dealerDistribution(this.rules, up, fullCounts(this.rules.decks)).bust;
  }

  /**
   * Theoretical RTP of perfect basic-strategy play under these rules,
   * expressed per initial bet (e.g. 0.9954). Computed by enumerating all
   * starting deals and applying the chart.
   */
  theoreticalRTP(): number {
    if (this.rtp !== null) return this.rtp;
    let evGame = 0;
    const decks = this.rules.decks;
    const full = fullCounts(decks);
    const totalCards = countsTotal(full);
    for (let up = 1; up <= 10; up++) {
      for (let c1 = 1; c1 <= 10; c1++) {
        for (let c2 = c1; c2 <= 10; c2++) {
          const counts = full.slice();
          let p = counts[c1] / totalCards;
          counts[c1]--;
          p *= (counts[c2] / (totalCards - 1)) * (c1 === c2 ? 1 : 2);
          counts[c2]--;
          p *= counts[up] / (totalCards - 2);
          if (p === 0) continue;

          const v = handValue([c1, c2]);
          const ev = new HandEval(this.rules, [c1, c2], up);
          const pBJ = ev.pDealerBJ;
          let dealtEV: number;
          if (v.blackjack) {
            dealtEV = (1 - pBJ) * 1.5;
          } else {
            const isPair = c1 === c2;
            const key = isPair
              ? `p${c1}-${up}`
              : v.soft
                ? `s${v.total}-${up}`
                : `h${v.total}-${up}`;
            const cell = this.chart.get(key);
            const dbl = doubleAllowedByRule(this.rules, [c1, c2]);
            const evs = ev.actionEVs([c1, c2], {
              double: dbl,
              split: isPair,
              surrender: this.rules.surrender !== 'none',
            });
            const action = cell && evs[cell.best] !== undefined ? cell.best : (cell?.fallback ?? 'stand');
            const condEV = evs[action]!;
            if (this.rules.peek) {
              dealtEV = pBJ * -1 + (1 - pBJ) * condEV;
            } else {
              dealtEV = condEV; // already unconditional in no-peek games
            }
          }
          evGame += p * dealtEV;
        }
      }
    }
    this.rtp = 1 + evGame;
    return this.rtp;
  }
}

const strategyCache = new Map<string, Strategy>();

export function getStrategy(rules: Rules): Strategy {
  const key = rulesKey(rules);
  let s = strategyCache.get(key);
  if (!s) {
    s = new Strategy(rules);
    strategyCache.set(key, s);
  }
  return s;
}

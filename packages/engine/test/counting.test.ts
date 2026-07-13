import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  INSURANCE_INDEX,
  Round,
  betRamp,
  countCards,
  counterEdge,
  hiLoValue,
  indexPlay,
  maxSpread,
  trueCount,
} from '../src';
import type { Card, Rank, Rules, Suit } from '../src';

const S17: Rules = { ...DEFAULT_RULES };
const H17: Rules = { ...DEFAULT_RULES, soft17: 'h17' };
const LS: Rules = { ...DEFAULT_RULES, surrender: 'late' };

describe('Hi-Lo tags and true count', () => {
  it('tags ranks per Hi-Lo', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(hiLoValue)).toEqual(
      [-1, 1, 1, 1, 1, 1, 0, 0, 0, -1]
    );
  });

  it('computes true count as RC over decks remaining', () => {
    expect(trueCount(8, 4 * 52)).toBe(2);
    expect(trueCount(-6, 2 * 52)).toBe(-3);
    // Tail-of-shoe guard: never divides by less than a quarter deck.
    expect(trueCount(5, 3)).toBe(20);
  });

  it('insurance index is +3', () => {
    expect(INSURANCE_INDEX).toBe(3);
  });
});

describe('bet ramp and counter edge', () => {
  it('adds half a percent of edge per true count', () => {
    expect(counterEdge(-0.005, 0)).toBeCloseTo(-0.005);
    expect(counterEdge(-0.005, 3)).toBeCloseTo(0.01);
    expect(counterEdge(-0.005, -2)).toBeCloseTo(-0.015);
  });

  it('bets the table minimum at and below TC +1', () => {
    for (const tc of [-4, -1, 0, 1, 1.4]) {
      expect(betRamp(tc, 2).units).toBe(1);
      expect(betRamp(tc, 6).units).toBe(1);
    }
    // Negative and neutral shoes tolerate nothing above the minimum.
    expect(betRamp(0, 6).maxUnits).toBe(1);
    expect(betRamp(-3, 2).maxUnits).toBe(1);
  });

  it('ramps ~2 units per true count above +1, reproducing the classic shoe ramp', () => {
    expect([2, 3, 4, 5, 6, 7].map((tc) => betRamp(tc, 6).units)).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it('caps pitch games at a 1-8 spread and shoes at 1-12', () => {
    expect(betRamp(9, 1).units).toBe(8);
    expect(betRamp(9, 2).units).toBe(8);
    expect(betRamp(9, 6).units).toBe(12);
    expect(betRamp(9, 8).units).toBe(12);
    expect(maxSpread(2)).toBe(8);
    expect(maxSpread(6)).toBe(12);
  });

  it('allows half a true count of slack around the recommendation', () => {
    const atThree = betRamp(3, 6);
    expect(atThree.units).toBe(4);
    expect(atThree.minUnits).toBe(3);
    expect(atThree.maxUnits).toBe(5);
    // Flat-betting the minimum stops being acceptable from TC +2.5.
    expect(betRamp(2, 6).minUnits).toBe(1);
    expect(betRamp(2.5, 6).minUnits).toBe(2);
  });
});

describe('Illustrious 18 index plays', () => {
  const hs = ['hit', 'stand'] as const;

  it('16 vs 10: stand at TC >= 0, hit below', () => {
    expect(indexPlay('h16-10', 0, 'hit', [...hs], S17).action).toBe('stand');
    expect(indexPlay('h16-10', 2.4, 'hit', [...hs], S17).action).toBe('stand');
    expect(indexPlay('h16-10', -0.1, 'hit', [...hs], S17).action).toBe('hit');
  });

  it('12 vs 5: basic stands, but a very negative shoe hits', () => {
    expect(indexPlay('h12-5', -2.5, 'stand', [...hs], S17).action).toBe('hit');
    expect(indexPlay('h12-5', -1.9, 'stand', [...hs], S17).action).toBe('stand');
  });

  it('10,10 vs 6: split at TC >= +4', () => {
    const avail = ['hit', 'stand', 'split', 'double'];
    expect(indexPlay('p10-6', 4, 'stand', avail, S17).action).toBe('split');
    expect(indexPlay('p10-6', 3.9, 'stand', avail, S17).action).toBe('stand');
  });

  it('11 vs A double index applies to S17 only (basic already doubles in H17)', () => {
    const avail = ['hit', 'stand', 'double'];
    expect(indexPlay('h11-1', 1.5, 'hit', avail, S17).action).toBe('double');
    expect(indexPlay('h11-1', 0.5, 'hit', avail, S17).action).toBe('hit');
    // H17: deviation skipped, basic (double) rules.
    expect(indexPlay('h11-1', 0.5, 'double', avail, H17).action).toBe('double');
    expect(indexPlay('h11-1', 0.5, 'double', avail, H17).deviation).toBeNull();
  });

  it('falls back to basic when the deviation action is unavailable (3+ cards)', () => {
    // 10 vs 10 at TC +5 wants a double, but three-card hands cannot double.
    expect(indexPlay('h10-10', 5, 'hit', ['hit', 'stand'], S17).action).toBe('hit');
  });

  it('Fab 4: surrender 15 vs 10 at TC >= 0, defer to stand index below', () => {
    const avail = ['hit', 'stand', 'surrender'];
    expect(indexPlay('h15-10', 0.2, 'surrender', avail, LS).action).toBe('surrender');
    // Below 0: no surrender; the Illustrious 18 stand-at-+4 branch says hit.
    expect(indexPlay('h15-10', -1, 'surrender', avail, LS).action).toBe('hit');
    // At +4 without surrender available (3 cards): stand.
    expect(indexPlay('h15-10', 4.2, 'hit', ['hit', 'stand'], LS).action).toBe('stand');
  });

  it('no deviation cell → basic strategy', () => {
    const play = indexPlay('s18-3', 5, 'double', ['hit', 'stand', 'double'], S17);
    expect(play.action).toBe('double');
    expect(play.deviation).toBeNull();
  });
});

/** Scripted card source for insurance flow tests. */
function rigged(ranks: Rank[]): { draw(): Card; needsShuffle: boolean; shuffle(): void } {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  let i = 0;
  return {
    draw() {
      const rank = ranks[i++];
      if (rank === undefined) throw new Error('rigged source exhausted');
      return { rank, suit: suits[i % 4], face: rank === 1 ? 'A' : String(rank) };
    },
    needsShuffle: false,
    shuffle() {},
  };
}

describe('insurance flow', () => {
  // Deal order (casino-style): first card to each seat, dealer up, second card each, hole.
  it('offers insurance on an ace up, pays 2:1 against dealer blackjack', () => {
    const round = new Round(S17, rigged([10, 1, 9, 10]), { offerInsurance: true });
    round.deal();
    expect(round.phase).toBe('insurance');
    round.takeInsurance(true);
    expect(round.phase).toBe('settled');
    expect(round.dealerBlackjack).toBe(true);
    expect(round.insuranceNet).toBe(1);
    // Hand loses 1, insurance wins 1 → wash.
    expect(round.summary().net).toBe(0);
  });

  it('insurance loses half a unit when the dealer has no blackjack', () => {
    const round = new Round(S17, rigged([10, 1, 10, 9, 7]), { offerInsurance: true });
    round.deal();
    round.takeInsurance(true);
    expect(round.phase).toBe('player');
    round.act('stand');
    expect(round.phase).toBe('settled');
    expect(round.insuranceNet).toBe(-0.5);
  });

  it('declining insurance costs nothing and play continues', () => {
    const round = new Round(S17, rigged([10, 1, 10, 6]), { offerInsurance: true });
    round.deal();
    round.takeInsurance(false);
    round.act('stand');
    expect(round.insuranceNet).toBe(0);
    // Player 20 beats the dealer's soft 17 (S17 stands).
    expect(round.summary().net).toBe(1);
  });

  it('never offers insurance unless asked, or without an ace up', () => {
    const noOffer = new Round(S17, rigged([10, 1, 9, 10]));
    noOffer.deal();
    expect(noOffer.phase).toBe('settled'); // peek found the blackjack immediately
    const tenUp = new Round(S17, rigged([10, 10, 9, 9, 5]), { offerInsurance: true });
    tenUp.deal();
    expect(tenUp.phase).toBe('player');
  });

  it('player blackjack still settles after the insurance decision', () => {
    const round = new Round(S17, rigged([1, 1, 10, 9]), { offerInsurance: true });
    round.deal();
    expect(round.phase).toBe('insurance');
    round.takeInsurance(false);
    expect(round.phase).toBe('settled');
    expect(round.summary().net).toBe(1.5);
  });
});

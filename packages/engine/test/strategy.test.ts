import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, getStrategy } from '../src';
import type { Action, Rules } from '../src';

/**
 * Fixtures are taken from the source-of-truth engine at
 * https://www.blackjackinfo.com/blackjack-basic-strategy-engine/
 * for the given parameter sets (verified 2026-07-12).
 */

const UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1] as const; // chart column order: 2..10, A

function best(rules: Rules, key: string): Action {
  const cell = getStrategy(rules).getCell(key);
  if (!cell) throw new Error(`missing cell ${key}`);
  return cell.best;
}

function row(rules: Rules, prefix: string): string {
  // One-letter codes in chart column order, e.g. "HDDDDHHHHH"
  const code: Record<Action, string> = {
    hit: 'H',
    stand: 'S',
    double: 'D',
    split: 'P',
    surrender: 'R',
  };
  return UPS.map((up) => code[best(rules, `${prefix}-${up}`)]).join('');
}

describe('8 decks, S17, DAS, double any two, no surrender, peek (default)', () => {
  const r = DEFAULT_RULES;

  it('matches blackjackinfo hard totals', () => {
    expect(row(r, 'h5')).toBe('HHHHHHHHHH');
    expect(row(r, 'h8')).toBe('HHHHHHHHHH');
    expect(row(r, 'h9')).toBe('HDDDDHHHHH');
    expect(row(r, 'h10')).toBe('DDDDDDDDHH');
    expect(row(r, 'h11')).toBe('DDDDDDDDDH');
    expect(row(r, 'h12')).toBe('HHSSSHHHHH');
    expect(row(r, 'h13')).toBe('SSSSSHHHHH');
    expect(row(r, 'h14')).toBe('SSSSSHHHHH');
    expect(row(r, 'h15')).toBe('SSSSSHHHHH');
    expect(row(r, 'h16')).toBe('SSSSSHHHHH');
    expect(row(r, 'h17')).toBe('SSSSSSSSSS');
  });

  it('matches blackjackinfo soft totals', () => {
    expect(row(r, 's13')).toBe('HHHDDHHHHH');
    expect(row(r, 's14')).toBe('HHHDDHHHHH');
    expect(row(r, 's15')).toBe('HHDDDHHHHH');
    expect(row(r, 's16')).toBe('HHDDDHHHHH');
    expect(row(r, 's17')).toBe('HDDDDHHHHH');
    expect(row(r, 's18')).toBe('SDDDDSSHHH');
    expect(row(r, 's19')).toBe('SSSSSSSSSS');
    expect(row(r, 's20')).toBe('SSSSSSSSSS');
  });

  it('matches blackjackinfo pairs', () => {
    expect(row(r, 'p1')).toBe('PPPPPPPPPP');
    expect(row(r, 'p2')).toBe('PPPPPPHHHH');
    expect(row(r, 'p3')).toBe('PPPPPPHHHH');
    expect(row(r, 'p4')).toBe('HHHPPHHHHH');
    expect(row(r, 'p5')).toBe('DDDDDDDDHH');
    expect(row(r, 'p6')).toBe('PPPPPHHHHH');
    expect(row(r, 'p7')).toBe('PPPPPPHHHH');
    expect(row(r, 'p8')).toBe('PPPPPPPPPP');
    expect(row(r, 'p9')).toBe('PPPPPSPPSS');
    expect(row(r, 'p10')).toBe('SSSSSSSSSS');
  });
});

describe('H17 variations (8 decks, DAS, double any two, no surrender, peek)', () => {
  const r: Rules = { ...DEFAULT_RULES, soft17: 'h17' };

  it('doubles 11 vs ace when the dealer hits soft 17', () => {
    expect(best(r, 'h11-1')).toBe('double');
  });

  it('doubles soft 18 vs 2 and soft 19 vs 6', () => {
    expect(best(r, 's18-2')).toBe('double');
    expect(getStrategy(r).getCell('s18-2')!.fallback).toBe('stand');
    expect(best(r, 's19-6')).toBe('double');
    expect(getStrategy(r).getCell('s19-6')!.fallback).toBe('stand');
  });
});

describe('late surrender (8 decks, S17, DAS, double any two, peek)', () => {
  const r: Rules = { ...DEFAULT_RULES, surrender: 'late' };

  it('surrenders 16 vs 9/10/A and 15 vs 10, and nothing weaker', () => {
    expect(best(r, 'h16-9')).toBe('surrender');
    expect(best(r, 'h16-10')).toBe('surrender');
    expect(best(r, 'h16-1')).toBe('surrender');
    expect(best(r, 'h15-10')).toBe('surrender');
    expect(best(r, 'h15-9')).toBe('hit');
    expect(best(r, 'h14-10')).toBe('hit');
    expect(getStrategy(r).getCell('h16-10')!.fallback).toBe('hit');
  });
});

describe('rule knobs change the chart in the expected direction', () => {
  it('no-DAS kills the marginal splits (2,2 vs 2; 4,4 vs 5; 6,6 vs 2)', () => {
    const r: Rules = { ...DEFAULT_RULES, das: false };
    expect(best(r, 'p2-2')).toBe('hit');
    expect(best(r, 'p4-5')).toBe('hit');
    expect(best(r, 'p6-2')).toBe('hit');
    expect(best(r, 'p8-10')).toBe('split');
  });

  it('double 10-11 only removes soft doubles and 9 doubles', () => {
    const r: Rules = { ...DEFAULT_RULES, double: '10-11' };
    expect(best(r, 'h9-5')).toBe('hit');
    expect(best(r, 's18-5')).toBe('stand');
    expect(best(r, 'h11-6')).toBe('double');
  });

  it('no-peek stops doubling 11 into a ten (full stake lost to dealer BJ)', () => {
    const peek: Rules = { ...DEFAULT_RULES, peek: true };
    const enhc: Rules = { ...DEFAULT_RULES, peek: false };
    expect(best(peek, 'h11-10')).toBe('double');
    expect(best(enhc, 'h11-10')).toBe('hit');
    expect(best(enhc, 'p8-10')).toBe('hit'); // never split 8s into a no-peek ten
  });
});

describe('recommend()', () => {
  const s = getStrategy(DEFAULT_RULES);

  it('grades multi-card hands by total with double fallback', () => {
    // 3+2+6 = hard 11: chart says double, but it is unavailable — fall back to hit.
    const rec = s.recommend([3, 2, 6], 10, ['hit', 'stand']);
    expect(rec.action).toBe('hit');
    expect(rec.cell.best).toBe('double');
  });

  it('uses the pair row only when split is actually available', () => {
    const canSplit = s.recommend([8, 8], 10, ['hit', 'stand', 'double', 'split']);
    expect(canSplit.action).toBe('split');
    const noSplit = s.recommend([8, 8], 10, ['hit', 'stand']);
    expect(noSplit.action).toBe('hit'); // hard 16 vs 10
  });

  it('always stands on 21', () => {
    expect(s.recommend([10, 5, 6], 10, ['hit', 'stand']).action).toBe('stand');
  });

  it('reports live EVs for every available action', () => {
    const rec = s.recommend([6, 5], 6, ['hit', 'stand', 'double']);
    expect(rec.evs.double).toBeGreaterThan(rec.evs.hit);
    expect(rec.evs.hit).toBeGreaterThan(rec.evs.stand);
  });
});

describe('theoretical RTP', () => {
  it('is ~99.5% for the default rules', () => {
    const rtp = getStrategy(DEFAULT_RULES).theoreticalRTP();
    // Published house edge for 8D/S17/DAS/no surrender/peek is ≈0.45%;
    // our split model (no resplits) is very slightly pessimistic.
    expect(rtp).toBeGreaterThan(0.992);
    expect(rtp).toBeLessThan(0.998);
  });

  it('improves with late surrender and worsens without DAS', () => {
    const base = getStrategy(DEFAULT_RULES).theoreticalRTP();
    const ls = getStrategy({ ...DEFAULT_RULES, surrender: 'late' }).theoreticalRTP();
    const noDas = getStrategy({ ...DEFAULT_RULES, das: false }).theoreticalRTP();
    expect(ls).toBeGreaterThan(base);
    expect(noDas).toBeLessThan(base);
  });
});

describe('single deck compositions', () => {
  it('builds a full chart without impossible compositions', () => {
    const s = getStrategy({ ...DEFAULT_RULES, decks: 1 });
    expect(s.allCells().length).toBeGreaterThan(300);
    // Famous single-deck deviation: double 11 vs ten-up (S17, peek).
    expect(s.getCell('h11-10')!.best).toBe('double');
  });
});

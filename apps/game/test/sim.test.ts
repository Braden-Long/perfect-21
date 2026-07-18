import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, Shoe, getStrategy } from '@perfect21/engine';
import { simulateBatch } from '../src/sim';

describe('strategy simulator', () => {
  const strat = getStrategy(DEFAULT_RULES);
  const theo = strat.theoreticalRTP();

  const run = (skill: number, hands: number) => {
    const b = simulateBatch(strat, new Shoe(DEFAULT_RULES.decks), hands, skill);
    return {
      actual: 1 + b.net / b.wagered,
      expected: theo - b.evLoss / b.wagered,
      adher: b.matched / b.decisions,
    };
  };

  it('perfect discipline has zero EV loss, so expected RTP equals theory', () => {
    const r = run(1, 200000);
    expect(r.expected).toBeCloseTo(theo, 4); // no misplays => no EV given up
    expect(r.adher).toBe(1);
    // actual return tracks theory within sampling noise (SE ~0.3% at 200k hands)
    expect(Math.abs(r.actual - theo)).toBeLessThan(0.01);
  });

  it('less discipline strictly lowers expected RTP', () => {
    const perfect = run(1, 150000).expected;
    const sloppy = run(0.85, 150000).expected;
    const bad = run(0.6, 150000).expected;
    expect(sloppy).toBeLessThan(perfect);
    expect(bad).toBeLessThan(sloppy);
  });
});

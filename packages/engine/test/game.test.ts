import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, Round, SessionStats, Shoe, computeRank } from '../src';
import type { Card, CardSource, Rules } from '../src';

/** Deals a scripted sequence of ranks, then falls back to 7s. */
function rigged(ranks: number[]): CardSource {
  const queue = [...ranks];
  return {
    draw(): Card {
      const rank = (queue.shift() ?? 7) as Card['rank'];
      return { rank, face: rank === 1 ? 'A' : String(rank), suit: 'S' };
    },
    needsShuffle: false,
    shuffle() {},
  };
}

describe('Round', () => {
  it('pays 3:2 on player blackjack', () => {
    // player: A,10 — dealer: 9 up, 8 hole
    const round = new Round(DEFAULT_RULES, rigged([1, 9, 10, 8]));
    round.deal();
    expect(round.phase).toBe('settled');
    const s = round.summary();
    expect(s.playerBlackjack).toBe(true);
    expect(s.net).toBe(1.5);
  });

  it('pushes player blackjack against dealer blackjack', () => {
    // player: A,10 — dealer: A up, 10 hole (peek finds it immediately)
    const round = new Round(DEFAULT_RULES, rigged([1, 1, 10, 10]));
    round.deal();
    const s = round.summary();
    expect(s.dealerBlackjack).toBe(true);
    expect(s.net).toBe(0);
  });

  it('peek ends the round before decisions when dealer has blackjack', () => {
    // player: 10,6 — dealer: 10 up, A hole
    const round = new Round(DEFAULT_RULES, rigged([10, 10, 6, 1]));
    round.deal();
    expect(round.phase).toBe('settled');
    expect(round.summary().net).toBe(-1);
  });

  it('plays a double for twice the stake', () => {
    // player: 6,5 — dealer: 5 up, 10 hole; player draws 10 (21), dealer draws 10 -> 25 bust
    const round = new Round(DEFAULT_RULES, rigged([6, 5, 5, 10, 10, 10]));
    round.deal();
    expect(round.availableActions()).toContain('double');
    round.act('double');
    const s = round.summary();
    expect(s.hands[0].doubled).toBe(true);
    expect(s.net).toBe(2);
  });

  it('splits into two playable hands and settles each', () => {
    // player: 8,8 — dealer: 6 up, 10 hole.
    // Split: hand1 gets 10 (18, stand), hand2 gets 3 (11, double, draws 10 -> 21).
    // Dealer 16 draws 10 -> 26 bust. Net: +1 (hand1) +2 (hand2) = +3.
    const round = new Round(DEFAULT_RULES, rigged([8, 6, 8, 10, 10, 3, 10, 10]));
    round.deal();
    round.act('split');
    expect(round.hands.length).toBe(2);
    round.act('stand');
    expect(round.availableActions()).toContain('double'); // DAS
    round.act('double');
    const s = round.summary();
    expect(s.net).toBe(3);
  });

  it('gives split aces exactly one card each', () => {
    // player: A,A — dealer: 6 up, 10 hole; aces draw 10 and 9; dealer 16 -> +7 = 23 bust... use scripted 5: 21 stand
    const round = new Round(DEFAULT_RULES, rigged([1, 6, 1, 10, 10, 9, 5]));
    round.deal();
    round.act('split');
    expect(round.phase).not.toBe('player'); // no further decisions
    const s = round.summary();
    expect(s.hands[0].cards.length).toBe(2);
    expect(s.hands[1].cards.length).toBe(2);
    // 21 on split aces is not blackjack: dealer 6,10,5 = 21 pushes the A,10 hand.
    expect(s.hands[0].result).toBe('push');
    expect(s.hands[1].result).toBe('lose'); // 20 vs 21
  });

  it('supports late surrender for half the bet', () => {
    const rules: Rules = { ...DEFAULT_RULES, surrender: 'late' };
    // player: 10,6 — dealer: 9 up, 9 hole
    const round = new Round(rules, rigged([10, 9, 6, 9]));
    round.deal();
    expect(round.availableActions()).toContain('surrender');
    round.act('surrender');
    expect(round.summary().net).toBe(-0.5);
  });

  it('no-peek deals the hole card only after the player acts', () => {
    const rules: Rules = { ...DEFAULT_RULES, peek: false };
    // player: 10,9 — dealer: 10 up ... player stands, hole: A => dealer blackjack, full loss
    const round = new Round(rules, rigged([10, 10, 9, 1]));
    round.deal();
    expect(round.phase).toBe('player'); // no peek — round continues under a ten
    round.act('stand');
    const s = round.summary();
    expect(s.dealerBlackjack).toBe(true);
    expect(s.net).toBe(-1);
  });

  it('early surrender keeps half the bet against a no-peek dealer blackjack; late loses it all', () => {
    // player: 10,6 — dealer: 10 up; player surrenders; hole turns out to be an ace.
    const early = new Round(
      { ...DEFAULT_RULES, peek: false, surrender: 'early' },
      rigged([10, 10, 6, 1])
    );
    early.deal();
    early.act('surrender');
    expect(early.summary().dealerBlackjack).toBe(true);
    expect(early.summary().net).toBe(-0.5); // decided pre-hole: half stays yours

    const late = new Round(
      { ...DEFAULT_RULES, peek: false, surrender: 'late' },
      rigged([10, 10, 6, 1])
    );
    late.deal();
    late.act('surrender');
    expect(late.summary().dealerBlackjack).toBe(true);
    expect(late.summary().net).toBe(-1); // late surrender has no blackjack protection
  });

  it('dealer hits soft 17 under H17 rules', () => {
    const rules: Rules = { ...DEFAULT_RULES, soft17: 'h17' };
    // player: 10,8 stand — dealer: A up, 6 hole (soft 17) draws 10 -> hard 17
    const round = new Round(rules, rigged([10, 1, 8, 6, 10]));
    round.deal();
    round.act('stand');
    const s = round.summary();
    expect(s.dealerCards.length).toBe(3);
    expect(s.net).toBe(1); // 18 beats 17
  });

  it('plays three seats right through splits and settles each spot', () => {
    // Casino order: seat0 gets 10, seat1 8, seat2 6 — dealer up 6 — then 9, 8, 5 — hole 10.
    // Seat0: 19 stand. Seat1: 8,8 split → draws 10 (18 stand) and 3→double? keep simple: stand both.
    // Seat2: 11 doubles, draws 10 → 21. Dealer 16 draws 10 → bust: every spot wins.
    const round = new Round(
      DEFAULT_RULES,
      rigged([10, 8, 6, 6, 9, 8, 5, 10, 10, 3, 10, 10]),
      { seats: 3 }
    );
    round.deal();
    expect(round.hands.length).toBe(3);
    expect(round.hands.map((h) => h.seat)).toEqual([0, 1, 2]);
    round.act('stand'); // seat 0: 19
    expect(round.activeHand.seat).toBe(1);
    round.act('split'); // seat 1: 8,8 → two hands, both seat 1
    expect(round.hands.filter((h) => h.seat === 1).length).toBe(2);
    round.act('stand'); // 8,10 = 18
    round.act('stand'); // 8,3 = 11 (keeping it, the dealer will bust anyway)
    expect(round.activeHand.seat).toBe(2);
    round.act('double'); // 6,5 = 11 doubles into a 10 → 21
    const s = round.summary();
    expect(s.initialBet).toBe(3);
    expect(s.seatNets).toEqual([1, 2, 2]); // dealer busts: 1 + (1+1 split) + 2 (double)
    expect(s.net).toBe(5);
  });

  it('multi-seat naturals settle without decisions and insurance covers every seat', () => {
    // Two seats: A,10 (natural) and 10,9. Dealer A up, 9 hole — insurance offered first.
    const round = new Round(DEFAULT_RULES, rigged([1, 10, 1, 10, 9, 9]), {
      seats: 2,
      offerInsurance: true,
    });
    round.deal();
    expect(round.phase).toBe('insurance');
    round.takeInsurance(true);
    // No dealer BJ: insurance loses half a unit per seat.
    expect(round.phase).toBe('player');
    expect(round.activeHand.seat).toBe(1); // the natural needed no decision
    round.act('stand');
    const s = round.summary();
    expect(round.insuranceNet).toBe(-1);
    expect(s.seatNets[0]).toBeCloseTo(1.5 - 0.5); // blackjack minus its insurance share
    expect(s.seatNets[1]).toBeCloseTo(-1.5); // 19 loses to the dealer's soft 20, plus insurance
  });

  it('draws real cards from a seeded shoe without errors', () => {
    let seed = 42;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const shoe = new Shoe(8, rng);
    for (let i = 0; i < 200; i++) {
      const round = new Round(DEFAULT_RULES, shoe);
      round.deal();
      let guard = 0;
      while (round.phase === 'player' && guard++ < 20) {
        const actions = round.availableActions();
        round.act(actions.includes('stand') ? 'stand' : actions[0]);
      }
      expect(round.phase).toBe('settled');
      round.summary();
    }
  });
});

describe('SessionStats', () => {
  it('tracks RTP per initial bet and EV loss', () => {
    const stats = new SessionStats();
    stats.addRound({ net: 1.5, initialBet: 1, seatNets: [1.5], hands: [], dealerCards: [], dealerBlackjack: false, playerBlackjack: true });
    stats.addRound({ net: -1, initialBet: 1, seatNets: [-1], hands: [], dealerCards: [], dealerBlackjack: false, playerBlackjack: false });
    stats.addDecision({ correct: true, evLoss: 0, chosen: 'hit', recommended: 'hit' });
    stats.addDecision({ correct: false, evLoss: 0.08, chosen: 'stand', recommended: 'hit' });
    expect(stats.actualRTP).toBeCloseTo(1.25);
    expect(stats.accuracy).toBe(0.5);
    expect(stats.expectedRTP(0.9954)).toBeCloseTo(0.9954 - 0.04);
  });
});

describe('computeRank', () => {
  it('withholds a rank until enough decisions exist', () => {
    const r = computeRank(new Array(10).fill(true));
    expect(r.tier).toBeNull();
    expect(r.needed).toBe(40);
  });

  it('assigns tiers from rolling accuracy', () => {
    expect(computeRank(new Array(100).fill(true).map((_, i) => i % 5 !== 0)).tier!.id).toBe('bronze'); // 80%
    const mostlyRight = [...new Array(95).fill(true), ...new Array(5).fill(false)];
    expect(computeRank(mostlyRight).tier!.id).toBe('gold'); // 95%
    expect(computeRank(new Array(150).fill(true)).tier!.id).toBe('perfect');
    // 100% but window too small for Perfect: 60 decisions
    expect(computeRank(new Array(60).fill(true)).tier!.id).toBe('diamond');
  });
});

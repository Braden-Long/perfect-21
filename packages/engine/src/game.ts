import { cardRanks, handValue } from './cards';
import type { Action, Card, Rules } from './types';

export interface CardSource {
  draw(): Card;
  needsShuffle: boolean;
  shuffle(): void;
}

export type HandResult = 'blackjack' | 'win' | 'push' | 'lose' | 'surrender';

export interface HandState {
  cards: Card[];
  bet: number;
  doubled: boolean;
  surrendered: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  done: boolean;
  /** Which betting spot this hand belongs to (splits inherit their seat). */
  seat: number;
  result?: HandResult;
  net?: number;
}

export type Phase = 'idle' | 'insurance' | 'player' | 'dealer' | 'settled';

export interface RoundSummary {
  /** Net units won/lost across all hands this round (insurance included). */
  net: number;
  /** Units initially wagered: one per seat (doubles/splits are extra risk, not extra rounds). */
  initialBet: number;
  /** Net units per seat, insurance included, for per-initial-bet accounting. */
  seatNets: number[];
  hands: HandState[];
  dealerCards: Card[];
  dealerBlackjack: boolean;
  playerBlackjack: boolean;
}

/** Max hands one seat can split into. */
const MAX_HANDS = 4;
export const MAX_SEATS = 3;

/**
 * One round of blackjack against the dealer, over one or more seats. Owns
 * dealing, the player-turn hand cursor (seats play in order, splits in
 * place), dealer resolution and settlement. Decision grading lives in the
 * Strategy class; the UI asks for a recommendation before calling act().
 */
export class Round {
  readonly rules: Rules;
  private source: CardSource;
  /** Offer insurance on an ace upcard (peek games only). Off for pure basic-strategy modes. */
  readonly offerInsurance: boolean;
  /** Betting spots in play; every seat posts the same 1-unit initial bet. */
  readonly seats: number;

  phase: Phase = 'idle';
  hands: HandState[] = [];
  active = 0;
  dealerCards: Card[] = [];
  holeDealt = false;
  holeRevealed = false;
  dealerBlackjack = false;
  insured = false;
  /** Units won/lost on the insurance side bet: +1 (dealer BJ), −0.5, or 0. */
  insuranceNet = 0;

  constructor(rules: Rules, source: CardSource, opts?: { offerInsurance?: boolean; seats?: number }) {
    this.rules = rules;
    this.source = source;
    this.offerInsurance = opts?.offerInsurance ?? false;
    this.seats = Math.min(Math.max(opts?.seats ?? 1, 1), MAX_SEATS);
  }

  private newHand(cards: Card[], seat: number, fromSplit = false, splitAces = false): HandState {
    return {
      cards,
      bet: 1,
      doubled: false,
      surrendered: false,
      fromSplit,
      splitAces,
      done: false,
      seat,
    };
  }

  /** A natural: two-card 21 on a hand that isn't the child of a split. */
  private isNatural(hand: HandState): boolean {
    return !hand.fromSplit && handValue(cardRanks(hand.cards)).blackjack;
  }

  get activeHand(): HandState {
    return this.hands[this.active];
  }

  get dealerUp(): Card {
    return this.dealerCards[0];
  }

  deal(): void {
    if (this.source.needsShuffle) this.source.shuffle();
    // Casino order: one card to each seat, dealer up, second card to each.
    this.hands = [];
    for (let s = 0; s < this.seats; s++) this.hands.push(this.newHand([this.source.draw()], s));
    this.active = 0;
    this.dealerCards = [this.source.draw()];
    for (const hand of this.hands) hand.cards.push(this.source.draw());
    this.holeDealt = false;
    this.holeRevealed = false;
    this.dealerBlackjack = false;
    this.phase = 'player';

    const upRank = this.dealerUp.rank;
    if (this.rules.peek) {
      // Hole card goes down immediately; dealer checks under A/10.
      this.dealerCards.push(this.source.draw());
      this.holeDealt = true;
      if (upRank === 1 && this.offerInsurance) {
        // Insurance is decided before the dealer peeks.
        this.phase = 'insurance';
        return;
      }
      if (upRank === 1 || upRank === 10) {
        if (handValue(cardRanks(this.dealerCards)).blackjack) {
          this.dealerBlackjack = true;
          this.holeRevealed = true;
          this.settle();
          return;
        }
      }
    }
    this.settleNaturalsAndAdvance();
  }

  /** Resolve the insurance decision, then let the dealer peek and play on. */
  takeInsurance(take: boolean): void {
    if (this.phase !== 'insurance') throw new Error('insurance not on offer');
    this.insured = take;
    this.phase = 'player';
    if (handValue(cardRanks(this.dealerCards)).blackjack) {
      this.dealerBlackjack = true;
      this.holeRevealed = true;
      this.settle();
      return;
    }
    this.settleNaturalsAndAdvance();
  }

  /** Naturals need no decisions; move the cursor to the first live hand. */
  private settleNaturalsAndAdvance(): void {
    for (const hand of this.hands) {
      if (this.isNatural(hand)) hand.done = true;
    }
    this.advance();
  }

  availableActions(): Action[] {
    if (this.phase !== 'player') return [];
    const hand = this.activeHand;
    const ranks = cardRanks(hand.cards);
    const v = handValue(ranks);
    if (v.bust || v.total === 21 || hand.done) return [];
    const actions: Action[] = ['hit', 'stand'];
    if (ranks.length === 2) {
      const dblRule =
        this.rules.double === 'all' ||
        (!v.soft &&
          (this.rules.double === '10-11'
            ? v.total === 10 || v.total === 11
            : v.total >= 9 && v.total <= 11));
      if (dblRule && (!hand.fromSplit || this.rules.das)) actions.push('double');
      if (
        ranks[0] === ranks[1] &&
        this.hands.filter((h) => h.seat === hand.seat).length < MAX_HANDS &&
        !(hand.fromSplit && ranks[0] === 1)
      ) {
        actions.push('split');
      }
      if (this.rules.surrender !== 'none' && !hand.fromSplit) {
        actions.push('surrender');
      }
    }
    return actions;
  }

  act(action: Action): void {
    if (this.phase !== 'player') throw new Error('no player turn in progress');
    if (!this.availableActions().includes(action)) throw new Error(`action not available: ${action}`);
    const hand = this.activeHand;
    switch (action) {
      case 'hit': {
        hand.cards.push(this.source.draw());
        const v = handValue(cardRanks(hand.cards));
        if (v.bust || v.total === 21) hand.done = true;
        break;
      }
      case 'stand':
        hand.done = true;
        break;
      case 'double': {
        hand.cards.push(this.source.draw());
        hand.bet = 2;
        hand.doubled = true;
        hand.done = true;
        break;
      }
      case 'surrender':
        hand.surrendered = true;
        hand.done = true;
        break;
      case 'split': {
        const [c1, c2] = hand.cards;
        const aces = c1.rank === 1;
        const first = this.newHand([c1], hand.seat, true, aces);
        const second = this.newHand([c2], hand.seat, true, aces);
        this.hands.splice(this.active, 1, first, second);
        first.cards.push(this.source.draw());
        if (aces) {
          // Split aces receive exactly one card each.
          second.cards.push(this.source.draw());
          first.done = true;
          second.done = true;
        } else if (handValue(cardRanks(first.cards)).total === 21) {
          first.done = true;
        }
        break;
      }
    }
    this.advance();
  }

  private advance(): void {
    while (this.active < this.hands.length) {
      const hand = this.hands[this.active];
      if (!hand.done) {
        // Split hands are dealt their second card when play reaches them.
        if (hand.fromSplit && hand.cards.length === 1) {
          hand.cards.push(this.source.draw());
          const v = handValue(cardRanks(hand.cards));
          if (v.total === 21) hand.done = true;
          else return;
        } else {
          return;
        }
      }
      if (!hand.done) return;
      this.active++;
    }
    this.finishPlayerTurn();
  }

  private finishPlayerTurn(): void {
    this.phase = 'dealer';
    if (!this.holeDealt) {
      this.dealerCards.push(this.source.draw());
      this.holeDealt = true;
    }
    this.holeRevealed = true;
    if (handValue(cardRanks(this.dealerCards)).blackjack) {
      this.dealerBlackjack = true;
      this.settle();
      return;
    }
    // The dealer only draws out when at least one hand still needs beating —
    // naturals, busts and surrenders are already decided.
    const anyLive = this.hands.some((h) => {
      const v = handValue(cardRanks(h.cards));
      return !h.surrendered && !v.bust && !this.isNatural(h);
    });
    if (anyLive) {
      for (;;) {
        const v = handValue(cardRanks(this.dealerCards));
        const stands =
          v.total > 17 || (v.total === 17 && (!v.soft || this.rules.soft17 === 's17'));
        if (v.bust || stands) break;
        this.dealerCards.push(this.source.draw());
      }
    }
    this.settle();
  }

  private settle(): void {
    // Insurance is half a unit per seat, decided once for the whole round.
    this.insuranceNet = this.insured ? this.seats * (this.dealerBlackjack ? 1 : -0.5) : 0;
    const dv = handValue(cardRanks(this.dealerCards));
    for (const hand of this.hands) {
      const v = handValue(cardRanks(hand.cards));
      const isBJ = this.isNatural(hand);
      if (this.dealerBlackjack) {
        if (isBJ) {
          hand.result = 'push';
          hand.net = 0;
        } else if (hand.surrendered && this.rules.peek) {
          hand.result = 'surrender';
          hand.net = -0.5;
        } else {
          // No-peek: the full stake (doubles/splits included) loses to a
          // dealer blackjack; a peek game never reaches here with extra bets.
          hand.result = 'lose';
          hand.net = -hand.bet;
        }
      } else if (hand.surrendered) {
        hand.result = 'surrender';
        hand.net = -0.5;
      } else if (isBJ) {
        hand.result = 'blackjack';
        hand.net = 1.5;
      } else if (v.bust) {
        hand.result = 'lose';
        hand.net = -hand.bet;
      } else if (dv.bust || v.total > dv.total) {
        hand.result = 'win';
        hand.net = hand.bet;
      } else if (v.total === dv.total) {
        hand.result = 'push';
        hand.net = 0;
      } else {
        hand.result = 'lose';
        hand.net = -hand.bet;
      }
      hand.done = true;
    }
    this.phase = 'settled';
  }

  summary(): RoundSummary {
    if (this.phase !== 'settled') throw new Error('round not settled');
    const net = this.hands.reduce((s, h) => s + (h.net ?? 0), 0) + this.insuranceNet;
    const seatNets = Array.from({ length: this.seats }, (_, seat) => {
      const handsNet = this.hands
        .filter((h) => h.seat === seat)
        .reduce((s, h) => s + (h.net ?? 0), 0);
      return handsNet + this.insuranceNet / this.seats;
    });
    return {
      net,
      initialBet: this.seats,
      seatNets,
      hands: this.hands,
      dealerCards: this.dealerCards,
      dealerBlackjack: this.dealerBlackjack,
      playerBlackjack: this.hands.some((h) => this.isNatural(h)),
    };
  }
}

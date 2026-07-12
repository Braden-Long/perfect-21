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
  result?: HandResult;
  net?: number;
}

export type Phase = 'idle' | 'player' | 'dealer' | 'settled';

export interface RoundSummary {
  /** Net units won/lost across all hands this round. */
  net: number;
  /** Units initially wagered (always 1 — doubles/splits are extra risk, not extra rounds). */
  initialBet: 1;
  hands: HandState[];
  dealerCards: Card[];
  dealerBlackjack: boolean;
  playerBlackjack: boolean;
}

const MAX_HANDS = 4;

/**
 * One seat of blackjack against the dealer. Owns dealing, the player-turn
 * hand cursor, dealer resolution and settlement. Decision grading lives in
 * the Strategy class; the UI asks for a recommendation before calling act().
 */
export class Round {
  readonly rules: Rules;
  private source: CardSource;

  phase: Phase = 'idle';
  hands: HandState[] = [];
  active = 0;
  dealerCards: Card[] = [];
  holeDealt = false;
  holeRevealed = false;
  dealerBlackjack = false;

  constructor(rules: Rules, source: CardSource) {
    this.rules = rules;
    this.source = source;
  }

  private newHand(cards: Card[], fromSplit = false, splitAces = false): HandState {
    return { cards, bet: 1, doubled: false, surrendered: false, fromSplit, splitAces, done: false };
  }

  get activeHand(): HandState {
    return this.hands[this.active];
  }

  get dealerUp(): Card {
    return this.dealerCards[0];
  }

  deal(): void {
    if (this.source.needsShuffle) this.source.shuffle();
    this.hands = [this.newHand([this.source.draw(), this.source.draw()])];
    this.active = 0;
    this.dealerCards = [this.source.draw()];
    this.holeDealt = false;
    this.holeRevealed = false;
    this.dealerBlackjack = false;
    this.phase = 'player';

    const upRank = this.dealerUp.rank;
    if (this.rules.peek) {
      // Hole card goes down immediately; dealer checks under A/10.
      this.dealerCards.push(this.source.draw());
      this.holeDealt = true;
      if (upRank === 1 || upRank === 10) {
        if (handValue(cardRanks(this.dealerCards)).blackjack) {
          this.dealerBlackjack = true;
          this.holeRevealed = true;
          this.settle();
          return;
        }
      }
    }
    if (handValue(cardRanks(this.hands[0].cards)).blackjack) {
      this.hands[0].done = true;
      this.finishPlayerTurn();
    }
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
        this.hands.length < MAX_HANDS &&
        !(hand.fromSplit && ranks[0] === 1)
      ) {
        actions.push('split');
      }
      if (this.rules.surrender !== 'none' && !hand.fromSplit && this.hands.length === 1) {
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
        const first = this.newHand([c1], true, aces);
        const second = this.newHand([c2], true, aces);
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
    const anyLive = this.hands.some((h) => {
      const v = handValue(cardRanks(h.cards));
      return !h.surrendered && !v.bust;
    });
    const playerBJ = this.hands.length === 1 && handValue(cardRanks(this.hands[0].cards)).blackjack;
    if (anyLive && !playerBJ) {
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
    const dv = handValue(cardRanks(this.dealerCards));
    for (const hand of this.hands) {
      const v = handValue(cardRanks(hand.cards));
      const isBJ = !hand.fromSplit && this.hands.length === 1 && v.blackjack;
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
    const net = this.hands.reduce((s, h) => s + (h.net ?? 0), 0);
    return {
      net,
      initialBet: 1,
      hands: this.hands,
      dealerCards: this.dealerCards,
      dealerBlackjack: this.dealerBlackjack,
      playerBlackjack:
        this.hands.length === 1 && handValue(cardRanks(this.hands[0].cards)).blackjack,
    };
  }
}

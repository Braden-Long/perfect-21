import type { Card, HandValue, Rank, Suit } from './types';

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
const FACES: Array<{ face: string; rank: Rank }> = [
  { face: 'A', rank: 1 },
  { face: '2', rank: 2 },
  { face: '3', rank: 3 },
  { face: '4', rank: 4 },
  { face: '5', rank: 5 },
  { face: '6', rank: 6 },
  { face: '7', rank: 7 },
  { face: '8', rank: 8 },
  { face: '9', rank: 9 },
  { face: '10', rank: 10 },
  { face: 'J', rank: 10 },
  { face: 'Q', rank: 10 },
  { face: 'K', rank: 10 },
];

export function handValue(ranks: number[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const r of ranks) {
    total += r;
    if (r === 1) aces++;
  }
  let soft = false;
  if (aces > 0 && total + 10 <= 21) {
    total += 10;
    soft = true;
  }
  return {
    total,
    soft,
    blackjack: ranks.length === 2 && total === 21,
    bust: total > 21,
  };
}

export function cardRanks(cards: Card[]): number[] {
  return cards.map((c) => c.rank);
}

/** Deterministic when given a seeded rng; defaults to Math.random. */
export class Shoe {
  private cards: Card[] = [];
  private cut = 0;
  readonly decks: number;
  private rng: () => number;

  constructor(decks: number, rng: () => number = Math.random) {
    this.decks = decks;
    this.rng = rng;
    this.shuffle();
  }

  shuffle(): void {
    this.cards = [];
    for (let d = 0; d < this.decks; d++) {
      for (const suit of SUITS) {
        for (const { face, rank } of FACES) {
          this.cards.push({ face, rank, suit });
        }
      }
    }
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    // Cut card at 75% penetration (reshuffle between rounds once reached).
    this.cut = Math.floor(this.cards.length * 0.25);
  }

  draw(): Card {
    const card = this.cards.pop();
    if (!card) {
      this.shuffle();
      return this.draw();
    }
    return card;
  }

  get needsShuffle(): boolean {
    return this.cards.length <= this.cut;
  }

  get remaining(): number {
    return this.cards.length;
  }
}

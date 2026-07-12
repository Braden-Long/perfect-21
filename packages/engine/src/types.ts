/**
 * Rule space mirrors the blackjackinfo.com basic strategy engine URL parameters:
 *   numdecks (1-8), soft17 (s17|h17), dbl (all|10,11|9,10,11),
 *   das (yes|no), surr (ns|ls|es), peek (yes|no)
 */
export type Soft17Rule = 's17' | 'h17';
export type DoubleRule = 'all' | '10-11' | '9-11';
export type SurrenderRule = 'none' | 'late' | 'early';

export interface Rules {
  decks: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  soft17: Soft17Rule;
  double: DoubleRule;
  das: boolean;
  surrender: SurrenderRule;
  peek: boolean;
}

export const DEFAULT_RULES: Rules = {
  decks: 8,
  soft17: 's17',
  double: 'all',
  das: true,
  surrender: 'none',
  peek: true,
};

export function rulesKey(r: Rules): string {
  return `${r.decks}d-${r.soft17}-${r.double}-das${r.das ? 1 : 0}-${r.surrender}-peek${r.peek ? 1 : 0}`;
}

/** URL of the equivalent chart on the source-of-truth engine. */
export function blackjackinfoUrl(r: Rules): string {
  const dbl = r.double === 'all' ? 'all' : r.double === '10-11' ? '10%2C11' : '9%2C10%2C11';
  const surr = r.surrender === 'none' ? 'ns' : r.surrender === 'late' ? 'ls' : 'es';
  return (
    'https://www.blackjackinfo.com/blackjack-basic-strategy-engine/' +
    `?numdecks=${r.decks}&soft17=${r.soft17}&dbl=${dbl}&das=${r.das ? 'yes' : 'no'}` +
    `&surr=${surr}&peek=${r.peek ? 'yes' : 'no'}`
  );
}

/** Card rank: 1 = Ace, 2-9 pip, 10 = any ten-value (T/J/Q/K). */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type Suit = 'S' | 'H' | 'D' | 'C';

export interface Card {
  rank: Rank;
  /** Display face: A,2..9,10,J,Q,K — ranks 10/J/Q/K all have rank === 10. */
  face: string;
  suit: Suit;
}

export type Action = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

export const ACTION_LABEL: Record<Action, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender',
};

export interface HandValue {
  total: number;
  soft: boolean;
  blackjack: boolean;
  bust: boolean;
}

import { handValue } from './cards';
import type { Recommendation, Strategy } from './strategy';
import type { Action } from './types';

const UP_NAME: Record<number, string> = {
  1: 'ace',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'ten',
};

const SPLIT_REASONS: Record<number, string> = {
  1: 'A pair of aces is 2 or 12 as one hand, but two chances at 21 when split — the single strongest split in the game.',
  2: 'Low pairs make weak totals; against a vulnerable dealer card, two small hands beat one bad one.',
  3: 'Low pairs make weak totals; against a vulnerable dealer card, two small hands beat one bad one.',
  4: 'Eight is a poor total but two 4s can each become 14+ doubles against a weak dealer card — split only when the dealer is most likely to bust.',
  6: 'Twelve is a bust-prone total; against a weak dealer upcard, two hands starting from 6 recover more value.',
  7: 'Fourteen loses too often as-is; two hands starting from 7 fare better while the dealer is weak.',
  8: 'Sixteen is the worst total in blackjack — splitting turns it into two live hands starting from 8.',
  9: 'Eighteen sounds good but two 9-starting hands earn more against these upcards. (Against a 7, your 18 already beats the dealer’s likely 17 — stand there.)',
};

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/**
 * A short human explanation of why the recommended action is correct.
 * The EV numbers shown alongside come from Recommendation.evs.
 */
export function explain(strategy: Strategy, ranks: number[], up: number, rec: Recommendation): string {
  const v = handValue(ranks);
  const bust = strategy.dealerBust(up);
  const upName = UP_NAME[up];
  const dealerWeak = up >= 2 && up <= 6;

  switch (rec.action) {
    case 'surrender':
      return `Against a dealer ${upName}, playing ${v.total} out costs more than half your bet on average. Taking the guaranteed −50% is the cheaper way to lose.`;
    case 'split':
      return (
        SPLIT_REASONS[ranks[0]] ??
        `Splitting these is worth more than playing them as ${v.total}.`
      );
    case 'double': {
      if (v.soft) {
        return `A soft ${v.total} can’t bust, and the dealer’s ${upName} busts ${pct(bust)} of the time. When you’re this safe against a card this weak, put more money on the table.`;
      }
      return `One card off ${v.total} makes a strong hand often, and the dealer’s ${upName} busts ${pct(bust)} of the time. You have the edge — double to press it.`;
    }
    case 'stand': {
      if (v.total >= 17 && !v.soft) {
        return `Hard ${v.total} is a made hand — drawing busts far more value than it creates.`;
      }
      if (v.soft) {
        return `Soft ${v.total} already beats or pushes most dealer outcomes here; drawing risks turning a winner into a loser.`;
      }
      return `Your ${v.total} can bust, but the dealer’s ${upName} busts ${pct(bust)} of the time all by itself. Don’t take the dealer’s risk for them — stand and let the ${upName} self-destruct.`;
    }
    case 'hit': {
      if (v.total <= 11 && !v.soft) {
        return `You can’t bust a ${v.total} — taking a card is free improvement.`;
      }
      if (v.soft) {
        return `A soft ${v.total} can’t bust on the next card, and it isn’t strong enough to stand on against a ${upName}. Draw.`;
      }
      if (dealerWeak) {
        return `Even against a ${upName}, ${v.total} is too weak to win on its own often enough — improving is worth the bust risk here.`;
      }
      return `The dealer’s ${upName} makes 17+ about ${pct(1 - bust)} of the time, so your ${v.total} almost never wins standing. You must risk the bust to have a chance.`;
    }
  }
}

export function actionPhrase(action: Action): string {
  switch (action) {
    case 'hit':
      return 'hitting';
    case 'stand':
      return 'standing';
    case 'double':
      return 'doubling';
    case 'split':
      return 'splitting';
    case 'surrender':
      return 'surrendering';
  }
}

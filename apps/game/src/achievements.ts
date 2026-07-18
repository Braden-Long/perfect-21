import { RANK_TIERS, computeRank } from '@perfect21/engine';
import type { Profile } from './profile';
import { saveProfile } from './profile';

/**
 * Achievements are pure functions of the profile: every condition derives from
 * counters the tables already maintain, so unlocks can never be gamed from the
 * drill or the count trainer (which touch no profile stats by design).
 */
export interface Achievement {
  id: string;
  icon: string;
  name: string;
  desc: string;
  earned: (p: Profile) => boolean;
}

const tableRounds = (p: Profile) => p.totalRounds + p.countingRounds;
const countingPlaysCorrect = (p: Profile) =>
  p.countingCorrect - p.countingBetsCorrect - p.countingInsCorrect;
const tierIndex = (p: Profile) => {
  const tier = computeRank(p.history).tier;
  return tier ? RANK_TIERS.findIndex((t) => t.id === tier.id) : -1;
};
const GOLD = RANK_TIERS.findIndex((t) => t.id === 'gold');

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first-hand',
    icon: '🃏',
    name: 'Welcome to the felt',
    desc: 'Play your first table round.',
    earned: (p) => tableRounds(p) >= 1,
  },
  {
    id: 'streak-10',
    icon: '🔥',
    name: 'Heating up',
    desc: '10 correct calls in a row — the flame lights.',
    earned: (p) => p.bestCallStreak >= 10,
  },
  {
    id: 'streak-20',
    icon: '🧨',
    name: 'On fire',
    desc: '20 correct calls in a row.',
    earned: (p) => p.bestCallStreak >= 20,
  },
  {
    id: 'streak-35',
    icon: '🌋',
    name: 'Scorching',
    desc: '35 correct calls in a row.',
    earned: (p) => p.bestCallStreak >= 35,
  },
  {
    id: 'streak-50',
    icon: '💠',
    name: 'Blue flame',
    desc: '50 correct calls in a row.',
    earned: (p) => p.bestCallStreak >= 50,
  },
  {
    id: 'hands-100',
    icon: '💯',
    name: 'Century',
    desc: '100 table rounds played.',
    earned: (p) => tableRounds(p) >= 100,
  },
  {
    id: 'hands-1000',
    icon: '⛏️',
    name: 'Grinder',
    desc: '1,000 table rounds played.',
    earned: (p) => tableRounds(p) >= 1000,
  },
  {
    id: 'rank-gold',
    icon: '🥇',
    name: 'Gilded',
    desc: 'Reach Gold rank — 92% rolling accuracy.',
    earned: (p) => tierIndex(p) >= GOLD,
  },
  {
    id: 'rank-perfect',
    icon: '👑',
    name: 'Perfect 21',
    desc: 'A full 200-decision window without a single miss.',
    earned: (p) => computeRank(p.history).tier?.id === 'perfect',
  },
  {
    id: 'endless-25',
    icon: '🏃',
    name: 'Marathon',
    desc: 'Survive 25 decisions in an endless run.',
    earned: (p) => p.bestEndless >= 25,
  },
  {
    id: 'count-first',
    icon: '👁️',
    name: 'Eyes open',
    desc: 'Your first correct call at the counting table.',
    earned: (p) => p.countingCorrect >= 1,
  },
  {
    id: 'count-index',
    icon: '🧮',
    name: 'Deviant',
    desc: '10 correct Illustrious 18 / Fab 4 index plays.',
    earned: (p) => countingPlaysCorrect(p) >= 10,
  },
  {
    id: 'count-ramp',
    icon: '📈',
    name: 'Betting the count',
    desc: '25 bets sized right against the ramp.',
    earned: (p) => p.countingBetsCorrect >= 25,
  },
  {
    id: 'count-ins',
    icon: '🛡️',
    name: 'Insurance agent',
    desc: '5 correct insurance calls at the +3 index.',
    earned: (p) => p.countingInsCorrect >= 5,
  },
  {
    id: 'bankroll-2x',
    icon: '💰',
    name: 'Double up',
    desc: 'Grow the 1,000-chip roll to 2,000. Still worthless — but yours.',
    earned: (p) => p.bankroll >= 2000,
  },
  {
    id: 'rebuy',
    icon: '🔄',
    name: 'Back at it',
    desc: 'Go broke and rebuy. The math never promised mercy.',
    earned: (p) => p.rebuys >= 1,
  },
];

/**
 * Unlock everything newly earned, persist, and return the fresh unlocks (for
 * the toast). Call with no expectation of order — checks are idempotent.
 */
export function checkAchievements(p: Profile): Achievement[] {
  const fresh: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!p.achievements[a.id] && a.earned(p)) {
      p.achievements[a.id] = Date.now();
      fresh.push(a);
    }
  }
  if (fresh.length > 0) saveProfile(p);
  return fresh;
}

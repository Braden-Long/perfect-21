import { RANK_MIN_DECISIONS } from '@perfect21/engine';
import type { Mode } from '../useGame';
import type { Profile } from '../profile';
import { countingRankOf, rankOf, topMisses } from '../profile';

type PlayChoice = Mode | 'drill' | 'learn';

// Learn on top, compete below: practice/drill are the front door.
const MODES: Array<{ id: PlayChoice; name: string; desc: string }> = [
  {
    id: 'practice',
    name: 'Practice',
    desc: 'No pressure. Optional hints, instant feedback on every decision.',
  },
  {
    id: 'drill',
    name: 'Drill',
    desc: 'Rapid-fire reps of the exact hands you get wrong. No chips, pure decisions.',
  },
  {
    id: 'competitive',
    name: 'Competitive',
    desc: '10 seconds per decision. Your rank rides on your accuracy.',
  },
  {
    id: 'endless',
    name: 'Endless',
    desc: 'A 100-chip stack. One strategy mistake — or busting out — ends the run.',
  },
  {
    id: 'counting',
    name: 'Card Counting',
    desc: '', // built per-profile below: the counting shoe size is configurable
  },
  {
    id: 'learn',
    name: 'Learn to Count',
    desc: 'Counting fundamentals, no chips: tag cards at speed, hold the count through a fast deal, turn it into a true count.',
  },
];

export function Menu({
  profile,
  onPlay,
  onHistory,
  onStats,
  onChart,
  onRules,
  onBoard,
  onSupport,
}: {
  profile: Profile;
  onPlay: (mode: PlayChoice) => void;
  onHistory: () => void;
  onStats: () => void;
  onChart: () => void;
  onRules: () => void;
  onBoard: () => void;
  onSupport: () => void;
}) {
  const rank = rankOf(profile);
  const weakSpots = topMisses(profile).length;
  const lifetimeAcc =
    profile.lifetimeDecisions === 0
      ? null
      : profile.lifetimeCorrect / profile.lifetimeDecisions;

  return (
    <div className="room room--menu">
      <div className="menu">
        <h1 className="logo">
          PERFECT <span className="logo__21">21</span>
        </h1>
        <p className="tagline">Master blackjack basic strategy. This is math, not gambling.</p>

        <div className="rank-line">
          {rank.tier ? (
            <span className="rank-badge" style={{ ['--rank-color' as string]: rank.tier.color }}>
              {rank.tier.name}
              <i>{(rank.rollingAccuracy * 100).toFixed(1)}% rolling accuracy</i>
            </span>
          ) : (
            <span className="rank-badge rank-badge--none">
              Unranked
              <i>
                {profile.lifetimeDecisions === 0
                  ? `play ${RANK_MIN_DECISIONS} decisions to earn a rank`
                  : `${rank.needed} more decisions to earn a rank`}
              </i>
            </span>
          )}
          {lifetimeAcc !== null && (
            <span className="rank-lifetime">
              lifetime {(lifetimeAcc * 100).toFixed(1)}% · {profile.lifetimeDecisions} decisions ·
              bankroll {profile.bankroll.toLocaleString('en-US', { maximumFractionDigits: 1 })}{' '}
              chips
            </span>
          )}
        </div>

        <div className="mode-cards">
          {MODES.map((m) => (
            <button key={m.id} className={`mode-card mode-card--${m.id}`} onClick={() => onPlay(m.id)}>
              <span className="mode-card__name">{m.name}</span>
              <span className="mode-card__desc">
                {m.id === 'counting'
                  ? `A ${profile.countingDecks}-deck game. Keep the Hi-Lo count, spread your bets with the edge, play the Illustrious 18. Every bet is graded. Separate rank.`
                  : m.desc}
              </span>
              {m.id === 'endless' && profile.bestEndless > 0 && (
                <span className="mode-card__best">best streak: {profile.bestEndless}</span>
              )}
              {m.id === 'drill' && weakSpots > 0 && (
                <span className="mode-card__best mode-card__best--warn">
                  {weakSpots} weak spot{weakSpots === 1 ? '' : 's'} to fix
                </span>
              )}
              {m.id === 'counting' && countingRankOf(profile).tier && (
                <span className="mode-card__best">
                  counting rank: {countingRankOf(profile).tier!.name}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="menu__links">
          <button className="btn btn--ghost" onClick={onBoard}>
            Leaderboard
          </button>
          <button className="btn btn--ghost" onClick={onRules}>
            Table rules
          </button>
          <button className="btn btn--ghost" onClick={onChart}>
            Strategy chart
          </button>
          <button className="btn btn--ghost" onClick={onHistory}>
            History
          </button>
          <button className="btn btn--ghost" onClick={onStats}>
            Statistics
          </button>
          <button className="btn btn--ghost btn--support" onClick={onSupport}>
            ♥ Support
          </button>
        </div>
        {profile.player ? (
          <p className="menu__signed">playing as {profile.player.name}</p>
        ) : (
          <p className="menu__signed">
            progress lives in this browser — claim a name on the leaderboard to back it up
          </p>
        )}
        <p className="menu__footer">free forever · no ads · play chips only · tips welcome</p>
      </div>
    </div>
  );
}

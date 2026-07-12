import { RANK_MIN_DECISIONS } from '@perfect21/engine';
import type { Mode } from '../useGame';
import type { Profile } from '../profile';
import { rankOf } from '../profile';

const MODES: Array<{ id: Mode; name: string; desc: string }> = [
  {
    id: 'practice',
    name: 'Practice',
    desc: 'No pressure. Optional hints, instant feedback on every decision.',
  },
  {
    id: 'competitive',
    name: 'Competitive',
    desc: '10 seconds per decision. Your rank rides on your accuracy.',
  },
  {
    id: 'endless',
    name: 'Endless',
    desc: 'One mistake ends the run. How long can you play perfectly?',
  },
];

export function Menu({
  profile,
  onPlay,
  onStats,
  onChart,
  onRules,
  onBoard,
  onSupport,
}: {
  profile: Profile;
  onPlay: (mode: Mode) => void;
  onStats: () => void;
  onChart: () => void;
  onRules: () => void;
  onBoard: () => void;
  onSupport: () => void;
}) {
  const rank = rankOf(profile);
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
              lifetime {(lifetimeAcc * 100).toFixed(1)}% · {profile.lifetimeDecisions} decisions
            </span>
          )}
        </div>

        <div className="mode-cards">
          {MODES.map((m) => (
            <button key={m.id} className={`mode-card mode-card--${m.id}`} onClick={() => onPlay(m.id)}>
              <span className="mode-card__name">{m.name}</span>
              <span className="mode-card__desc">{m.desc}</span>
              {m.id === 'endless' && profile.bestEndless > 0 && (
                <span className="mode-card__best">best streak: {profile.bestEndless}</span>
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
          <button className="btn btn--ghost" onClick={onStats}>
            Statistics
          </button>
          <button className="btn btn--ghost btn--support" onClick={onSupport}>
            ♥ Support
          </button>
        </div>
        {profile.player && <p className="menu__signed">playing as {profile.player.name}</p>}
        <p className="menu__footer">free forever · no ads · no wagering · tips only</p>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { RANK_TIERS, RANK_WINDOW, getStrategy } from '@perfect21/engine';
import type { Strategy } from '@perfect21/engine';
import type { Profile } from '../profile';
import { rankOf } from '../profile';
import type { Rules } from '@perfect21/engine';

/** Builds (or fetches cached) strategy tables without blocking first paint. */
export function useStrategy(rules: Rules): Strategy | null {
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      const s = getStrategy(rules);
      if (!cancelled) setStrategy(s);
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [rules]);
  return strategy;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
      {hint && <div className="stat__hint">{hint}</div>}
    </div>
  );
}

export function StatsScreen({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const strategy = useStrategy(profile.rules);
  const rank = rankOf(profile);
  const theoretical = strategy ? strategy.theoreticalRTP() : null;
  const played = profile.totalRounds > 0;
  const actualRTP = played ? 1 + profile.totalNet / profile.totalRounds : null;
  const expectedRTP =
    played && theoretical !== null ? theoretical - profile.totalEVLoss / profile.totalRounds : null;
  const accuracy =
    profile.lifetimeDecisions > 0 ? profile.lifetimeCorrect / profile.lifetimeDecisions : null;

  return (
    <div className="room room--menu">
      <div className="menu menu--wide">
        <h2 className="screen-title">Statistics</h2>

        <div className="rank-line">
          {rank.tier ? (
            <span className="rank-badge" style={{ ['--rank-color' as string]: rank.tier.color }}>
              {rank.tier.name}
              <i>
                {(rank.rollingAccuracy * 100).toFixed(1)}% over last{' '}
                {Math.min(profile.history.length, RANK_WINDOW)} decisions
              </i>
            </span>
          ) : (
            <span className="rank-badge rank-badge--none">
              Unranked <i>{rank.needed} more decisions needed</i>
            </span>
          )}
        </div>

        <div className="stat-grid">
          <Stat
            label="Theoretical RTP"
            value={theoretical !== null ? `${(theoretical * 100).toFixed(2)}%` : '…'}
            hint="perfect play, current rules"
          />
          <Stat
            label="Your expected RTP"
            value={expectedRTP !== null ? `${(expectedRTP * 100).toFixed(2)}%` : '—'}
            hint="theory minus EV lost to your errors"
          />
          <Stat
            label="Actual RTP"
            value={actualRTP !== null ? `${(actualRTP * 100).toFixed(1)}%` : '—'}
            hint="what the cards actually paid (luck)"
          />
          <Stat
            label="Deviation from optimal"
            value={accuracy !== null ? `${((1 - accuracy) * 100).toFixed(1)}%` : '—'}
            hint={`${profile.lifetimeDecisions} lifetime decisions`}
          />
          <Stat label="Hands played" value={String(profile.totalRounds)} />
          <Stat
            label="Net units"
            value={played ? `${profile.totalNet >= 0 ? '+' : ''}${profile.totalNet.toFixed(1)}` : '—'}
          />
          <Stat label="Best endless streak" value={String(profile.bestEndless)} />
          <Stat
            label="Decision accuracy"
            value={accuracy !== null ? `${(accuracy * 100).toFixed(1)}%` : '—'}
          />
        </div>

        <div className="tier-ladder">
          {RANK_TIERS.map((t) => (
            <span
              key={t.id}
              className={`tier ${rank.tier?.id === t.id ? 'tier--current' : ''}`}
              style={{ ['--rank-color' as string]: t.color }}
            >
              {t.name}
              <i>{t.min === 1 ? '100%' : `≥${(t.min * 100).toFixed(1).replace(/\.0$/, '')}%`}</i>
            </span>
          ))}
        </div>

        <button className="btn btn--ghost" onClick={onBack}>
          ‹ Back
        </button>
      </div>
    </div>
  );
}

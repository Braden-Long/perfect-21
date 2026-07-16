import { useEffect, useState } from 'react';
import { RANK_TIERS, RANK_WINDOW, getStrategy } from '@perfect21/engine';
import type { Strategy } from '@perfect21/engine';
import type { Profile } from '../profile';
import { countingRankOf, rankOf, resetRankAspect } from '../profile';
import { scheduleSync } from '../api';
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

/** Two-step "reset this rank" button: no browser dialogs, no accidents. */
function ResetRank({
  label,
  onReset,
  disabled,
}: {
  label: string;
  onReset: () => void;
  disabled: boolean;
}) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 4000);
    return () => clearTimeout(t);
  }, [arm]);
  if (disabled) return null;
  return (
    <button
      className={`btn btn--ghost ${arm ? 'btn--danger' : ''}`}
      onClick={() => {
        if (!arm) {
          setArm(true);
          return;
        }
        onReset();
        setArm(false);
      }}
    >
      {arm ? `Really reset ${label}? Click again` : `Reset ${label}`}
    </button>
  );
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
  const [, forceRender] = useState(0);
  // Basic-strategy and counting stats are separate worlds: counting is
  // high-variance by design and must not color the basic RTP numbers.
  const [view, setView] = useState<'basic' | 'counting'>('basic');
  const rank = rankOf(profile);
  const countingRank = countingRankOf(profile);

  const reset = (aspect: 'basic' | 'counting') => {
    resetRankAspect(profile, aspect);
    scheduleSync(profile);
    forceRender((n) => n + 1);
  };
  const theoretical = strategy ? strategy.theoreticalRTP() : null;
  const played = profile.totalRounds > 0;
  const actualRTP = played ? 1 + profile.totalNet / profile.totalRounds : null;
  const expectedRTP =
    played && theoretical !== null ? theoretical - profile.totalEVLoss / profile.totalRounds : null;
  const accuracy =
    profile.lifetimeDecisions > 0 ? profile.lifetimeCorrect / profile.lifetimeDecisions : null;

  // Counting is three skills in one rank — show where the leaks are.
  const countingPlays = profile.countingDecisions - profile.countingBets - profile.countingIns;
  const countingPlaysCorrect =
    profile.countingCorrect - profile.countingBetsCorrect - profile.countingInsCorrect;
  const pct = (num: number, den: number) => (den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '—');
  const cPlayed = profile.countingRounds > 0;
  const cActualRTP = cPlayed ? 1 + profile.countingNet / profile.countingRounds : null;
  const cAccuracy =
    profile.countingDecisions > 0 ? profile.countingCorrect / profile.countingDecisions : null;

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
          {countingRank.tier ? (
            <span
              className="rank-badge"
              style={{ ['--rank-color' as string]: countingRank.tier.color }}
            >
              {countingRank.tier.name} · counting
              <i>
                {(countingRank.rollingAccuracy * 100).toFixed(1)}% over last{' '}
                {Math.min(profile.countingHistory.length, RANK_WINDOW)} index calls
              </i>
            </span>
          ) : (
            profile.countingDecisions > 0 && (
              <span className="rank-badge rank-badge--none">
                Counting: unranked <i>{countingRank.needed} more index calls needed</i>
              </span>
            )
          )}
        </div>

        <div className="stat-tabs">
          <button
            className={`stat-tab ${view === 'basic' ? 'stat-tab--on' : ''}`}
            onClick={() => setView('basic')}
          >
            Basic strategy
          </button>
          <button
            className={`stat-tab ${view === 'counting' ? 'stat-tab--on' : ''}`}
            onClick={() => setView('counting')}
          >
            Card counting
          </button>
        </div>

        {view === 'basic' ? (
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
            <Stat label="Hands played" value={String(profile.totalRounds)} hint="counting tables excluded" />
            <Stat
              label="Net units"
              value={played ? `${profile.totalNet >= 0 ? '+' : ''}${profile.totalNet.toFixed(1)}` : '—'}
              hint="per initial bet, basic-strategy tables"
            />
            <Stat
              label="Bankroll"
              value={profile.bankroll.toLocaleString('en-US', { maximumFractionDigits: 1 })}
              hint={
                profile.rebuys > 0
                  ? `play chips · ${profile.rebuys} rebuy${profile.rebuys === 1 ? '' : 's'}`
                  : 'play chips — worthless by design'
              }
            />
            <Stat label="Best endless streak" value={String(profile.bestEndless)} />
            <Stat
              label="Longest streak"
              value={String(profile.bestStreak)}
              hint="consecutive correct calls, any table mode"
            />
            <Stat
              label="Decision accuracy"
              value={accuracy !== null ? `${(accuracy * 100).toFixed(1)}%` : '—'}
            />
          </div>
        ) : profile.countingDecisions > 0 || cPlayed ? (
          <>
            <div className="stat-grid">
              <Stat label="Hands played" value={String(profile.countingRounds)} hint="counting tables" />
              <Stat
                label="Net units"
                value={
                  cPlayed
                    ? `${profile.countingNet >= 0 ? '+' : ''}${profile.countingNet.toFixed(1)}`
                    : '—'
                }
                hint="per initial bet, counting tables"
              />
              <Stat
                label="Actual RTP"
                value={cActualRTP !== null ? `${(cActualRTP * 100).toFixed(1)}%` : '—'}
                hint="bet the count well and this beats 100% over time"
              />
              <Stat
                label="Counting accuracy"
                value={cAccuracy !== null ? `${(cAccuracy * 100).toFixed(1)}%` : '—'}
                hint={`${profile.countingDecisions} graded calls, all three skills`}
              />
              <Stat
                label="Index plays"
                value={pct(countingPlaysCorrect, countingPlays)}
                hint={`${countingPlays} I18 / Fab 4 calls`}
              />
              <Stat
                label="Bet spread"
                value={pct(profile.countingBetsCorrect, profile.countingBets)}
                hint={`${profile.countingBets} bets vs the ramp`}
              />
              <Stat
                label="Insurance"
                value={pct(profile.countingInsCorrect, profile.countingIns)}
                hint={`${profile.countingIns} calls at the +3 index`}
              />
            </div>
            <p className="stat__hint" style={{ marginBottom: '1rem' }}>
              Counting stats live entirely apart from your basic-strategy record — index
              deviations aren't errors there, and a cold learning streak here never touches
              your RTP numbers. Swing away.
            </p>
          </>
        ) : (
          <p className="stat__hint" style={{ margin: '1.5rem 0' }}>
            No counting rounds yet. The counting table deals a {profile.countingDecks}-deck
            shoe, grades your bets against the ramp and your plays against the Illustrious 18
            — and none of it touches your basic-strategy stats. Nothing to lose but the count.
          </p>
        )}

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

        <div className="admin-toolbar">
          <ResetRank
            label="accuracy rank"
            disabled={profile.history.length === 0}
            onReset={() => reset('basic')}
          />
          <ResetRank
            label="counting rank"
            disabled={profile.countingHistory.length === 0}
            onReset={() => reset('counting')}
          />
        </div>
        <p className="stat__hint" style={{ marginBottom: '1rem' }}>
          Resetting clears only that rank's rolling window — lifetime stats, bankroll and
          history stay.
        </p>

        <button className="btn btn--ghost" onClick={onBack}>
          ‹ Back
        </button>
      </div>
    </div>
  );
}

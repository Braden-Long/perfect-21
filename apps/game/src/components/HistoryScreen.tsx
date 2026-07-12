import { ACTION_LABEL } from '@perfect21/engine';
import type { Action } from '@perfect21/engine';
import type { MissStat, Profile } from '../profile';
import { topMisses } from '../profile';
import { cellLabel, handLabel } from '../drill';

function usualPick(miss: MissStat): Action {
  const entries = Object.entries(miss.chosen) as Array<[Action, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? 'stand';
}

function ago(t: number): string {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function HistoryScreen({
  profile,
  onDrill,
  onBack,
}: {
  profile: Profile;
  onDrill: () => void;
  onBack: () => void;
}) {
  const misses = topMisses(profile).slice(0, 12);
  const recent = [...profile.handLog].reverse();

  return (
    <div className="room room--menu">
      <div className="menu menu--wide">
        <h2 className="screen-title">History</h2>

        <h3 className="board-subtitle">Your most common mistakes</h3>
        {misses.length === 0 ? (
          <p className="rules-note" style={{ textAlign: 'center' }}>
            Nothing tracked yet — mistakes you make at the table land here, and drill mode
            serves them back until they're gone.
          </p>
        ) : (
          <table className="board board--narrow board--misses">
            <thead>
              <tr>
                <th>Hand</th>
                <th>Correct play</th>
                <th>You usually…</th>
                <th>Misses</th>
                <th>EV given up</th>
              </tr>
            </thead>
            <tbody>
              {misses.map((m) => (
                <tr key={m.key}>
                  <td className="board__name">{cellLabel(m.key)}</td>
                  <td className="history-good">{ACTION_LABEL[m.recommended]}</td>
                  <td className="history-bad">{ACTION_LABEL[usualPick(m)]}</td>
                  <td>{Math.round(m.n)}×</td>
                  <td>{(m.evLost * 100).toFixed(0)}% of a bet</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="admin-toolbar">
          <button className="btn btn--deal" onClick={onDrill}>
            {misses.length > 0 ? 'Drill these weak spots' : 'Drill anyway (coverage reps)'}
          </button>
        </div>

        <h3 className="board-subtitle">Recent decisions</h3>
        {recent.length === 0 ? (
          <p className="rules-note" style={{ textAlign: 'center' }}>
            Play a few hands and your decision stream shows up here.
          </p>
        ) : (
          <div className="hand-stream">
            {recent.map((e, i) => (
              <div key={i} className={`hand-row ${e.correct ? '' : 'hand-row--miss'}`}>
                <span className="hand-row__mark">{e.correct ? '✓' : '✗'}</span>
                <span className="hand-row__hand">{handLabel(e.ranks, e.up)}</span>
                <span className="hand-row__play">
                  {e.correct ? (
                    ACTION_LABEL[e.chosen].toLowerCase()
                  ) : (
                    <>
                      you {e.chosen === e.recommended ? 'timed out on' : ''}{' '}
                      {ACTION_LABEL[e.chosen].toLowerCase()} · book says{' '}
                      <b>{ACTION_LABEL[e.recommended].toLowerCase()}</b>
                      {e.evLoss > 0.0005 && ` (−${(e.evLoss * 100).toFixed(1)}% EV)`}
                    </>
                  )}
                </span>
                <span className="hand-row__meta">
                  {e.mode} · {ago(e.t)}
                </span>
              </div>
            ))}
          </div>
        )}

        <button className="btn btn--ghost" onClick={onBack}>
          ‹ Back
        </button>
      </div>
    </div>
  );
}

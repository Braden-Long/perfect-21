import { useEffect } from 'react';
import { ACTION_LABEL } from '@perfect21/engine';
import type { Action } from '@perfect21/engine';
import type { Profile } from '../profile';
import { useDrill } from '../useDrill';
import { cellLabel } from '../drill';
import { CardView } from './CardView';
import { DECISION_BUTTONS, FeltText, MuteButton, totalLabel } from './Table';

const ACTION_KEYS: Record<string, Action> = {
  h: 'hit',
  s: 'stand',
  d: 'double',
  p: 'split',
  r: 'surrender',
};

function evPct(ev: number): string {
  const pct = ev * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

/** Weak-spot flashcards on the same felt: one decision per hand, no chips. */
export function DrillScreen({ profile, onExit }: { profile: Profile; onExit: () => void }) {
  const drill = useDrill(profile);
  const { hand, feedback, available } = drill;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = ACTION_KEYS[e.key.toLowerCase()];
      if (action && drill.phase === 'decide' && available.includes(action)) {
        drill.act(action);
      } else if ((e.key === ' ' || e.key === 'Enter') && drill.phase === 'review') {
        e.preventDefault();
        drill.next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [available, drill]);

  if (drill.status === 'loading' || !hand) {
    return (
      <div className="room room--loading">
        <div className="loading">
          <div className="loading__title">PERFECT 21</div>
          <div className="loading__sub">Deriving basic strategy for your table rules…</div>
        </div>
      </div>
    );
  }

  const miss = profile.misses[hand.cellKey];
  const feedbackEVRows = feedback
    ? DECISION_BUTTONS.map((b) => b.action)
        .filter((a) => feedback.evs[a] !== undefined)
        .sort((a, b) => (feedback.evs[b] ?? 0) - (feedback.evs[a] ?? 0))
    : [];

  return (
    <div className="scene">
      <header className="hud-top">
        <button className="btn btn--ghost" onClick={onExit}>
          ‹ Lobby
        </button>
        <div className="hud-top__mode">DRILL</div>
        <div className="hud-top__rules">
          {drill.missCount > 0
            ? `${drill.missCount} weak spot${drill.missCount === 1 ? '' : 's'} tracked`
            : 'no leaks tracked — coverage reps'}
        </div>
        <div className="hud-top__stats">
          <span>
            Reps <b>{drill.reps}</b>
          </span>
          <span>
            Correct{' '}
            <b>{drill.reps > 0 ? `${((drill.correct / drill.reps) * 100).toFixed(0)}%` : '—'}</b>
          </span>
        </div>
        <MuteButton />
      </header>

      <div className="table">
        <div className="table__felt">
          <div className="rack" aria-hidden="true">
            {[500, 100, 25, 5, 1, 5, 25, 100].map((v, i) => (
              <span key={i} className={`rack__stack chip chip--${v}`} />
            ))}
          </div>
          <div className="shoe" aria-hidden="true" />
          <div className="discard" aria-hidden="true" />
          <FeltText rules={profile.rules} />

          <section className="dealer-spot">
            <div className="cards cards--dealer">
              <CardView card={hand.upCard} index={0} />
              <CardView card={hand.holeCard} index={1} hidden />
            </div>
            <div className="total-badge total-badge--dealer">{totalLabel([hand.upCard])}</div>
          </section>

          {feedback && (
            <aside
              key={feedback.id}
              className={`verdict ${feedback.correct ? 'verdict--good' : 'verdict--bad'}`}
            >
              <div className="verdict__head">
                {feedback.correct ? '✓ Correct' : '✗ Incorrect'}
                <span className="verdict__answer">
                  Basic strategy: <b>{ACTION_LABEL[feedback.recommended].toUpperCase()}</b>
                  {!feedback.correct && ` (you chose ${ACTION_LABEL[feedback.chosen]})`}
                </span>
              </div>
              <p className="verdict__why">{feedback.explanation}</p>
              <div className="verdict__evs">
                {feedbackEVRows.map((a) => (
                  <span key={a} className={a === feedback.recommended ? 'ev ev--best' : 'ev'}>
                    {ACTION_LABEL[a]} {evPct(feedback.evs[a]!)}
                  </span>
                ))}
              </div>
            </aside>
          )}

          <section className="player-spot">
            <div className="hands">
              <div className={`hand ${drill.phase === 'decide' ? 'hand--active' : ''}`}>
                <div className="cards cards--player">
                  <CardView card={hand.playerCards[0]} index={0} />
                  <CardView card={hand.playerCards[1]} index={1} />
                </div>
                <div className="hand__meta">
                  <span className="total-badge">{totalLabel([...hand.playerCards])}</span>
                </div>
              </div>
            </div>
            <div className="drill-target">
              {hand.targeted && miss
                ? `You've missed ${cellLabel(hand.cellKey)} ${Math.round(miss.n)}× — fix it`
                : hand.targeted
                  ? `One of your weak spots: ${cellLabel(hand.cellKey)}`
                  : 'Coverage rep — keeping the whole chart sharp'}
            </div>
          </section>
        </div>
      </div>

      <footer className="hud-bottom">
        <div className="hud-pills" />
        <div className="console">
          {drill.phase === 'decide' ? (
            <>
              <div className="prompt">MAKE YOUR DECISION</div>
              <div className="decisions">
                {DECISION_BUTTONS.filter(
                  (b) => b.action !== 'surrender' || profile.rules.surrender !== 'none'
                ).map(({ action, glyph }) => (
                  <button
                    key={action}
                    className={`decision decision--${action}`}
                    disabled={!available.includes(action)}
                    onClick={() => drill.act(action)}
                  >
                    <span className="decision__glyph">{glyph}</span>
                    <span className="decision__label">{ACTION_LABEL[action]}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="prompt">SPACE FOR THE NEXT HAND</div>
              <button className="deal-btn" onClick={drill.next}>
                NEXT
              </button>
            </>
          )}
        </div>
        <div className="hud-side" />
      </footer>
    </div>
  );
}

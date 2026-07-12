import { useEffect, useMemo, useState } from 'react';
import { ACTION_LABEL, cardRanks, handValue } from '@perfect21/engine';
import type { Action, HandState } from '@perfect21/engine';
import type { Game, Mode } from '../useGame';
import { DECISION_SECONDS } from '../useGame';
import type { Profile } from '../profile';
import { CardView } from './CardView';

const ACTION_ORDER: Action[] = ['hit', 'stand', 'double', 'split', 'surrender'];
const ACTION_KEYS: Record<string, Action> = {
  h: 'hit',
  s: 'stand',
  d: 'double',
  p: 'split',
  r: 'surrender',
};

function totalLabel(cards: HandState['cards']): string {
  const v = handValue(cardRanks(cards));
  if (v.blackjack) return 'BJ';
  if (v.bust) return `${v.total} ✕`;
  return v.soft ? `${v.total - 10}/${v.total}` : `${v.total}`;
}

function resultLabel(hand: HandState): string | null {
  switch (hand.result) {
    case 'blackjack':
      return 'BLACKJACK +1.5';
    case 'win':
      return `WIN +${hand.bet}`;
    case 'push':
      return 'PUSH';
    case 'lose':
      return `LOSE −${hand.bet}`;
    case 'surrender':
      return 'SURRENDER −0.5';
    default:
      return null;
  }
}

function evPct(ev: number): string {
  const pct = ev * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function TimerBar({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  const frac = Math.max(0, (deadline - now) / (DECISION_SECONDS * 1000));
  return (
    <div className="timer">
      <div
        className={`timer__fill ${frac < 0.3 ? 'timer__fill--low' : ''}`}
        style={{ width: `${frac * 100}%` }}
      />
    </div>
  );
}

export function Table({
  game,
  mode,
  profile,
  onExit,
}: {
  game: Game;
  mode: Mode;
  profile: Profile;
  onExit: () => void;
}) {
  const [showHint, setShowHint] = useState(false);
  const { round, feedback, available, session } = game;

  const hint = useMemo(
    () => (mode === 'practice' && showHint && available.length > 0 ? game.recommend() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, showHint, available, game.version]
  );

  // Keyboard shortcuts: H/S/D/P/R for actions, space/enter to deal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = ACTION_KEYS[e.key.toLowerCase()];
      if (action && available.includes(action)) {
        game.act(action);
      } else if ((e.key === ' ' || e.key === 'Enter') && round?.phase === 'settled' && !game.endlessOver) {
        e.preventDefault();
        game.dealNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [available, game, round]);

  if (game.status === 'loading' || !round) {
    return (
      <div className="room room--loading">
        <div className="loading">
          <div className="loading__title">PERFECT 21</div>
          <div className="loading__sub">Deriving basic strategy for your table rules…</div>
        </div>
      </div>
    );
  }

  const r = profile.rules;
  const rulesChip = `${r.decks}D · ${r.soft17.toUpperCase()} · ${r.das ? 'DAS' : 'NO DAS'} · ${
    r.surrender === 'none' ? 'NO SURR' : r.surrender === 'late' ? 'LS' : 'ES'
  } · ${r.peek ? 'PEEK' : 'ENHC'}`;

  const settled = round.phase === 'settled';
  const feedbackEVRows = feedback
    ? ACTION_ORDER.filter((a) => feedback.evs[a] !== undefined).sort(
        (a, b) => (feedback.evs[b] ?? 0) - (feedback.evs[a] ?? 0)
      )
    : [];

  return (
    <div className="room">
      <header className="topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ‹ Leave table
        </button>
        <div className="topbar__mode">{mode.toUpperCase()}</div>
        <div className="topbar__rules" title="Active rule set">
          {rulesChip}
        </div>
      </header>

      <div className="session-strip">
        <span>
          Hands <b>{session.rounds}</b>
        </span>
        <span>
          Accuracy <b>{(session.accuracy * 100).toFixed(1)}%</b>
        </span>
        <span>
          Net <b className={session.net >= 0 ? 'pos' : 'neg'}>{session.net >= 0 ? '+' : ''}{session.net.toFixed(1)}u</b>
        </span>
        <span>
          RTP <b>{(session.actualRTP * 100).toFixed(1)}%</b>
          <i> / theory {(game.theoreticalRTP * 100).toFixed(2)}%</i>
        </span>
        {mode === 'endless' && (
          <span>
            Streak <b>{game.streak}</b> <i>best {game.bestStreak}</i>
          </span>
        )}
      </div>

      <main className="felt">
        <section className="dealer">
          <div className="area-label">DEALER</div>
          <div className="cards">
            {round.dealerCards.map((c, i) => (
              <CardView key={i} card={c} index={i} hidden={i === 1 && !round.holeRevealed} />
            ))}
          </div>
          {(round.holeRevealed || round.dealerCards.length > 0) && (
            <div className="total-chip total-chip--dealer">
              {round.holeRevealed
                ? totalLabel(round.dealerCards)
                : totalLabel(round.dealerCards.slice(0, 1))}
            </div>
          )}
        </section>

        {feedback && (
          <aside key={feedback.id} className={`verdict ${feedback.correct ? 'verdict--good' : 'verdict--bad'}`}>
            <div className="verdict__head">
              {feedback.correct ? '✓ Correct' : feedback.timedOut ? '⏱ Time expired' : '✗ Incorrect'}
              <span className="verdict__answer">
                Basic strategy: <b>{ACTION_LABEL[feedback.recommended].toUpperCase()}</b>
                {!feedback.correct && ` (you ${feedback.timedOut ? 'ran out of time' : `chose ${ACTION_LABEL[feedback.chosen]}`})`}
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

        <section className="player">
          <div className="hands">
            {round.hands.map((hand, i) => {
              const isActive = round.phase === 'player' && i === round.active;
              const result = settled ? resultLabel(hand) : null;
              return (
                <div key={i} className={`hand ${isActive ? 'hand--active' : ''}`}>
                  {result && (
                    <div
                      className={`hand__result ${
                        hand.result === 'win' || hand.result === 'blackjack'
                          ? 'hand__result--win'
                          : hand.result === 'push'
                            ? 'hand__result--push'
                            : 'hand__result--lose'
                      }`}
                    >
                      {result}
                    </div>
                  )}
                  <div className="cards cards--player">
                    {hand.cards.map((c, j) => (
                      <CardView key={j} card={c} index={j} />
                    ))}
                  </div>
                  <div className="hand__meta">
                    <span className="total-chip">{totalLabel(hand.cards)}</span>
                    <span className="bet">{hand.bet}u{hand.doubled ? ' ×2' : ''}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="area-label">YOU</div>
        </section>
      </main>

      <footer className="controls">
        {mode === 'competitive' && game.deadline && round.phase === 'player' && (
          <TimerBar deadline={game.deadline} />
        )}
        <div className="actions">
          {round.phase === 'player' &&
            ACTION_ORDER.filter((a) => available.includes(a)).map((a) => (
              <button
                key={a}
                className={`btn btn--action btn--${a} ${hint?.action === a ? 'btn--hinted' : ''}`}
                onClick={() => game.act(a)}
              >
                {ACTION_LABEL[a]}
              </button>
            ))}
          {settled && !game.endlessOver && (
            <button className="btn btn--deal" onClick={game.dealNext}>
              DEAL
            </button>
          )}
          {mode === 'practice' && round.phase === 'player' && (
            <button
              className={`btn btn--ghost btn--hint ${showHint ? 'btn--hint-on' : ''}`}
              onClick={() => setShowHint(!showHint)}
            >
              {showHint ? 'Hints: on' : 'Hints: off'}
            </button>
          )}
        </div>
      </footer>

      {game.endlessOver && (
        <div className="overlay">
          <div className="overlay__panel">
            <h2>Run over</h2>
            <p className="overlay__big">{game.streak}</p>
            <p>correct decisions in a row</p>
            {game.streak >= game.bestStreak && game.streak > 0 && <p className="overlay__record">New personal best!</p>}
            {feedback && !feedback.correct && (
              <p className="overlay__miss">
                Missed play: <b>{ACTION_LABEL[feedback.recommended]}</b> — {feedback.explanation}
              </p>
            )}
            <button className="btn btn--deal" onClick={onExit}>
              Back to lobby
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

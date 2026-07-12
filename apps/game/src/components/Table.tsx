import { useEffect, useMemo, useState } from 'react';
import { ACTION_LABEL, cardRanks, handValue } from '@perfect21/engine';
import type { Action, HandState, Rules } from '@perfect21/engine';
import type { Game, Mode } from '../useGame';
import { CHIP_DENOMS, DECISION_SECONDS, TABLE_MAX_BET } from '../useGame';
import type { Profile } from '../profile';
import { CardView } from './CardView';

const ACTION_KEYS: Record<string, Action> = {
  h: 'hit',
  s: 'stand',
  d: 'double',
  p: 'split',
  r: 'surrender',
};

/** Fixed button order (Evolution-style) so muscle memory forms. */
const DECISION_BUTTONS: Array<{ action: Action; glyph: string }> = [
  { action: 'double', glyph: '2×' },
  { action: 'hit', glyph: '+' },
  { action: 'stand', glyph: '−' },
  { action: 'split', glyph: '⧉' },
  { action: 'surrender', glyph: '⚑' },
];

function fmtChips(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function totalLabel(cards: HandState['cards']): string {
  const v = handValue(cardRanks(cards));
  if (v.blackjack) return 'BJ';
  if (v.bust) return `${v.total} ✕`;
  return v.soft ? `${v.total - 10}/${v.total}` : `${v.total}`;
}

function resultLabel(hand: HandState, unitBet: number): string | null {
  const chips = (hand.net ?? 0) * unitBet;
  switch (hand.result) {
    case 'blackjack':
      return `BLACKJACK +${fmtChips(chips)}`;
    case 'win':
      return `WIN +${fmtChips(chips)}`;
    case 'push':
      return 'PUSH';
    case 'lose':
      return `−${fmtChips(-chips)}`;
    case 'surrender':
      return `SURRENDER −${fmtChips(-chips)}`;
    default:
      return null;
  }
}

function evPct(ev: number): string {
  const pct = ev * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

/* ---------- chips ---------- */

const CHIP_CLASS: Record<number, string> = {
  1: 'chip--1',
  5: 'chip--5',
  25: 'chip--25',
  100: 'chip--100',
  500: 'chip--500',
};

function ChipFace({ value }: { value: number }) {
  return (
    <span className={`chip ${CHIP_CLASS[value] ?? 'chip--1'}`}>
      <span className="chip__inner">{value}</span>
    </span>
  );
}

/** Decompose an amount into a visual stack of denomination chips (capped). */
function chipsFor(amount: number): number[] {
  const out: number[] = [];
  let rest = Math.max(1, Math.round(amount));
  for (const d of [...CHIP_DENOMS].reverse()) {
    while (rest >= d && out.length < 8) {
      out.push(d);
      rest -= d;
    }
  }
  return out.reverse();
}

function ChipStack({ amount, label }: { amount: number; label?: boolean }) {
  if (amount < 1) return null;
  const chips = chipsFor(amount);
  return (
    <span className="chip-stack" style={{ ['--n' as string]: chips.length }}>
      {chips.map((v, i) => (
        <span key={i} className="chip-stack__layer" style={{ ['--i' as string]: i }}>
          <ChipFace value={v} />
        </span>
      ))}
      {label !== false && <span className="chip-stack__amount">{fmtChips(amount)}</span>}
    </span>
  );
}

/* ---------- felt lettering ---------- */

function FeltText({ rules }: { rules: Rules }) {
  const dealerLine = `DEALER ${rules.soft17 === 's17' ? 'STANDS ON ALL 17' : 'HITS SOFT 17'} · ${
    rules.decks
  } ${rules.decks === 1 ? 'DECK' : 'DECKS'}`;
  return (
    <svg className="felt-text" viewBox="0 0 1000 430" aria-hidden="true">
      <defs>
        <path id="p21-arc-a" d="M 60 268 Q 500 96 940 268" fill="none" />
        <path id="p21-arc-b" d="M 110 330 Q 500 178 890 330" fill="none" />
        <path id="p21-arc-c" d="M 170 398 Q 500 264 830 398" fill="none" />
      </defs>
      <text className="felt-text__big">
        <textPath href="#p21-arc-a" startOffset="50%" textAnchor="middle">
          BLACKJACK PAYS 3 TO 2
        </textPath>
      </text>
      <text className="felt-text__small">
        <textPath href="#p21-arc-b" startOffset="50%" textAnchor="middle">
          {dealerLine}
        </textPath>
      </text>
      <path className="felt-text__band" d="M 168 380 Q 500 246 832 380" />
      <path className="felt-text__band" d="M 178 424 Q 500 292 822 424" />
      <text className="felt-text__small felt-text__small--band">
        <textPath href="#p21-arc-c" startOffset="50%" textAnchor="middle">
          BASIC STRATEGY IS THE ONLY EDGE
        </textPath>
      </text>
    </svg>
  );
}

/* ---------- timer ---------- */

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

/* ---------- the table ---------- */

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
  const { round, feedback, available, session, tablePhase } = game;
  const betting = tablePhase === 'betting';
  const playing = round !== null && round.phase === 'player' && !game.endlessOver;

  const hint = useMemo(
    () => (mode === 'practice' && showHint && playing ? game.recommend() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, showHint, playing, available, game.version]
  );

  // Keyboard: H/S/D/P/R actions, space/enter deals, 1-5 stage chips, backspace undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = ACTION_KEYS[e.key.toLowerCase()];
      if (action && playing && available.includes(action)) {
        game.act(action);
      } else if ((e.key === ' ' || e.key === 'Enter') && game.canDeal) {
        e.preventDefault();
        game.deal();
      } else if (betting && e.key >= '1' && e.key <= '5') {
        game.addChip(CHIP_DENOMS[Number(e.key) - 1]);
      } else if (betting && e.key === 'Backspace') {
        game.undoChip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [available, betting, game, playing]);

  if (game.status === 'loading') {
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

  const settled = round !== null && round.phase === 'settled';
  const feedbackEVRows = feedback
    ? DECISION_BUTTONS.map((b) => b.action)
        .filter((a) => feedback.evs[a] !== undefined)
        .sort((a, b) => (feedback.evs[b] ?? 0) - (feedback.evs[a] ?? 0))
    : [];

  const banner =
    betting && game.lastNet !== null ? (
      game.lastNet > 0 ? (
        <div className="banner banner--win">
          YOU WIN <b>+{fmtChips(game.lastNet)}</b>
        </div>
      ) : game.lastNet === 0 ? (
        <div className="banner banner--push">PUSH</div>
      ) : (
        <div className="banner banner--lose">−{fmtChips(-game.lastNet)}</div>
      )
    ) : null;

  return (
    <div className="scene">
      <header className="hud-top">
        <button className="btn btn--ghost" onClick={onExit}>
          ‹ Lobby
        </button>
        <div className="hud-top__mode">{mode.toUpperCase()}</div>
        <div className="hud-top__rules" title="Active rule set">
          {rulesChip}
        </div>
        <div className="hud-top__stats">
          <span>
            Hands <b>{session.rounds}</b>
          </span>
          <span>
            Acc <b>{(session.accuracy * 100).toFixed(1)}%</b>
          </span>
          <span>
            RTP <b>{session.rounds > 0 ? (session.actualRTP * 100).toFixed(1) : '—'}</b>
            <i>/{(game.theoreticalRTP * 100).toFixed(2)}</i>
          </span>
          {mode === 'endless' && (
            <span>
              Streak <b>{game.streak}</b>
            </span>
          )}
        </div>
        {mode === 'practice' && (
          <button
            className={`btn btn--ghost btn--hint ${showHint ? 'btn--hint-on' : ''}`}
            onClick={() => setShowHint(!showHint)}
          >
            {showHint ? 'Hints: on' : 'Hints: off'}
          </button>
        )}
      </header>

      {banner}

      <div className="table">
        <div className="table__felt">
          <div className="rack" aria-hidden="true">
            {[500, 100, 25, 5, 1, 5, 25, 100].map((v, i) => (
              <span key={i} className={`rack__stack chip ${CHIP_CLASS[v]}`} />
            ))}
          </div>
          <div className="shoe" aria-hidden="true" />
          <div className="discard" aria-hidden="true" />
          <FeltText rules={r} />

          <section className="dealer-spot">
            {round && round.dealerCards.length > 0 && (
              <>
                <div className="cards cards--dealer">
                  {round.dealerCards.map((c, i) => (
                    <CardView key={i} card={c} index={i} hidden={i === 1 && !round.holeRevealed} />
                  ))}
                </div>
                <div className="total-badge total-badge--dealer">
                  {round.holeRevealed
                    ? totalLabel(round.dealerCards)
                    : totalLabel(round.dealerCards.slice(0, 1))}
                </div>
              </>
            )}
          </section>

          {feedback && (
            <aside
              key={feedback.id}
              className={`verdict ${feedback.correct ? 'verdict--good' : 'verdict--bad'}`}
            >
              <div className="verdict__head">
                {feedback.correct ? '✓ Correct' : feedback.timedOut ? '⏱ Time expired' : '✗ Incorrect'}
                <span className="verdict__answer">
                  Basic strategy: <b>{ACTION_LABEL[feedback.recommended].toUpperCase()}</b>
                  {!feedback.correct &&
                    ` (you ${feedback.timedOut ? 'ran out of time' : `chose ${ACTION_LABEL[feedback.chosen]}`})`}
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
            {round && (
              <div className="hands">
                {round.hands.map((hand, i) => {
                  const isActive = playing && i === round.active;
                  const result = settled ? resultLabel(hand, game.roundBet) : null;
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
                        <span className="total-badge">{totalLabel(hand.cards)}</span>
                        {!betting && <ChipStack amount={hand.bet * game.roundBet} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className={`bet-spot ${betting && !game.endlessOver ? 'bet-spot--open' : ''}`}>
              {betting && !game.endlessOver && (
                <>
                  <span className="bet-spot__ring" />
                  {game.bet >= 1 ? (
                    <ChipStack amount={game.bet} />
                  ) : (
                    <span className="bet-spot__hint">BET</span>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </div>

      <footer className="hud-bottom">
        <div className="hud-pills">
          <div className="pill">
            <span>Balance</span>
            <b>{fmtChips(game.bankroll)}</b>
          </div>
          <div className="pill">
            <span>Total play</span>
            <b>{fmtChips(game.totalPlay)}</b>
          </div>
        </div>

        <div className="console">
          {mode === 'competitive' && game.deadline && playing && (
            <TimerBar deadline={game.deadline} />
          )}
          {playing ? (
            <>
              <div className="prompt">MAKE YOUR DECISION</div>
              <div className="decisions">
                {DECISION_BUTTONS.filter(
                  (b) => b.action !== 'surrender' || r.surrender !== 'none'
                ).map(({ action, glyph }) => (
                  <button
                    key={action}
                    className={`decision decision--${action} ${
                      hint?.action === action ? 'decision--hinted' : ''
                    }`}
                    disabled={!available.includes(action)}
                    onClick={() => game.act(action)}
                  >
                    <span className="decision__glyph">{glyph}</span>
                    <span className="decision__label">{ACTION_LABEL[action]}</span>
                  </button>
                ))}
              </div>
            </>
          ) : game.endlessOver ? null : game.canRebuy ? (
            <>
              <div className="prompt">OUT OF CHIPS</div>
              <button className="btn btn--deal" onClick={game.rebuy}>
                REBUY +1,000
              </button>
            </>
          ) : (
            <>
              <div className="prompt">
                {game.lastNet === null ? 'PLACE YOUR BET' : 'REBET OR CHANGE YOUR BET'}
              </div>
              <div className="chip-row">
                {CHIP_DENOMS.map((v) => (
                  <button
                    key={v}
                    className="chip-btn"
                    disabled={game.bet + v > game.bankroll || game.bet + v > TABLE_MAX_BET}
                    onClick={() => game.addChip(v)}
                    aria-label={`add ${v} chip`}
                  >
                    <ChipFace value={v} />
                  </button>
                ))}
              </div>
              <div className="bet-actions">
                <button
                  className="round-btn"
                  onClick={game.undoChip}
                  disabled={game.bet < 1}
                  title="Undo chip"
                >
                  ⟲
                </button>
                <button className="deal-btn" disabled={!game.canDeal} onClick={game.deal}>
                  DEAL
                </button>
                <button
                  className="round-btn"
                  onClick={game.doubleStake}
                  disabled={
                    game.bet < 1 || game.bet * 2 > game.bankroll || game.bet * 2 > TABLE_MAX_BET
                  }
                  title="Double bet"
                >
                  ×2
                </button>
              </div>
            </>
          )}
        </div>

        <div className="hud-side">
          {mode === 'endless' && (
            <div className="pill pill--endless">
              <span>Run</span>
              <b>
                {game.streak} ✓ · best {game.bestStreak}
              </b>
            </div>
          )}
        </div>
      </footer>

      {game.endlessOver && (
        <div className="overlay">
          <div className="overlay__panel">
            <h2>{game.endReason === 'busted' ? 'Busted out' : 'Run over'}</h2>
            <p className="overlay__big">{game.streak}</p>
            <p>correct decisions in a row</p>
            {game.streak >= game.bestStreak && game.streak > 0 && (
              <p className="overlay__record">New personal best!</p>
            )}
            {game.endReason === 'busted' ? (
              <p className="overlay__miss">
                Perfect strategy shrinks the house edge — it can't erase it. That's the math this
                whole site is about.
              </p>
            ) : (
              feedback &&
              !feedback.correct && (
                <p className="overlay__miss">
                  Missed play: <b>{ACTION_LABEL[feedback.recommended]}</b> — {feedback.explanation}
                </p>
              )
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

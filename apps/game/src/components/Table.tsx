import { useEffect, useMemo, useState } from 'react';
import { ACTION_LABEL, betRamp, cardRanks, handValue } from '@perfect21/engine';
import type { Action, HandState, Rules } from '@perfect21/engine';
import type { Game, Mode } from '../useGame';
import {
  CHIP_DENOMS,
  COUNTING_UNIT,
  DECISION_SECONDS,
  MAX_TABLE_SEATS,
  TABLE_MAX_BET,
  TABLE_MIN_BET,
} from '../useGame';
import { play, setSoundMuted, soundMuted } from '../sound';
import { CardView } from './CardView';

const ACTION_KEYS: Record<string, Action> = {
  h: 'hit',
  s: 'stand',
  d: 'double',
  p: 'split',
  r: 'surrender',
};

/** Fixed button order (Evolution-style) so muscle memory forms. */
export const DECISION_BUTTONS: Array<{ action: Action; glyph: string }> = [
  { action: 'double', glyph: '2×' },
  { action: 'hit', glyph: '+' },
  { action: 'stand', glyph: '−' },
  { action: 'split', glyph: '⧉' },
  { action: 'surrender', glyph: '⚑' },
];

function fmtChips(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/**
 * Horizontal centers of the betting spots, in % of felt width. Seat 0 is the
 * rightmost spot — casinos (and Evolution) play right to left.
 */
const SEAT_XS: Record<number, number[]> = {
  1: [50],
  2: [65, 35],
  3: [75, 50, 25],
};

function seatXs(count: number): number[] {
  return SEAT_XS[count] ?? SEAT_XS[1];
}

export function totalLabel(cards: HandState['cards']): string {
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

function ChipFace({ value, blank = false }: { value: number; blank?: boolean }) {
  return (
    <span className={`chip ${CHIP_CLASS[value] ?? 'chip--1'} ${value >= 100 ? 'chip--wide' : ''}`}>
      <span className="chip__inner">{blank ? '' : value}</span>
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
  const labeled = label !== false;
  // A labeled stack shows exactly one number: the total, printed on the top
  // chip where a face value would be. Never two numbers on one chip.
  return (
    <span className="chip-stack" style={{ ['--n' as string]: chips.length }}>
      {chips.map((v, i) => (
        <span key={i} className="chip-stack__layer" style={{ ['--i' as string]: i }}>
          <ChipFace value={v} blank={labeled} />
        </span>
      ))}
      {labeled && (
        <span
          className={`chip-stack__amount ${
            fmtChips(amount).length > 3 ? 'chip-stack__amount--wide' : ''
          }`}
        >
          {fmtChips(amount)}
        </span>
      )}
    </span>
  );
}

/* ---------- set dressing: dealer rack, shoe, discard tray ---------- */

const RACK_SLOTS = [500, 100, 25, 5, 1, 5, 25, 100];

/** The dealer's bank: eight slots of individually stacked chips in a wood tray. */
export function DealerRack() {
  return (
    <div className="rack" aria-hidden="true">
      {RACK_SLOTS.map((v, i) => (
        <span key={i} className={`rack-slot ${CHIP_CLASS[v]}`}>
          {Array.from({ length: 7 }, (_, j) => (
            <i key={j} />
          ))}
          <b />
        </span>
      ))}
    </div>
  );
}

/**
 * The dealing shoe, live: the card brick thickens with the deck count,
 * depletes as cards leave it, and carries the red cut card at the 75%
 * penetration point — when the brick's edge meets the red card, the next
 * deal is a reshuffle.
 */
export function DealShoe({ decks, fill }: { decks: number; fill: number }) {
  const level = Math.max(0.05, Math.min(1, fill));
  const thickness = 32 + (Math.min(decks, 8) / 8) * 46;
  const toCut = Math.round(Math.max(0, level - 0.25) * decks * 52);
  return (
    <div
      className="shoe"
      title={
        toCut > 0
          ? `${Math.round(level * decks * 52)} cards in the shoe — ${toCut} to the cut card, then a reshuffle`
          : 'The cut card is out — next deal reshuffles'
      }
    >
      <div className="shoe__well">
        <div
          className="shoe__brick"
          style={{ width: `${level * 100}%`, height: `${thickness}%` }}
        />
        <div
          className="shoe__cut"
          style={{ left: `${Math.min(25, level * 100)}%`, height: `${thickness + 12}%` }}
        />
      </div>
      <div className="shoe__shell" />
    </div>
  );
}

/** The discard tray fills up as the shoe empties. */
export function DiscardTray({ dealt }: { dealt: number }) {
  const level = Math.max(0, Math.min(1, dealt));
  return (
    <div className="discard" aria-hidden="true">
      {level > 0.001 && (
        <div className="discard__stack" style={{ height: `${6 + level * 50}%` }} />
      )}
    </div>
  );
}

/* ---------- felt lettering ---------- */

export function FeltText({ rules, counting = false }: { rules: Rules; counting?: boolean }) {
  const dealerLine = `DEALER ${rules.soft17 === 's17' ? 'STANDS ON ALL 17' : 'HITS SOFT 17'} · ${
    rules.decks
  } ${rules.decks === 1 ? 'DECK' : 'DECKS'}`;
  // textLength pins each line's exact arc span, so the lettering is dead
  // centered no matter the string (letter-spaced textPath otherwise overflows
  // the arc and clips off one end).
  return (
    <svg className="felt-text" viewBox="0 0 1000 430" aria-hidden="true">
      <defs>
        <path id="p21-arc-a" d="M 60 268 Q 500 96 940 268" fill="none" />
        <path id="p21-arc-b" d="M 110 330 Q 500 178 890 330" fill="none" />
        <path id="p21-arc-c" d="M 170 409 Q 500 276 830 409" fill="none" />
      </defs>
      <text className="felt-text__big">
        <textPath
          href="#p21-arc-a"
          startOffset="50%"
          textAnchor="middle"
          textLength="780"
          lengthAdjust="spacingAndGlyphs"
        >
          BLACKJACK PAYS 3 TO 2
        </textPath>
      </text>
      <text className="felt-text__small">
        <textPath
          href="#p21-arc-b"
          startOffset="50%"
          textAnchor="middle"
          textLength="640"
          lengthAdjust="spacingAndGlyphs"
        >
          {dealerLine}
        </textPath>
      </text>
      <path className="felt-text__band" d="M 168 380 Q 500 246 832 380" />
      <path className="felt-text__band" d="M 178 424 Q 500 292 822 424" />
      <text className="felt-text__small felt-text__small--band">
        <textPath
          href="#p21-arc-c"
          startOffset="50%"
          textAnchor="middle"
          textLength="560"
          lengthAdjust="spacingAndGlyphs"
        >
          {counting ? 'BET THE COUNT · PLAY THE INDICES' : 'BASIC STRATEGY IS THE ONLY EDGE'}
        </textPath>
      </text>
    </svg>
  );
}

/* ---------- counting HUD ---------- */

/** The betting ramp for this game, rendered as "≤+1 1u · +2 2u · …". */
function rampLine(decks: number): string {
  const parts = ['≤+1 1u'];
  let last = 1;
  for (let t = 2; t <= 8; t++) {
    const r = betRamp(t, decks);
    if (r.units === last) continue;
    last = r.units;
    parts.push(`${last === r.spread ? `+${t}⁺` : `+${t}`} ${last}u`);
    if (last === r.spread) break;
  }
  return parts.join(' · ');
}

function CountPanel({ game }: { game: Game }) {
  const [show, setShow] = useState(true);
  const sign = (n: number, digits = 0) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
  return (
    <aside className="count-panel">
      {show && (
        <>
          <div className="count-panel__grid">
            <div>
              <span>RC</span>
              <b>{sign(game.rc)}</b>
            </div>
            <div>
              <span>TC</span>
              <b>{sign(game.tc, 1)}</b>
            </div>
            <div>
              <span>Decks left</span>
              <b>{game.decksLeft.toFixed(1)}</b>
            </div>
            <div>
              <span>Your edge</span>
              <b className={game.edge >= 0 ? 'count-panel__edge--plus' : 'count-panel__edge--minus'}>
                {sign(game.edge * 100, 1)}%
              </b>
            </div>
          </div>
          <div className="count-panel__ramp" title="Bet ramp: ~2 units per true count above +1">
            1u = {COUNTING_UNIT} · {rampLine(game.rules.decks)}
          </div>
        </>
      )}
      <button className="count-panel__toggle" onClick={() => setShow(!show)}>
        {show ? 'Hide count — keep it yourself' : 'Show count'}
      </button>
      {game.shufflePending ? (
        <div className="count-panel__shuffle">CUT CARD OUT — next deal reshuffles</div>
      ) : (
        game.freshShoe && <div className="count-panel__shuffle">SHUFFLE — count reset</div>
      )}
    </aside>
  );
}

/* ---------- mute toggle ---------- */

export function MuteButton() {
  const [muted, setMuted] = useState(soundMuted);
  return (
    <button
      className="btn btn--ghost btn--mute"
      title={muted ? 'Unmute table sounds' : 'Mute table sounds'}
      onClick={() => {
        setSoundMuted(!muted);
        setMuted(!muted);
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
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

export function Table({ game, mode, onExit }: { game: Game; mode: Mode; onExit: () => void }) {
  const [showHint, setShowHint] = useState(false);
  const { round, feedback, available, session, tablePhase } = game;
  const betting = tablePhase === 'betting';
  const playing = round !== null && round.phase === 'player' && !game.endlessOver;
  const insuring = round !== null && round.phase === 'insurance';

  // A fresh table gets its shoe shuffled in front of the player — skippable.
  const [shuffling, setShuffling] = useState(true);
  useEffect(() => {
    if (game.status !== 'ready') return;
    play('shuffle');
    const t = setTimeout(() => setShuffling(false), 2900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.status]);

  // After a round settles the cards linger for a beat, then get swept to the
  // discard so the next betting round starts on a clean felt (Evolution-style).
  const [swept, setSwept] = useState(false);
  const settledNow = round !== null && round.phase === 'settled';
  useEffect(() => {
    if (betting && settledNow && !game.endlessOver) {
      setSwept(false);
      const t = setTimeout(() => setSwept(true), 2000);
      return () => clearTimeout(t);
    }
    setSwept(false);
  }, [betting, settledNow, game.endlessOver, game.version]);

  const hint = useMemo(
    () => (mode === 'practice' && showHint && playing ? game.recommend() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, showHint, playing, available, game.version]
  );

  // Keyboard: H/S/D/P/R actions, space/enter deals, 1-5 stage chips, backspace undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = ACTION_KEYS[e.key.toLowerCase()];
      if (insuring && (e.key === 'y' || e.key === 'n')) {
        game.insure(e.key === 'y');
      } else if (action && playing && available.includes(action)) {
        game.act(action);
      } else if ((e.key === ' ' || e.key === 'Enter') && game.canDeal && !shuffling) {
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
  }, [available, betting, game, insuring, playing, shuffling]);

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

  const r = game.rules;
  const rulesChip = `${r.decks}D · ${r.soft17.toUpperCase()} · ${r.das ? 'DAS' : 'NO DAS'} · ${
    r.surrender === 'none' ? 'NO SURR' : r.surrender === 'late' ? 'LS' : 'ES'
  } · ${r.peek ? 'PEEK' : 'ENHC'}`;

  const settled = round !== null && round.phase === 'settled';
  // Results get a clean beat on the felt before the spots reopen for bets.
  const spotsOpen = betting && !game.endlessOver && (!settled || swept);
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
        <MuteButton />
      </header>

      {banner}
      {mode === 'counting' && <CountPanel game={game} />}

      <div className="table">
        <div
          className="table__felt"
          style={{
            // Evolution-style camera: overview while betting, then ease in
            // toward whichever spot is acting (seats play right to left).
            transformOrigin: `${
              playing && round ? seatXs(round.seats)[round.activeHand.seat] : 50
            }% 56%`,
            transform:
              playing && round
                ? `scale(${round.seats > 1 ? 1.26 : 1.1})`
                : 'scale(1)',
          }}
        >
          <DealerRack />
          <DealShoe decks={r.decks} fill={game.decksLeft / r.decks} />
          <DiscardTray dealt={1 - game.decksLeft / r.decks} />
          <FeltText rules={r} counting={mode === 'counting'} />

          <section className="dealer-spot">
            {round && round.dealerCards.length > 0 && (
              <div className={swept ? 'swept' : ''}>
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
              </div>
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
                  {feedback.headline ?? (
                    <>
                      Basic strategy: <b>{ACTION_LABEL[feedback.recommended].toUpperCase()}</b>
                      {!feedback.correct &&
                        ` (you ${feedback.timedOut ? 'ran out of time' : `chose ${ACTION_LABEL[feedback.chosen]}`})`}
                    </>
                  )}
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
            {Array.from(
              { length: betting ? game.seats : round?.seats ?? 1 },
              (_, seat) => seat
            ).map((seat, _, all) => {
              const x = seatXs(all.length)[seat];
              const seatHands = round
                ? round.hands
                    .map((hand, i) => ({ hand, i }))
                    .filter(({ hand }) => hand.seat === seat)
                : [];
              return (
                <div
                  key={seat}
                  className="seat"
                  // Outer spots ride up the arc of the rail, like a real table.
                  style={{ left: `${x}%`, bottom: `${Math.abs(x - 50) * 0.45}%` }}
                >
                  {seatHands.length > 0 && (
                    <div className={`hands ${swept ? 'swept' : ''}`}>
                      {seatHands.map(({ hand, i }) => {
                        const isActive = playing && i === round!.active;
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
                  <div className={`bet-spot ${spotsOpen ? 'bet-spot--open' : ''}`}>
                    {spotsOpen && (
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
                </div>
              );
            })}
          </section>
        </div>

        {shuffling && (
          <div className="shuffle-overlay">
            <div className="shuffle-stage">
              {Array.from({ length: 14 }, (_, i) => (
                <span
                  key={i}
                  className="shuffle-card"
                  style={{ ['--i' as string]: i, ['--side' as string]: i % 2 ? 1 : -1 }}
                />
              ))}
            </div>
            <div className="shuffle-label">SHUFFLING {r.decks * 52} CARDS</div>
            <button className="btn btn--ghost" onClick={() => setShuffling(false)}>
              Skip ›
            </button>
          </div>
        )}
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
          {shuffling ? (
            <div className="prompt">FRESH SHOE ON THE TABLE…</div>
          ) : insuring ? (
            <>
              <div className="prompt">INSURANCE? PAYS 2 TO 1</div>
              <div className="decisions">
                <button
                  className="decision decision--double"
                  onClick={() => game.insure(true)}
                >
                  <span className="decision__glyph">✓</span>
                  <span className="decision__label">Take (Y)</span>
                </button>
                <button
                  className="decision decision--surrender"
                  onClick={() => game.insure(false)}
                >
                  <span className="decision__glyph">✕</span>
                  <span className="decision__label">Decline (N)</span>
                </button>
              </div>
            </>
          ) : playing ? (
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
                    disabled={
                      (game.bet + v) * game.seats > game.bankroll ||
                      game.bet + v > TABLE_MAX_BET
                    }
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
                    game.bet < 1 ||
                    game.bet * 2 * game.seats > game.bankroll ||
                    game.bet * 2 > TABLE_MAX_BET
                  }
                  title="Double bet"
                >
                  ×2
                </button>
              </div>
              {game.canMultiSeat && (
                <div className="seat-picker">
                  <span>Spots</span>
                  {Array.from({ length: MAX_TABLE_SEATS }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      className={`trainer-seg__btn ${game.seats === n ? 'trainer-seg__btn--on' : ''}`}
                      onClick={() => game.setSeats(n)}
                      disabled={game.bankroll < TABLE_MIN_BET * n}
                    >
                      {n}
                    </button>
                  ))}
                  {game.seats > 1 && game.bet >= 1 && (
                    <i>
                      {fmtChips(game.bet)} × {game.seats} = {fmtChips(game.bet * game.seats)}
                    </i>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="hud-side">
          {game.tape.length > 0 && (
            <div className="tape" title="This session's decisions">
              {game.tape.slice(-24).map((ok, i) => (
                <span key={i} className={ok ? 'tape__dot tape__dot--ok' : 'tape__dot tape__dot--miss'} />
              ))}
            </div>
          )}
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

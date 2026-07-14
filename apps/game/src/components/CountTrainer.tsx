import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Shoe, hiLoValue, trueCount } from '@perfect21/engine';
import type { Card } from '@perfect21/engine';
import { CardView } from './CardView';
import { DealShoe, DealerRack, DiscardTray, MuteButton } from './Table';
import { play } from '../sound';

/**
 * Learn to Count — counting fundamentals, no chips, no rank, no leaderboard.
 * Three classic drills, in the order counters actually learn them:
 *   1. Tag cards: instant Hi-Lo values, one card at a time.
 *   2. Keep the count: a fast stream of cards, then report the running count.
 *   3. True count: divide RC by decks remaining, in your head.
 */

const sign = (n: number, digits = 0) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;

const TAGS: Array<{ tag: number; label: string; hint: string; cls: string }> = [
  { tag: 1, label: '+1', hint: '2 – 6', cls: 'decision--hit' },
  { tag: 0, label: '0', hint: '7 – 9', cls: 'decision--stand' },
  { tag: -1, label: '−1', hint: '10 J Q K A', cls: 'decision--surrender' },
];

const TAG_KEYS: Record<string, number> = {
  '1': 1,
  '2': 0,
  '3': -1,
  arrowleft: 1,
  arrowdown: 0,
  arrowright: -1,
};

function Felt({ children }: { children: ReactNode }) {
  return (
    <div className="table">
      <div className="table__felt">
        <DealerRack />
        <DealShoe decks={6} fill={0.82} />
        <DiscardTray dealt={0.18} />
        {children}
      </div>
    </div>
  );
}

/* ---------- drill 1: tag cards ---------- */

function TagDrill() {
  const shoeRef = useRef<Shoe | null>(null);
  if (!shoeRef.current) shoeRef.current = new Shoe(6);
  const [card, setCard] = useState<Card>(() => shoeRef.current!.draw());
  const [cardId, setCardId] = useState(0);
  const [seen, setSeen] = useState(0);
  const [right, setRight] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [miss, setMiss] = useState<string | null>(null);
  const startRef = useRef<number | null>(null);

  const answer = useCallback(
    (tag: number) => {
      if (miss !== null) return; // reading the correction — next card comes on its own
      if (startRef.current === null) startRef.current = Date.now();
      const truth = hiLoValue(card.rank);
      const ok = tag === truth;
      setSeen((s) => s + 1);
      if (ok) {
        play('chip');
        setRight((r) => r + 1);
        const next = streak + 1;
        setStreak(next);
        setBest((b) => Math.max(b, next));
        setCard(shoeRef.current!.draw());
        setCardId((i) => i + 1);
      } else {
        play('incorrect');
        setStreak(0);
        setMiss(`${card.face} is ${sign(truth)}`);
        setTimeout(() => {
          setMiss(null);
          setCard(shoeRef.current!.draw());
          setCardId((i) => i + 1);
        }, 1100);
      }
    },
    [card, miss, streak]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = TAG_KEYS[e.key.toLowerCase()];
      if (tag !== undefined) {
        e.preventDefault();
        answer(tag);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer]);

  const minutes = startRef.current ? (Date.now() - startRef.current) / 60000 : 0;
  const rate = seen >= 5 && minutes > 0 ? Math.round(seen / minutes) : null;

  return (
    <>
      <Felt>
        <div className="trainer-stage">
          <div className="trainer-score">
            <span>
              Streak <b>{streak}</b>
            </span>
            <span>
              Best <b>{best}</b>
            </span>
            <span>
              Accuracy <b>{seen > 0 ? `${Math.round((right / seen) * 100)}%` : '—'}</b>
            </span>
            {rate !== null && (
              <span>
                Pace <b>{rate}/min</b>
              </span>
            )}
          </div>
          <div className="trainer-card" key={cardId}>
            <CardView card={card} index={0} />
          </div>
          {miss && <div className="trainer-miss">{miss}</div>}
          <p className="trainer-note">
            Low cards (2–6) help the counter: +1. Tens and aces leave the shoe poorer: −1.
            Sevens through nines don't matter: 0.
          </p>
        </div>
      </Felt>
      <footer className="hud-bottom">
        <div className="hud-pills" />
        <div className="console">
          <div className="prompt">TAG THE CARD — KEYS 1 · 2 · 3</div>
          <div className="decisions">
            {TAGS.map((t) => (
              <button
                key={t.tag}
                className={`decision tag-btn ${t.cls}`}
                onClick={() => answer(t.tag)}
              >
                <span className="decision__glyph">{t.label}</span>
                <span className="decision__label">{t.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="hud-side" />
      </footer>
    </>
  );
}

/* ---------- drill 2: keep the count ---------- */

const SPEEDS = [
  { label: 'Casual', ms: 1000 },
  { label: 'Brisk', ms: 700 },
  { label: 'Fast', ms: 450 },
  { label: 'Dealer', ms: 300 },
];
// 51 = a full deck with one card held back: a balanced deck means the count
// tells you the hidden card's tag — the classic self-checking countdown.
const LENGTHS = [
  { label: '12 cards', n: 12 },
  { label: 'Half deck', n: 26 },
  { label: 'Full deck − 1', n: 51 },
];

function CountdownDrill() {
  const [phase, setPhase] = useState<'setup' | 'running' | 'answer' | 'result'>('setup');
  const [speed, setSpeed] = useState(1);
  const [length, setLength] = useState(1);
  const [pairs, setPairs] = useState(false);
  const [shown, setShown] = useState<Card[]>([]);
  const [dealt, setDealt] = useState(0);
  const [guess, setGuess] = useState('');
  const [result, setResult] = useState<{ ok: boolean; rc: number; guess: number } | null>(null);
  const [runs, setRuns] = useState(0);
  const [wins, setWins] = useState(0);
  const shoeRef = useRef<Shoe | null>(null);
  const rcRef = useRef(0);
  const dealtRef = useRef(0);
  const heldRef = useRef<Card | null>(null);
  const target = LENGTHS[length].n;

  const start = () => {
    shoeRef.current = new Shoe(1);
    rcRef.current = 0;
    dealtRef.current = 0;
    heldRef.current = null;
    setShown([]);
    setDealt(0);
    setGuess('');
    setResult(null);
    setPhase('running');
    play('deal');
  };

  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => {
      if (dealtRef.current >= target) {
        setPhase('answer');
        return;
      }
      const n = Math.min(pairs ? 2 : 1, target - dealtRef.current);
      const cards = Array.from({ length: n }, () => shoeRef.current!.draw());
      for (const c of cards) rcRef.current += hiLoValue(c.rank);
      dealtRef.current += n;
      setShown(cards);
      setDealt(dealtRef.current);
    }, SPEEDS[speed].ms);
    return () => clearInterval(timer);
  }, [phase, speed, pairs, target]);

  const submit = () => {
    const g = Number(guess);
    if (guess.trim() === '' || !Number.isFinite(g)) return;
    if (target === 51) heldRef.current = shoeRef.current!.draw();
    const ok = g === rcRef.current;
    play(ok ? 'correct' : 'incorrect');
    setRuns((r) => r + 1);
    if (ok) setWins((w) => w + 1);
    setResult({ ok, rc: rcRef.current, guess: g });
    setPhase('result');
  };

  return (
    <>
      <Felt>
        <div className="trainer-stage">
          {phase !== 'setup' && (
            <div className="trainer-score">
              <span>
                Runs <b>{runs}</b>
              </span>
              <span>
                Clean <b>{runs > 0 ? `${wins}/${runs}` : '—'}</b>
              </span>
              {phase === 'running' && (
                <span>
                  Cards <b>{dealt}/{target}</b>
                </span>
              )}
            </div>
          )}
          {phase === 'setup' && (
            <p className="trainer-note trainer-note--wide">
              Cards fly by — keep the running count in your head, then call it. Counting in
              pairs is how pros do it: a high and a low cancel to nothing before you ever add.
            </p>
          )}
          {phase === 'running' && (
            <div className="trainer-card" key={dealt}>
              {shown.map((c, i) => (
                <CardView key={i} card={c} index={i} />
              ))}
            </div>
          )}
          {phase === 'answer' && (
            <p className="trainer-note trainer-note--wide">Shoe's done. What's the count?</p>
          )}
          {phase === 'result' && result && (
            <div className={`trainer-result ${result.ok ? 'trainer-result--good' : 'trainer-result--bad'}`}>
              <b>{result.ok ? '✓ Clean count' : '✗ Lost the thread'}</b>
              <span>
                The count was <b>{sign(result.rc)}</b>
                {!result.ok && <> — you said {sign(result.guess)}</>}
              </span>
              {heldRef.current && (
                <span>
                  Held-back card: <b>{heldRef.current.face}</b> (tag {sign(hiLoValue(heldRef.current.rank))})
                  — a balanced deck means the count betrays it.
                </span>
              )}
            </div>
          )}
        </div>
      </Felt>
      <footer className="hud-bottom">
        <div className="hud-pills" />
        <div className="console">
          {phase === 'setup' && (
            <>
              <div className="prompt">SET THE DEAL</div>
              <div className="trainer-options">
                <span className="trainer-seg">
                  {SPEEDS.map((s, i) => (
                    <button
                      key={s.label}
                      className={`trainer-seg__btn ${i === speed ? 'trainer-seg__btn--on' : ''}`}
                      onClick={() => setSpeed(i)}
                    >
                      {s.label}
                    </button>
                  ))}
                </span>
                <span className="trainer-seg">
                  {LENGTHS.map((l, i) => (
                    <button
                      key={l.label}
                      className={`trainer-seg__btn ${i === length ? 'trainer-seg__btn--on' : ''}`}
                      onClick={() => setLength(i)}
                    >
                      {l.label}
                    </button>
                  ))}
                </span>
                <button
                  className={`trainer-seg__btn ${pairs ? 'trainer-seg__btn--on' : ''}`}
                  onClick={() => setPairs(!pairs)}
                >
                  {pairs ? '✓ ' : ''}two at a time
                </button>
              </div>
              <button className="deal-btn" onClick={start}>
                DEAL
              </button>
            </>
          )}
          {phase === 'running' && <div className="prompt">KEEP THE COUNT…</div>}
          {phase === 'answer' && (
            <>
              <div className="prompt">RUNNING COUNT?</div>
              <form
                className="trainer-answer"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <input
                  autoFocus
                  type="number"
                  inputMode="numeric"
                  value={guess}
                  onChange={(e) => setGuess(e.target.value)}
                  aria-label="running count"
                  placeholder="0"
                />
                <button type="submit" className="btn btn--deal">
                  CALL IT
                </button>
              </form>
            </>
          )}
          {phase === 'result' && (
            <>
              <div className="prompt">{result?.ok ? 'AGAIN — FASTER?' : 'RUN IT BACK'}</div>
              <div className="trainer-options">
                <button className="deal-btn" onClick={start}>
                  DEAL
                </button>
                <button className="btn btn--ghost" onClick={() => setPhase('setup')}>
                  Change speed
                </button>
              </div>
            </>
          )}
        </div>
        <div className="hud-side" />
      </footer>
    </>
  );
}

/* ---------- drill 3: true count ---------- */

const DECK_CHOICES = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6];

function tcQuestion() {
  // Skew toward the counts that actually decide bets and index plays.
  const rc = Math.floor(Math.random() * 25) - 10 || 3;
  const decks = DECK_CHOICES[Math.floor(Math.random() * DECK_CHOICES.length)];
  return { rc, decks };
}

function TCDrill() {
  const [q, setQ] = useState(tcQuestion);
  const [guess, setGuess] = useState('');
  const [result, setResult] = useState<{ ok: boolean; exact: number; guess: number } | null>(null);
  const [asked, setAsked] = useState(0);
  const [right, setRight] = useState(0);

  const exact = trueCount(q.rc, q.decks * 52);

  const submit = () => {
    const g = Number(guess);
    if (guess.trim() === '' || !Number.isFinite(g)) return;
    // Within half a true count is a working answer at the table.
    const ok = Math.abs(g - exact) <= 0.5 + 1e-9;
    play(ok ? 'correct' : 'incorrect');
    setAsked((a) => a + 1);
    if (ok) setRight((r) => r + 1);
    setResult({ ok, exact, guess: g });
  };

  const next = () => {
    setQ(tcQuestion());
    setGuess('');
    setResult(null);
  };

  return (
    <>
      <Felt>
        <div className="trainer-stage">
          <div className="trainer-score">
            <span>
              Asked <b>{asked}</b>
            </span>
            <span>
              Right <b>{asked > 0 ? `${right}/${asked}` : '—'}</b>
            </span>
          </div>
          <div className="trainer-tc">
            <div>
              <span>Running count</span>
              <b>{sign(q.rc)}</b>
            </div>
            <div>
              <span>Decks left</span>
              <b>{q.decks}</b>
            </div>
          </div>
          {result && (
            <div className={`trainer-result ${result.ok ? 'trainer-result--good' : 'trainer-result--bad'}`}>
              <b>{result.ok ? '✓ Close enough to bet on' : '✗ Off by too much'}</b>
              <span>
                Exact: <b>{sign(result.exact, 1)}</b> ({sign(q.rc)} ÷ {q.decks}) — you said{' '}
                {sign(result.guess, 1)}
              </span>
            </div>
          )}
          <p className="trainer-note">
            True count = running count ÷ decks remaining. It's what sizes your bet and triggers
            the index plays — within half a point is good enough at the table.
          </p>
        </div>
      </Felt>
      <footer className="hud-bottom">
        <div className="hud-pills" />
        <div className="console">
          {result === null ? (
            <>
              <div className="prompt">TRUE COUNT?</div>
              <form
                className="trainer-answer"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <input
                  autoFocus
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  value={guess}
                  onChange={(e) => setGuess(e.target.value)}
                  aria-label="true count"
                  placeholder="0.0"
                />
                <button type="submit" className="btn btn--deal">
                  CALL IT
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="prompt">ENTER FOR THE NEXT ONE</div>
              <form
                className="trainer-answer"
                onSubmit={(e) => {
                  e.preventDefault();
                  next();
                }}
              >
                <button autoFocus type="submit" className="deal-btn">
                  NEXT
                </button>
              </form>
            </>
          )}
        </div>
        <div className="hud-side" />
      </footer>
    </>
  );
}

/* ---------- the trainer shell ---------- */

const DRILLS = [
  { id: 'tags', name: 'Tag cards' },
  { id: 'count', name: 'Keep the count' },
  { id: 'tc', name: 'True count' },
] as const;

type DrillId = (typeof DRILLS)[number]['id'];

export function CountTrainer({ onExit }: { onExit: () => void }) {
  const [drill, setDrill] = useState<DrillId>('tags');
  return (
    <div className="scene">
      <header className="hud-top">
        <button className="btn btn--ghost" onClick={onExit}>
          ‹ Lobby
        </button>
        <div className="hud-top__mode">LEARN TO COUNT</div>
        <div className="trainer-tabs">
          {DRILLS.map((d) => (
            <button
              key={d.id}
              className={`trainer-seg__btn ${drill === d.id ? 'trainer-seg__btn--on' : ''}`}
              onClick={() => setDrill(d.id)}
            >
              {d.name}
            </button>
          ))}
        </div>
        <MuteButton />
      </header>
      {drill === 'tags' && <TagDrill />}
      {drill === 'count' && <CountdownDrill />}
      {drill === 'tc' && <TCDrill />}
    </div>
  );
}

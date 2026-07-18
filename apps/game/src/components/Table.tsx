import { useEffect, useMemo, useRef, useState } from 'react';
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
 * The dealing shoe: a clear acrylic wedge sitting flat on the felt. The pack's
 * base is level on the floor and every card leans back diagonally onto the one
 * behind it, cascading into the pusher — which leans at the same angle and
 * props up only the back card. The front card's back faces the player at the
 * mouth, the red cut card rides at the 75% penetration mark, and the pack
 * depletes from the front as the pusher advances.
 */
export function DealShoe({ decks, fill }: { decks: number; fill: number }) {
  // fill <= 0 draws an empty shoe: stub pulled, pusher run out to the mouth.
  const empty = fill <= 0.001;
  const level = Math.max(0.04, Math.min(1, fill));
  // The pack's LENGTH scales with the deck count — more decks, longer brick.
  const fullW = (0.32 + (Math.min(decks, 8) / 8) * 0.58) * 166;
  const w = empty ? 0 : Math.max(7, level * fullW);
  // Cards ahead of the cut card get dealt; 25% of a full pack always sits
  // behind it, so it slides toward the mouth as the shoe runs down.
  const cutOffset = (level - 0.25) * fullW;
  const showCut = !empty && level > 0.265 && cutOffset > 2;
  const cards = empty ? 0 : Math.round(level * decks * 52);
  const toCut = Math.round(Math.max(0, level - 0.25) * decks * 52);
  // Whenever the card count drops, the front card visibly peels off the pack
  // (the pusher's own 0.5s slide supplies the spring nudging forward).
  const prevCards = useRef(cards);
  const [peel, setPeel] = useState(0);
  useEffect(() => {
    if (cards < prevCards.current && cards > 0) setPeel((n) => n + 1);
    prevCards.current = cards;
  }, [cards]);
  const slide = { transition: 'transform 0.5s ease' } as const;
  const grow = { transition: 'width 0.5s ease' } as const;
  return (
    <div
      className="shoe"
      title={
        empty
          ? 'Shoe done — shuffling before the next deal'
          : toCut > 0
            ? `${cards} cards in the shoe — ${toCut} to the cut card, then a reshuffle`
            : 'The cut card is out — next deal reshuffles'
      }
    >
      <svg viewBox="0 0 260 150" role="presentation" focusable="false">
        <defs>
          <radialGradient id="shoe-shadow">
            <stop offset="0" stopColor="#000" stopOpacity="0.4" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="shoe-acrylic" x1="0" y1="0" x2="0.55" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.05" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.12" />
          </linearGradient>
          <linearGradient id="shoe-roller" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#0a0e12" />
            <stop offset="0.45" stopColor="#39434c" />
            <stop offset="1" stopColor="#05080b" />
          </linearGradient>
          {/* the pack's side: cool white cards in the acrylic's shadow */}
          <linearGradient id="shoe-sideshade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="0.25" stopColor="#fff" stopOpacity="0.08" />
            <stop offset="0.75" stopColor="#20261f" stopOpacity="0.16" />
            <stop offset="1" stopColor="#20261f" stopOpacity="0.38" />
          </linearGradient>
          <pattern id="shoe-side" width="2.2" height="8" patternUnits="userSpaceOnUse">
            <rect width="2.2" height="8" fill="#e9ebe7" />
            <rect x="1.5" width="0.7" height="8" fill="#c3c7c1" />
          </pattern>
          {/* the lit top edges of the cards: dense fine ticks */}
          <pattern id="shoe-top" width="1.7" height="8" patternUnits="userSpaceOnUse">
            <rect width="1.7" height="8" fill="#fbfbf8" />
            <rect x="1.15" width="0.55" height="8" fill="#c6c9c3" />
          </pattern>
          <pattern
            id="shoe-back"
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="7" height="2" fill="rgba(255,255,255,0.18)" />
          </pattern>
        </defs>

        <ellipse cx="130" cy="128" rx="122" ry="9" fill="url(#shoe-shadow)" />

        {/* far acrylic wall (behind the pack) */}
        <path
          d="M 10 124 L 240 124 L 240 30 L 76 60 L 44 110 Z"
          transform="translate(13,-8)"
          fill="rgba(220,240,232,0.07)"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        {/* flat floor — the shoe's base sits level on the felt */}
        <polygon points="10,124 240,124 253,116 23,116" fill="rgba(6,14,10,0.4)" />
        {/* the gravity wedge: a shallow rise inside, base level at the mouth,
            higher toward the back, so the cards feed the pusher naturally */}
        <polygon points="34,119 226,119 226,105.6" fill="rgba(255,255,255,0.13)" />
        <path d="M 34 119 L 226 105.6" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8" fill="none" />

        {/* everything on the wedge rides its 4° incline */}
        <g transform="rotate(-4 34 119)">
          {/* the pack: every card leaning back 26° onto the one behind it,
              cascading into the pusher */}
          {!empty && (
            <>
              <g transform="translate(34,119) matrix(1 0 -0.484 1 0 0)">
                <rect x="0" y="-62" width={w} height="62" fill="url(#shoe-side)" style={grow} />
                <rect x="0" y="-62" width={w} height="62" fill="url(#shoe-sideshade)" style={grow} />
              </g>
              {/* the lit top edges of the leaning cards */}
              <g transform="matrix(1 0 -13 8 77 49)">
                <rect x="0" y="0" width={w} height="1" fill="url(#shoe-top)" style={grow} />
              </g>
            </>
          )}

          {/* the red cut card: leans with the pack, stands a little taller */}
          {showCut && (
            <g style={{ transform: `translateX(${cutOffset.toFixed(1)}px)`, ...slide }}>
              <polygon points="34,119 67,51 69.6,51 36.6,119" fill="#d63b2f" />
              <polygon points="67,51 69.6,51 82.6,43 80,43" fill="#ff7b66" />
            </g>
          )}

          {/* the pusher: a plate leaning at the same angle, propping only the
              back card, its wheel riding the wedge */}
          <g style={{ transform: `translateX(${w.toFixed(1)}px)`, ...slide }}>
            <polygon points="47,119 77,57 90,49 60,111" fill="#242e36" />
            <polygon points="34,119 64,57 77,57 47,119" fill="url(#shoe-roller)" />
            <circle cx="52" cy="113" r="5.4" fill="#05080b" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
            <circle cx="53.6" cy="111.4" r="1.7" fill="rgba(255,255,255,0.25)" />
          </g>

          {/* the next card out: the front of the pack, leaning back so its
              whole back faces up toward the player */}
          {!empty && (
            <>
              <polygon
                points="34,119 64,57 77,49 47,111"
                fill="#f2f0e8"
                stroke="rgba(0,0,0,0.28)"
                strokeWidth="0.7"
                strokeLinejoin="round"
              />
              <polygon points="37.6,116 65.3,58.7 75,52.7 47.3,110" fill="var(--back-1, #2d54a6)" />
              <polygon points="37.6,116 65.3,58.7 75,52.7 47.3,110" fill="url(#shoe-back)" />
            </>
          )}

          {/* the card just dealt, peeling off the front */}
          {peel > 0 && !empty && (
            <g key={peel} className="shoe-peel">
              <polygon points="34,119 64,57 77,49 47,111" fill="#f2f0e8" stroke="rgba(0,0,0,0.28)" strokeWidth="0.7" />
              <polygon points="37.6,116 65.3,58.7 75,52.7 47.3,110" fill="var(--back-1, #2d54a6)" />
              <polygon points="37.6,116 65.3,58.7 75,52.7 47.3,110" fill="url(#shoe-back)" />
            </g>
          )}
        </g>

        {/* near acrylic shell: flat on the felt, low mouth cut in front of
            the leaning card, rising to the tall back */}
        <path
          d="M 10 124 L 240 124 L 240 30 L 76 60 L 44 110 Z"
          fill="url(#shoe-acrylic)"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        {/* acrylic thickness edges */}
        <path
          d="M 240 30 L 253 22 M 10 124 L 23 116 M 240 124 L 253 116"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth="0.9"
          fill="none"
        />
      </svg>
    </div>
  );
}

/** The discard tray: cards stack up flat, like the real holder, as the shoe empties. */
export function DiscardTray({ dealt }: { dealt: number }) {
  const level = Math.max(0, Math.min(1, dealt));
  const h = 4 + level * 78; // stack height in viewBox units
  return (
    <div className="discard" aria-hidden="true">
      <svg viewBox="0 0 150 140" role="presentation" focusable="false">
        <defs>
          <radialGradient id="dc-shadow">
            <stop offset="0" stopColor="#000" stopOpacity="0.38" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          {/* card edges seen from the side: thin horizontal stripes */}
          <pattern id="dc-side" width="8" height="3.4" patternUnits="userSpaceOnUse">
            <rect width="8" height="3.4" fill="#f2eee1" />
            <rect y="2.4" width="8" height="1" fill="#a89f88" />
          </pattern>
          <pattern id="dc-side-dark" width="8" height="3.4" patternUnits="userSpaceOnUse">
            <rect width="8" height="3.4" fill="#d8d1bd" />
            <rect y="2.4" width="8" height="1" fill="#8f866f" />
          </pattern>
          <pattern
            id="dc-back"
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="7" height="2" fill="rgba(255,255,255,0.18)" />
          </pattern>
          <linearGradient id="dc-shade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#000" stopOpacity="0.22" />
            <stop offset="0.18" stopColor="#000" stopOpacity="0" />
            <stop offset="0.8" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.18" />
          </linearGradient>
        </defs>

        <ellipse cx="73" cy="127" rx="66" ry="9" fill="url(#dc-shadow)" />
        {/* back acrylic wall */}
        <polygon
          points="21,111 139,111 139,29 21,29"
          fill="rgba(255,255,255,0.07)"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="0.8"
        />
        {/* base plate */}
        <polygon
          points="8,120 126,120 139,111 21,111"
          fill="rgba(255,255,255,0.12)"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="0.8"
        />
        <rect x="8" y="120" width="118" height="7" fill="rgba(10,16,12,0.5)" />

        {level > 0.005 && (
          <>
            {/* stack front face + right depth face grow with the pile */}
            <rect
              x="18"
              y={120 - h}
              width="92"
              height={h}
              fill="url(#dc-side)"
              style={{ transition: 'y 0.6s ease, height 0.6s ease' }}
            />
            <rect
              x="18"
              y={120 - h}
              width="92"
              height={h}
              fill="url(#dc-shade)"
              style={{ transition: 'y 0.6s ease, height 0.6s ease' }}
            />
            <g transform="matrix(1 -0.6923 0 1 0 76.15)">
              <rect
                x="110"
                y={120 - h}
                width="13"
                height={h}
                fill="url(#dc-side-dark)"
                style={{ transition: 'y 0.6s ease, height 0.6s ease' }}
              />
            </g>
            {/* a few cards sit proud of the pile — it's a dump, not a machined block */}
            {h > 22 && (
              <rect
                x="14"
                y={120 - h * 0.58}
                width="98"
                height="2.6"
                rx="1"
                fill="#f7f4ea"
                stroke="rgba(0,0,0,0.18)"
                strokeWidth="0.4"
                style={{ transition: 'y 0.6s ease' }}
              />
            )}
            {h > 42 && (
              <rect
                x="20"
                y={120 - h * 0.28}
                width="94"
                height="2.6"
                rx="1"
                fill="#efeadb"
                stroke="rgba(0,0,0,0.18)"
                strokeWidth="0.4"
                style={{ transition: 'y 0.6s ease' }}
              />
            )}
            {/* top card, face down */}
            <g style={{ transform: `translateY(${(-h).toFixed(1)}px)`, transition: 'transform 0.6s ease' }}>
              <polygon points="18,120 110,120 123,111 31,111" fill="#f2efe6" />
              <polygon points="24.3,119.5 105.3,119.5 116.7,111.5 35.7,111.5" fill="var(--back-1, #2d54a6)" />
              <polygon points="24.3,119.5 105.3,119.5 116.7,111.5 35.7,111.5" fill="url(#dc-back)" />
            </g>
          </>
        )}

        {/* low front wall — the stack reads through it */}
        <rect
          x="8"
          y="94"
          width="118"
          height="26"
          fill="rgba(255,255,255,0.1)"
          stroke="rgba(255,255,255,0.5)"
          strokeWidth="1.2"
        />
        {level <= 0.005 && (
          <text
            x="67"
            y="112"
            textAnchor="middle"
            fontSize="10.5"
            fontWeight="700"
            letterSpacing="3"
            fill="rgba(255,255,255,0.35)"
          >
            DISCARDS
          </text>
        )}
      </svg>
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

/* ---------- streak fire ---------- */

/**
 * The streak fire: appears at 10 straight correct calls and burns hotter as
 * the run grows — amber, then orange-red, crimson at 35, blue-white at 50+.
 */
export function StreakFlame({ streak }: { streak: number }) {
  if (streak < 10) return null;
  const tier = streak >= 50 ? 'blue' : streak >= 35 ? 'scorch' : streak >= 20 ? 'hot' : 'ember';
  return (
    <div className={`flame flame--${tier}`} title={`${streak} correct calls in a row`}>
      <svg viewBox="0 0 32 40" role="presentation" focusable="false">
        <path
          className="flame__outer"
          d="M16 2.5 C 18 10, 26 14, 26 24 C 26 32, 21.5 38, 16 38 C 10.5 38, 6 32, 6 24 C 6 18, 9.5 15.5, 11 10.5 C 12.5 14, 15 15, 16 2.5 Z"
        />
        <path
          className="flame__core"
          d="M16 15 C 17.5 19, 21 21, 21 27 C 21 32, 18.8 35.2, 16 35.6 C 13.2 35.2, 11 32, 11 27 C 11 22.5, 14 19.5, 16 15 Z"
        />
      </svg>
      <b>{streak}</b>
    </div>
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
  // The same animation replays when the cut card has come out: the next DEAL
  // shuffles first, then the cards come out of the new shoe.
  const [shuffling, setShuffling] = useState(true);
  const [pendingDeal, setPendingDeal] = useState(false);
  useEffect(() => {
    if (game.status !== 'ready') return;
    play('shuffle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.status]);
  useEffect(() => {
    if (!shuffling || game.status !== 'ready') return;
    const t = setTimeout(() => setShuffling(false), 2900);
    return () => clearTimeout(t);
  }, [shuffling, game.status]);
  useEffect(() => {
    if (!shuffling && pendingDeal) {
      setPendingDeal(false);
      game.deal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuffling, pendingDeal]);
  // Casinos rotate two decks of alternating back colors — every reshuffle
  // brings in the other one.
  const [redDeck, setRedDeck] = useState(false);
  const requestDeal = () => {
    if (!game.canDeal || shuffling) return;
    // Everything dealt before this round is in the discard by now — count it,
    // whether or not the sweep animation got to play (fast re-deals skip it).
    setTrayFrac(dealtFrac);
    if (game.shufflePending) {
      // The red card is out — shuffle in front of the player, then deal.
      setPendingDeal(true);
      setShuffling(true);
      setRedDeck((r) => !r);
      play('shuffle');
    } else {
      game.deal();
    }
  };

  // After a round settles the cards linger for a beat, then get swept to the
  // discard so the next betting round starts on a clean felt (Evolution-style).
  const [swept, setSwept] = useState(false);
  const settledNow = round !== null && round.phase === 'settled';
  useEffect(() => {
    if (betting && settledNow && !game.endlessOver) {
      setSwept(false);
      const t = setTimeout(() => {
        // Aim every card at the discard tray from wherever it sits right now,
        // in its own coordinate space (the felt may be transformed).
        const tray = document.querySelector('.discard');
        if (tray) {
          const tr = tray.getBoundingClientRect();
          document.querySelectorAll<HTMLElement>('.table__felt .card').forEach((el, k) => {
            const c = el.getBoundingClientRect();
            if (!c.width) return;
            const scale = c.width / el.offsetWidth || 1;
            const dx = (tr.left + tr.width * 0.5 - (c.left + c.width / 2)) / scale;
            const dy = (tr.top + tr.height * 0.55 - (c.top + c.height / 2)) / scale;
            el.style.setProperty('--sw-x', `${dx.toFixed(1)}px`);
            el.style.setProperty('--sw-y', `${dy.toFixed(1)}px`);
            el.style.setProperty('--sw-d', `${k * 70}ms`);
          });
        }
        setSwept(true);
      }, 2000);
      return () => clearTimeout(t);
    }
    setSwept(false);
  }, [betting, settledNow, game.endlessOver, game.version]);

  // The discard pile grows when the swept cards actually land on it (not at
  // deal time), and empties the moment a reshuffle refills the shoe. It runs
  // off the shoe's physical level, not the HUD's fresh-shoe override.
  const dealtFrac = game.rules ? 1 - game.shoeDecksLeft / game.rules.decks : 0;
  const [trayFrac, setTrayFrac] = useState(dealtFrac);
  useEffect(() => {
    if (dealtFrac < trayFrac - 0.001) setTrayFrac(dealtFrac);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealtFrac]);
  useEffect(() => {
    if (!swept) return;
    const t = setTimeout(() => setTrayFrac(dealtFrac), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swept]);

  // The stub pull — dealer empties the retiring shoe onto the discards, cut
  // card on top — waits for the sweep to actually deliver the last round's
  // cards instead of snapping the felt to its end state at settle time.
  const [stubPulled, setStubPulled] = useState(false);
  useEffect(() => {
    if (!(game.shufflePending && betting)) {
      setStubPulled(false);
      return;
    }
    if (!swept) return;
    const t = setTimeout(() => setStubPulled(true), 900);
    return () => clearTimeout(t);
  }, [game.shufflePending, betting, swept]);

  // When the stub is pulled, show the cut card flying from the shoe onto the
  // discard tray.
  const [cutFly, setCutFly] = useState<{ x: number; y: number; dx: number; dy: number } | null>(
    null
  );
  const sawCut = useRef(false);
  useEffect(() => {
    if (stubPulled && !sawCut.current) {
      const shoe = document.querySelector('.shoe');
      const tray = document.querySelector('.discard');
      const table = document.querySelector('.table');
      if (shoe && tray && table) {
        const s = shoe.getBoundingClientRect();
        const t = tray.getBoundingClientRect();
        const b = table.getBoundingClientRect();
        const x = s.left - b.left + s.width * 0.12;
        const y = s.top - b.top + s.height * 0.55;
        setCutFly({
          x,
          y,
          dx: t.left - b.left + t.width * 0.4 - x,
          dy: t.top - b.top + t.height * 0.4 - y,
        });
      }
    }
    sawCut.current = stubPulled;
  }, [stubPulled]);

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
        requestDeal();
      } else if (betting && !shuffling && e.key >= '1' && e.key <= '5') {
        // No bet edits once the shuffle overlay is up: the queued deal was
        // approved at this stake, and shrinking it below the table minimum
        // would silently swallow the deal.
        game.addChip(CHIP_DENOMS[Number(e.key) - 1]);
      } else if (betting && !shuffling && e.key === 'Backspace') {
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
    <div className={`scene ${redDeck ? 'scene--reddeck' : ''}`}>
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
        <StreakFlame streak={game.streak} />
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
          {/* Once the round with the cut card ends and the sweep has landed,
              the dealer pulls the stub: the shoe runs empty and the discards
              take the rest. */}
          <DealShoe decks={r.decks} fill={stubPulled ? 0 : game.shoeDecksLeft / r.decks} />
          <DiscardTray dealt={stubPulled ? 1 : trayFrac} />
          {stubPulled && !shuffling && (
            <div className="shoe-note">CUT CARD OUT — SHUFFLE BEFORE THE NEXT DEAL</div>
          )}
          <FeltText rules={r} counting={mode === 'counting'} />

          <section className="dealer-spot">
            {round && round.dealerCards.length > 0 && (
              <div className={swept && settled ? 'swept' : ''}>
                <div className="cards cards--dealer">
                  {/* Casino deal order: the up card lands after every seat's
                      first card, the hole after every seat's second. */}
                  {round.dealerCards.map((c, i) => (
                    <CardView
                      key={i}
                      card={c}
                      index={i === 0 ? round.seats : i === 1 ? 2 * round.seats + 1 : i - 2}
                      hidden={i === 1 && !round.holeRevealed}
                    />
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
                    <div className={`hands ${swept && settled ? 'swept' : ''}`}>
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
                                <CardView
                                  key={j}
                                  card={c}
                                  // Initial two cards fly in casino order across
                                  // the seats (seat 0 = rightmost, dealt first);
                                  // hits and split hands come out immediately.
                                  index={
                                    hand.fromSplit || j >= 2
                                      ? Math.max(0, j - 2)
                                      : j === 0
                                        ? seat
                                        : round!.seats + 1 + seat
                                  }
                                />
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

        {/* the cut card being pulled from the shoe and set on the discards */}
        {cutFly && (
          <div
            className="cut-fly"
            style={{
              left: `${cutFly.x}px`,
              top: `${cutFly.y}px`,
              ['--cf-x' as string]: `${cutFly.dx.toFixed(1)}px`,
              ['--cf-y' as string]: `${cutFly.dy.toFixed(1)}px`,
            }}
            onAnimationEnd={() => setCutFly(null)}
          />
        )}

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
                <button className="deal-btn" disabled={!game.canDeal} onClick={requestDeal}>
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
                {game.streak} ✓ · best {game.bestEndless}
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
            {game.streak >= game.bestEndless && game.streak > 0 && (
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

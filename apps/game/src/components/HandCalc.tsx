import { useState } from 'react';
import { ACTION_LABEL, explain, handValue } from '@perfect21/engine';
import type { Action, Rules } from '@perfect21/engine';
import type { Profile } from '../profile';
import { useStrategy } from './StatsScreen';

const RANK_FACES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const face = (r: number) => RANK_FACES[r - 1];
const MAX_CARDS = 8;

/** Mirror of Round.availableActions for a fresh (non-split) hand. */
function availableFor(ranks: number[], rules: Rules): Action[] {
  const v = handValue(ranks);
  if (v.bust || v.total === 21) return [];
  const actions: Action[] = ['hit', 'stand'];
  if (ranks.length === 2) {
    const dblRule =
      rules.double === 'all' ||
      (!v.soft &&
        (rules.double === '10-11'
          ? v.total === 10 || v.total === 11
          : v.total >= 9 && v.total <= 11));
    if (dblRule) actions.push('double');
    if (ranks[0] === ranks[1]) actions.push('split');
    if (rules.surrender !== 'none') actions.push('surrender');
  }
  return actions;
}

const evPct = (ev: number) => `${ev >= 0 ? '+' : '−'}${Math.abs(ev * 100).toFixed(1)}%`;

function RankPicker({
  onPick,
  active,
  disabled,
}: {
  onPick: (r: number) => void;
  active?: number | null;
  disabled?: boolean;
}) {
  return (
    <div className="calc-picker">
      {RANK_FACES.map((f, i) => (
        <button
          key={f}
          className={`calc-card ${active === i + 1 ? 'calc-card--on' : ''}`}
          onClick={() => onPick(i + 1)}
          disabled={disabled}
          title={f === '10' ? '10, J, Q or K — all count the same' : undefined}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

export function HandCalc({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const strategy = useStrategy(profile.rules);
  const [up, setUp] = useState<number | null>(null);
  const [hand, setHand] = useState<number[]>([]);

  const v = handValue(hand);
  const complete = up !== null && hand.length >= 2;
  const rec =
    strategy && complete && !v.bust && v.total !== 21 && !v.blackjack
      ? strategy.recommend(hand, up, availableFor(hand, strategy.rules))
      : null;

  const totalLabel =
    hand.length >= 2
      ? v.blackjack
        ? 'Blackjack'
        : `${v.soft ? 'soft ' : ''}${v.total}`
      : null;

  return (
    <div className="room room--menu">
      <div className="menu menu--wide">
        <h2 className="screen-title">Hand calculator</h2>
        <p className="stat__hint">
          The book's answer for any hand under your table rules ({profile.rules.decks} deck
          {profile.rules.decks === 1 ? '' : 's'}, {profile.rules.soft17.toUpperCase()}
          {profile.rules.das ? ', DAS' : ''}). Basic strategy only — the count isn't consulted,
          and nothing here touches your stats.
        </p>

        <div className="calc-row">
          <span className="calc-row__label">Dealer shows</span>
          <RankPicker onPick={setUp} active={up} />
        </div>

        <div className="calc-row">
          <span className="calc-row__label">Your cards</span>
          <RankPicker
            onPick={(r) => setHand((h) => (h.length < MAX_CARDS ? [...h, r] : h))}
            disabled={hand.length >= MAX_CARDS || v.bust || v.total === 21}
          />
        </div>

        {hand.length > 0 && (
          <div className="calc-hand">
            {hand.map((r, i) => (
              <button
                key={i}
                className="calc-card calc-card--held"
                title="Remove this card"
                onClick={() => setHand((h) => h.filter((_, k) => k !== i))}
              >
                {face(r)}
              </button>
            ))}
            {totalLabel && <span className="calc-hand__total">{totalLabel}</span>}
            <button className="btn btn--ghost" onClick={() => setHand([])}>
              Clear
            </button>
          </div>
        )}

        {!strategy ? (
          <p className="stat__hint">Deriving basic strategy for your table rules…</p>
        ) : !complete ? (
          <p className="stat__hint">
            Pick the dealer's upcard and at least two of your own cards.
          </p>
        ) : v.blackjack ? (
          <div className="calc-verdict">
            <b>BLACKJACK</b>
            <p>Nothing to decide — collect your 3:2 and look modest.</p>
          </div>
        ) : v.bust ? (
          <div className="calc-verdict calc-verdict--bad">
            <b>BUSTED — {v.total}</b>
            <p>No decision survives 22. The chips were gone a card ago.</p>
          </div>
        ) : v.total === 21 ? (
          <div className="calc-verdict">
            <b>STAND</b>
            <p>Twenty-one. Any further card can only hurt you.</p>
          </div>
        ) : rec ? (
          <div className="calc-verdict">
            <b>{ACTION_LABEL[rec.action].toUpperCase()}</b>
            <p>{explain(strategy, hand, up!, rec)}</p>
            <div className="calc-evs">
              {(Object.entries(rec.evs) as Array<[Action, number]>)
                .sort((a, b) => b[1] - a[1])
                .map(([a, ev]) => (
                  <span key={a} className={a === rec.action ? 'calc-evs__best' : ''}>
                    {ACTION_LABEL[a]} <b>{evPct(ev)}</b>
                  </span>
                ))}
            </div>
            <p className="stat__hint">Expected value per unit bet, for this exact composition.</p>
          </div>
        ) : null}

        <button className="btn btn--ghost" onClick={onBack}>
          ‹ Back
        </button>
      </div>
    </div>
  );
}

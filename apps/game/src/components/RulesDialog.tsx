import { useMemo, useState } from 'react';
import { blackjackinfoUrl } from '@perfect21/engine';
import type { DoubleRule, Rules, Soft17Rule, SurrenderRule } from '@perfect21/engine';
import { useStrategy } from './StatsScreen';

/**
 * How countable is a shoe of this size? Penetration is fixed at the 75% cut
 * card and blackjack always pays 3:2 here, so deck count is the lever that's
 * left — fewer decks swing the true count harder and more often. Six decks is
 * a legitimate (if thin) counting game; eight is a grind for pennies.
 */
function countVerdict(decks: number): { tier: 'good' | 'ok' | 'bad'; text: string } {
  if (decks <= 2) return { tier: 'good', text: 'prime counting territory' };
  if (decks <= 6) return { tier: 'ok', text: 'a grind — real edge, but the good counts come slowly' };
  return { tier: 'bad', text: 'barely worth counting — the count almost never climbs' };
}

export function RulesDialog({
  rules,
  countingDecks,
  onSave,
  onClose,
}: {
  rules: Rules;
  countingDecks: number;
  onSave: (r: Rules, countingDecks: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Rules>({ ...rules });
  const [countDecks, setCountDecks] = useState(countingDecks);
  const set = <K extends keyof Rules>(k: K, v: Rules[K]) => setDraft({ ...draft, [k]: v });

  // Live theoretical RTP for whatever is selected — one number per shoe, never
  // combined: the basic figure assumes book play off the top, and counting
  // changes the realized return (deviations + bet spread), not this baseline.
  const basicStrategy = useStrategy(draft);
  const countRules = useMemo<Rules>(
    () => ({ ...draft, decks: countDecks as Rules['decks'] }),
    [draft, countDecks]
  );
  const countStrategy = useStrategy(countRules);

  const basicRTP = basicStrategy ? basicStrategy.theoreticalRTP() : null;
  const countRTP = countStrategy ? countStrategy.theoreticalRTP() : null;
  // Hi-Lo is worth ~+0.5% per true count; the count flips the game positive
  // once it covers the base house edge.
  const breakEvenTC = countRTP !== null ? Math.max(0, (1 - countRTP) / 0.005) : null;
  const verdict = countVerdict(countDecks);

  const pct = (v: number | null) => (v !== null ? `${(v * 100).toFixed(2)}%` : '…');

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay__panel overlay__panel--rules" onClick={(e) => e.stopPropagation()}>
        <h2>Table rules</h2>
        <p className="rules-note">
          Strategy is re-derived for whatever you pick — the same parameter space as the{' '}
          <a href={blackjackinfoUrl(draft)} target="_blank" rel="noreferrer">
            BlackjackInfo engine
          </a>
          .
        </p>

        <label className="field">
          <span>Decks</span>
          <select value={draft.decks} onChange={(e) => set('decks', Number(e.target.value) as Rules['decks'])}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Dealer soft 17</span>
          <select value={draft.soft17} onChange={(e) => set('soft17', e.target.value as Soft17Rule)}>
            <option value="s17">Stands (S17)</option>
            <option value="h17">Hits (H17)</option>
          </select>
        </label>

        <label className="field">
          <span>Double allowed on</span>
          <select value={draft.double} onChange={(e) => set('double', e.target.value as DoubleRule)}>
            <option value="all">Any two cards</option>
            <option value="9-11">9–11 only</option>
            <option value="10-11">10–11 only</option>
          </select>
        </label>

        <label className="field">
          <span>Double after split</span>
          <select value={draft.das ? 'yes' : 'no'} onChange={(e) => set('das', e.target.value === 'yes')}>
            <option value="yes">Allowed (DAS)</option>
            <option value="no">Not allowed</option>
          </select>
        </label>

        <label className="field">
          <span>Surrender</span>
          <select value={draft.surrender} onChange={(e) => set('surrender', e.target.value as SurrenderRule)}>
            <option value="none">None</option>
            <option value="late">Late surrender</option>
            <option value="early">Early surrender</option>
          </select>
        </label>

        <label className="field">
          <span>Dealer peek</span>
          <select value={draft.peek ? 'yes' : 'no'} onChange={(e) => set('peek', e.target.value === 'yes')}>
            <option value="yes">Peeks for blackjack</option>
            <option value="no">No peek (ENHC)</option>
          </select>
        </label>

        <div className="rtp-panel">
          <div className="rtp-panel__row">
            <span>Basic-strategy RTP, these rules</span>
            <b>{pct(basicRTP)}</b>
          </div>
          {basicRTP !== null && (
            <div className="rtp-panel__row rtp-panel__row--sub">
              <span>house edge</span>
              <b>{((1 - basicRTP) * 100).toFixed(2)}%</b>
            </div>
          )}
        </div>

        <label className={`field ${verdict.tier === 'bad' ? 'field--bad' : ''}`}>
          <span>Card counting shoe</span>
          <select value={countDecks} onChange={(e) => setCountDecks(Number(e.target.value))}>
            <option value={1}>1 deck — single deck</option>
            <option value={2}>2 decks — the classic pitch game</option>
            <option value={6}>6 decks — typical casino shoe</option>
            <option value={8}>8 decks — not worth counting</option>
          </select>
        </label>

        <div className={`rtp-panel rtp-panel--${verdict.tier}`}>
          <div className="rtp-panel__row">
            <span>Counting table RTP off the top ({countDecks} deck{countDecks === 1 ? '' : 's'})</span>
            <b>{pct(countRTP)}</b>
          </div>
          {breakEvenTC !== null && (
            <div className="rtp-panel__row rtp-panel__row--sub">
              <span>count turns the game positive at</span>
              <b>TC {breakEvenTC <= 0 ? '±0' : `+${breakEvenTC.toFixed(1)}`}</b>
            </div>
          )}
          <div className="rtp-panel__verdict">{verdict.text}</div>
        </div>

        <p className="rules-note">
          Both figures assume 3:2 blackjack, perfect play, per initial bet, cut card at 75%.
          They are separate on purpose: the basic number is book play off the top; counting
          (Hi-Lo, ~+0.5% per true count) moves your realized return, not this baseline.
          Counters hunt for few decks because a small shoe swings the count harder and
          more often — but a deeply dealt 6-deck game is still beatable.
        </p>

        <div className="overlay__buttons">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--deal"
            onClick={() => {
              onSave(draft, countDecks);
              onClose();
            }}
          >
            Save rules
          </button>
        </div>
      </div>
    </div>
  );
}

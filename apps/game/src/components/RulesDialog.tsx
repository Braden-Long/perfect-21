import { useState } from 'react';
import { blackjackinfoUrl } from '@perfect21/engine';
import type { DoubleRule, Rules, Soft17Rule, SurrenderRule } from '@perfect21/engine';

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

        <label className="field">
          <span>Card counting shoe</span>
          <select value={countDecks} onChange={(e) => setCountDecks(Number(e.target.value))}>
            <option value={1}>1 deck — single deck</option>
            <option value={2}>2 decks — the classic pitch game</option>
            <option value={6}>6 decks — typical casino shoe</option>
            <option value={8}>8 decks — not worth counting</option>
          </select>
        </label>
        <p className="rules-note">
          Counting mode deals its own shoe. Counters hunt for few decks: in a deeply dealt
          double-deck game you hold the edge on roughly a quarter of your hands; in an 8-deck
          shoe the true count barely moves and the good spots almost never come.
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

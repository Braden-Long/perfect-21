import type { Card } from '@perfect21/engine';

const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export function CardView({ card, hidden, index }: { card: Card; hidden?: boolean; index?: number }) {
  const red = card.suit === 'H' || card.suit === 'D';
  return (
    <div
      className={`card ${hidden ? 'card--hidden' : ''} ${red ? 'card--red' : ''}`}
      style={{ ['--deal-i' as string]: index ?? 0 }}
    >
      {hidden ? (
        <div className="card__back" />
      ) : (
        <>
          <div className="card__corner card__corner--tl">
            <span>{card.face}</span>
            <span>{SUIT_GLYPH[card.suit]}</span>
          </div>
          <div className="card__pip">{SUIT_GLYPH[card.suit]}</div>
          <div className="card__corner card__corner--br">
            <span>{card.face}</span>
            <span>{SUIT_GLYPH[card.suit]}</span>
          </div>
        </>
      )}
    </div>
  );
}

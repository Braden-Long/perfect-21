import { useLayoutEffect, useRef } from 'react';
import type { Card } from '@perfect21/engine';

const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export function CardView({ card, hidden, index }: { card: Card; hidden?: boolean; index?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const wasHidden = useRef(hidden);

  // Cards fly out of the shoe: measure the run from the shoe's mouth to this
  // card's landing spot, in the card's own (possibly zoomed) coordinate space.
  // No shoe on screen (small windows) falls back to a plain pop-in.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const shoe = document.querySelector('.shoe');
    const s = shoe?.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    if (!s || !s.width || !c.width) {
      el.classList.add('card--pop');
      return;
    }
    const scale = c.width / el.offsetWidth || 1;
    el.style.setProperty('--fly-x', `${((s.left + s.width * 0.16 - c.left) / scale).toFixed(1)}px`);
    el.style.setProperty('--fly-y', `${((s.top + s.height * 0.62 - c.top) / scale).toFixed(1)}px`);
    el.classList.add('card--dealt');
  }, []);

  // The hole card flips over in place — it doesn't get re-dealt.
  useLayoutEffect(() => {
    if (wasHidden.current && !hidden && ref.current) {
      ref.current.classList.remove('card--dealt', 'card--pop');
      ref.current.classList.add('card--reveal');
    }
    wasHidden.current = hidden;
  }, [hidden]);

  const red = card.suit === 'H' || card.suit === 'D';
  return (
    <div
      ref={ref}
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
      {/* the card back shown while the card is in flight from the shoe */}
      <i className="card__glide" aria-hidden="true" />
    </div>
  );
}

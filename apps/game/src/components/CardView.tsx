import { useLayoutEffect, useRef } from 'react';
import type { Card } from '@perfect21/engine';

const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export function CardView({ card, hidden, index }: { card: Card; hidden?: boolean; index?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const wasHidden = useRef(hidden);

  // Cards fly out of the shoe: measure the run from the shoe's mouth to this
  // card's landing spot, in the card's own (possibly zoomed) coordinate space.
  // Keyed on the card itself, because React reuses these elements from round
  // to round — every new card must fly again, not just the first hand's.
  // No shoe on screen (small windows) falls back to a plain pop-in.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove('card--dealt', 'card--pop', 'card--reveal');
    const shoe = document.querySelector('.shoe');
    const s = shoe?.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    if (!s || !s.width || !c.width) {
      void el.offsetWidth;
      el.classList.add('card--pop');
      return;
    }
    const scale = c.width / el.offsetWidth || 1;
    el.style.setProperty('--fly-x', `${((s.left + s.width * 0.16 - c.left) / scale).toFixed(1)}px`);
    el.style.setProperty('--fly-y', `${((s.top + s.height * 0.74 - c.top) / scale).toFixed(1)}px`);
    void el.offsetWidth; // restart the animation on reused elements
    el.classList.add('card--dealt');
  }, [card]);

  // The hole card flips over in place — it doesn't get re-dealt. A fast
  // insurance answer can resolve while the card is still flying out of the
  // shoe (its stagger delay alone runs ~770ms in a 3-seat game), so wait for
  // the flight to land before flipping instead of snapping it to the spot.
  useLayoutEffect(() => {
    const el = wasHidden.current && !hidden ? ref.current : null;
    wasHidden.current = hidden;
    if (!el) return;
    const reveal = () => {
      el.classList.remove('card--dealt', 'card--pop');
      el.classList.add('card--reveal');
    };
    const flight = (el.getAnimations?.() ?? []).filter(
      (a): a is CSSAnimation => a instanceof CSSAnimation && a.animationName === 'deal-fly'
    );
    if (flight.length === 0) {
      reveal();
      return;
    }
    let cancelled = false;
    void Promise.allSettled(flight.map((a) => a.finished)).then(() => {
      if (!cancelled) reveal();
    });
    return () => {
      cancelled = true;
    };
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

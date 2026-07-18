import { useId, useRef, useState } from 'react';

export interface LiveStatsData {
  /** Net gain, in the caller's unit (chips in game, units in the sim). */
  net: number;
  wins: number;
  losses: number;
  played: number;
  /** Cumulative net after each settled round; starts at [0]. */
  series: number[];
}

/** 13.2K / 1.05M style abbreviation for whole counts (wins, losses, played). */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(2)}K`;
  return n.toLocaleString('en-US');
}

/**
 * Signed money/units: a leading minus only when negative (never a plus), and
 * K/M abbreviation so a Turbo run's millions still fit the fixed-width panel.
 */
function money(n: number): string {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `${sign}${(a / 1000).toFixed(2)}K`;
  if (a >= 1000) return `${sign}${a.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return `${sign}${a.toFixed(a % 1 === 0 ? 0 : 2)}`;
}

function Coin() {
  return (
    <svg className="ls-coin" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="#e8bf5a" stroke="#c79a34" strokeWidth="1.2" />
      <path
        d="M10 4.4l1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3L5.2 7.9l3.3-.5z"
        fill="#8a6a1a"
      />
    </svg>
  );
}

/** Area chart split at the zero line: green above, red below (stake/shuffle style). */
function LiveChart({ series }: { series: number[] }) {
  const uid = useId();
  const net = series[series.length - 1] ?? 0;
  const W = 320;
  const H = 150;
  const P = 6;
  const lo = Math.min(0, ...series);
  const hi = Math.max(0, ...series);
  const span = hi - lo || 1;
  const x = (i: number) => (series.length < 2 ? W : P + (i / (series.length - 1)) * (W - 2 * P));
  const y = (v: number) => P + (1 - (v - lo) / span) * (H - 2 * P);
  const z = y(0);
  const line = series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(series.length - 1).toFixed(1)} ${z.toFixed(1)} L ${x(0).toFixed(1)} ${z.toFixed(1)} Z`;

  return (
    <div className="ls-chart-wrap">
      <div className={`ls-chart-net ${net >= 0 ? 'ls-pos' : 'ls-neg'}`}>
        <Coin />
        {money(net)}
      </div>
      <svg className="ls-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <clipPath id={`${uid}-up`}>
            <rect x="0" y="0" width={W} height={Math.max(0, z)} />
          </clipPath>
          <clipPath id={`${uid}-dn`}>
            <rect x="0" y={z} width={W} height={Math.max(0, H - z)} />
          </clipPath>
        </defs>
        {series.length >= 2 && (
          <>
            <g clipPath={`url(#${uid}-up)`}>
              <path className="ls-area ls-area--up" d={area} />
              <path className="ls-line ls-line--up" d={line} />
            </g>
            <g clipPath={`url(#${uid}-dn)`}>
              <path className="ls-area ls-area--dn" d={area} />
              <path className="ls-line ls-line--dn" d={line} />
            </g>
          </>
        )}
        <line className="ls-zero" x1="0" x2={W} y1={z} y2={z} />
      </svg>
    </div>
  );
}

/** The panel body — identical in-game and in the simulator. */
export function LiveStats({ data }: { data: LiveStatsData }) {
  return (
    <div className="ls-body">
      <div className="ls-card ls-grid">
        <div className="ls-cell">
          <span className="ls-label">Net gain</span>
          <span className={`ls-value ${data.net >= 0 ? 'ls-pos' : 'ls-neg'}`}>
            <Coin />
            {money(data.net)}
          </span>
        </div>
        <div className="ls-cell">
          <span className="ls-label">Wins</span>
          <span className="ls-value ls-pos">{compact(data.wins)}</span>
        </div>
        <div className="ls-cell">
          <span className="ls-label">Played</span>
          <span className="ls-value">
            <Coin />
            {compact(data.played)}
          </span>
        </div>
        <div className="ls-cell">
          <span className="ls-label">Losses</span>
          <span className="ls-value ls-neg">{compact(data.losses)}</span>
        </div>
      </div>

      <div className="ls-card">
        <LiveChart series={data.series} />
      </div>
    </div>
  );
}

function LsIcons({ onRefresh, onClose }: { onRefresh?: () => void; onClose?: () => void }) {
  return (
    <div className="ls-icons">
      {onRefresh && (
        <button className="ls-icon" onClick={onRefresh} title="Reset live stats" aria-label="Reset">
          <svg viewBox="0 0 20 20">
            <path
              d="M15.5 6.5A6 6 0 1 0 16 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <path d="M15.8 3.5v3.2h-3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {onClose && (
        <button className="ls-icon" onClick={onClose} title="Close" aria-label="Close">
          <svg viewBox="0 0 20 20">
            <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

function LsHeader({
  onRefresh,
  onClose,
  onPointerDown,
  draggable,
}: {
  onRefresh?: () => void;
  onClose?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  draggable?: boolean;
}) {
  return (
    <div
      className={`ls-head ${draggable ? 'ls-head--drag' : ''}`}
      onPointerDown={onPointerDown}
    >
      <span className="ls-title">
        <svg className="ls-title-icon" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2.5" y="2.5" width="15" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 13v-2M10 13V7M14 13v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        Live Stats
      </span>
      <LsIcons onRefresh={onRefresh} onClose={onClose} />
    </div>
  );
}

/** Static panel for the simulator (mandatory, non-movable). */
export function LiveStatsPanel({
  data,
  onRefresh,
}: {
  data: LiveStatsData;
  onRefresh?: () => void;
}) {
  return (
    <div className="ls-panel ls-panel--static">
      <LsHeader onRefresh={onRefresh} />
      <LiveStats data={data} />
    </div>
  );
}

/** Draggable, closable modal for the table (optional, default bottom-right). */
export function LiveStatsModal({
  data,
  onClose,
  onRefresh,
}: {
  data: LiveStatsData;
  onClose: () => void;
  onRefresh?: () => void;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const w = panelRef.current?.offsetWidth ?? 300;
    const h = panelRef.current?.offsetHeight ?? 400;
    const x = Math.min(Math.max(0, e.clientX - drag.current.dx), window.innerWidth - w);
    const y = Math.min(Math.max(0, e.clientY - drag.current.dy), window.innerHeight - h);
    setPos({ x, y });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const style = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined;

  return (
    <div
      ref={panelRef}
      className="ls-panel ls-panel--modal"
      style={style}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <LsHeader onRefresh={onRefresh} onClose={onClose} onPointerDown={onPointerDown} draggable />
      <LiveStats data={data} />
    </div>
  );
}

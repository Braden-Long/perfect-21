import { useEffect, useRef, useState } from 'react';
import { Shoe } from '@perfect21/engine';
import type { Profile } from '../profile';
import { useStrategy } from './StatsScreen';
import { emptyBatch, simulateBatch, sweepLevel } from '../sim';
import type { SimBatch, SweepPoint } from '../sim';
import { LiveStatsPanel } from './LiveStats';

const SPEEDS = [
  { label: 'Slow', tick: 3 },
  { label: 'Fast', tick: 120 },
  { label: 'Turbo', tick: 4000 },
];
const SWEEP_LEVELS = [1, 0.98, 0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5];
const SWEEP_HANDS = 20000;
const SERIES_CAP = 200;

function SweepChart({ points, theoretical }: { points: SweepPoint[]; theoretical: number }) {
  const rtps = points.flatMap((p) => [p.actualRTP, p.expectedRTP]).concat(theoretical, 1);
  const lo = Math.min(...rtps);
  const hi = Math.max(...rtps);
  const span = hi - lo || 1;
  const h = (v: number) => `${((v - lo) / span) * 100}%`;
  return (
    <div className="sweep">
      {points.map((p) => (
        <div className="sweep__col" key={p.skill} title={`${(p.skill * 100).toFixed(0)}% adherence`}>
          <div className="sweep__bars">
            <div
              className={`sweep__bar sweep__bar--${p.actualRTP >= 1 ? 'up' : 'down'}`}
              style={{ height: h(p.actualRTP) }}
            />
            <div className="sweep__bar sweep__bar--exp" style={{ height: h(p.expectedRTP) }} />
          </div>
          <span className="sweep__val">{(p.expectedRTP * 100).toFixed(1)}</span>
          <span className="sweep__skill">{(p.skill * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

export function SimScreen({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const strategy = useStrategy(profile.rules);
  const theoretical = strategy ? strategy.theoreticalRTP() : null;

  const [skill, setSkill] = useState(1);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<SimBatch | null>(null);
  const [series, setSeries] = useState<number[]>([0]);
  const [sweep, setSweep] = useState<SweepPoint[] | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const shoeRef = useRef<Shoe | null>(null);
  const accRef = useRef<SimBatch | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paintRef = useRef(0);
  const skillRef = useRef(skill);
  const speedRef = useRef(speedIdx);
  skillRef.current = skill;
  speedRef.current = speedIdx;

  // Timer-based pump (not rAF, which freezes in a backgrounded tab): each tick
  // plays a batch, yields to the event loop so the UI stays live, and repaints
  // the stats ~25×/sec. Reads skill/speed from refs so the controls steer a
  // running simulation without restarting it.
  useEffect(() => {
    if (!running || !strategy) return;
    if (!shoeRef.current) shoeRef.current = new Shoe(profile.rules.decks);
    if (!accRef.current) accRef.current = emptyBatch();
    let live = true;
    const pump = () => {
      if (!live) return;
      const acc = accRef.current!;
      simulateBatch(strategy, shoeRef.current!, SPEEDS[speedRef.current].tick, skillRef.current, acc);
      const now = performance.now();
      if (now - paintRef.current > 40) {
        paintRef.current = now;
        setStats({ ...acc });
        setSeries((s) => {
          const next = s.length >= SERIES_CAP ? s.slice(s.length - SERIES_CAP + 1) : s.slice();
          next.push(acc.net);
          return next;
        });
      }
      timerRef.current = setTimeout(pump, 0);
    };
    pump();
    return () => {
      live = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [running, strategy, profile.rules.decks]);

  const reset = () => {
    setRunning(false);
    shoeRef.current = null;
    accRef.current = null;
    setStats(null);
    setSeries([0]);
  };

  const runSweep = () => {
    if (!strategy || theoretical === null) return;
    setSweeping(true);
    setSweep([]);
    const out: SweepPoint[] = [];
    let i = 0;
    const step = () => {
      if (i >= SWEEP_LEVELS.length) {
        setSweeping(false);
        return;
      }
      const shoe = new Shoe(profile.rules.decks);
      out.push(sweepLevel(strategy, shoe, SWEEP_HANDS, SWEEP_LEVELS[i], theoretical));
      setSweep([...out]);
      i++;
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  };

  const actualRTP = stats && stats.wagered > 0 ? 1 + stats.net / stats.wagered : null;
  const expectedRTP =
    stats && stats.wagered > 0 && theoretical !== null
      ? theoretical - stats.evLoss / stats.wagered
      : null;
  const adherence = stats && stats.decisions > 0 ? stats.matched / stats.decisions : null;

  const r = profile.rules;
  const rulesChip = `${r.decks}D · ${r.soft17.toUpperCase()} · ${r.das ? 'DAS' : 'NO DAS'} · ${
    r.surrender === 'none' ? 'NO SURR' : r.surrender === 'late' ? 'LS' : 'ES'
  } · ${r.peek ? 'PEEK' : 'ENHC'}`;

  return (
    <div className="room room--menu">
      <div className="menu menu--wide">
        <h2 className="screen-title">Strategy simulator</h2>
        <p className="stat__hint">
          Virtual players hit thousands of hands under your table rules ({rulesChip}) with no
          animation. Drop discipline below 100% and watch the return bleed out — this is pure
          math on how much basic strategy is worth. Nothing here touches your stats. (Below
          100%, a slip plays a random legal move — which lands on the right play often enough
          that realized adherence always reads a bit higher than the discipline you set.)
        </p>

        <div className="sim-layout">
          <div className="sim-left">
            <div className="sim-controls">
              <label className="sim-slider">
                <span>
                  Discipline — how often the player follows the book{' '}
                  <b>{(skill * 100).toFixed(0)}%</b>
                </span>
                <input
                  type="range"
                  min={50}
                  max={100}
                  step={1}
                  value={skill * 100}
                  onChange={(e) => setSkill(Number(e.target.value) / 100)}
                />
              </label>
              <div className="sim-speed">
                {SPEEDS.map((s, i) => (
                  <button
                    key={s.label}
                    className={`stat-tab ${speedIdx === i ? 'stat-tab--on' : ''}`}
                    onClick={() => setSpeedIdx(i)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="sim-buttons">
              <button
                className="btn btn--deal"
                disabled={!strategy}
                onClick={() => setRunning((v) => !v)}
              >
                {!strategy ? 'Building strategy…' : running ? 'Pause' : stats ? 'Resume' : 'Run'}
              </button>
              <button
                className="btn btn--ghost"
                onClick={reset}
                disabled={!stats && series.length <= 1}
              >
                Reset
              </button>
            </div>

            <div className="stat-grid sim-grid">
              <Stat
                label="Actual RTP"
                value={actualRTP !== null ? `${(actualRTP * 100).toFixed(2)}%` : '—'}
                hint="what the cards paid"
              />
              <Stat
                label="Expected RTP"
                value={expectedRTP !== null ? `${(expectedRTP * 100).toFixed(2)}%` : '—'}
                hint="theory minus EV lost to misplays"
              />
              <Stat
                label="Theoretical RTP"
                value={theoretical !== null ? `${(theoretical * 100).toFixed(2)}%` : '…'}
                hint="perfect play, these rules"
              />
              <Stat
                label="Realized adherence"
                value={adherence !== null ? `${(adherence * 100).toFixed(1)}%` : '—'}
                hint="decisions that matched the book"
              />
            </div>
          </div>

          <div className="sim-right">
            <LiveStatsPanel
              data={{
                net: stats?.net ?? 0,
                wins: stats?.wins ?? 0,
                losses: stats?.losses ?? 0,
                played: stats?.hands ?? 0,
                series,
              }}
              onRefresh={reset}
            />
          </div>
        </div>

        <h3 className="screen-subtitle">
          Skill sweep <i>{SWEEP_HANDS.toLocaleString('en-US')} hands per level</i>
        </h3>
        <p className="stat__hint">
          Runs the same rules at every discipline level and plots the return — the price of each
          point of sloppiness, in one picture. Gold bars are expected RTP; the colored bar is
          what the cards actually paid (red under 100%, green if the game turned a profit).
        </p>
        <div className="sim-buttons">
          <button className="btn btn--ghost" disabled={!strategy || sweeping} onClick={runSweep}>
            {sweeping ? 'Sweeping…' : 'Run skill sweep'}
          </button>
        </div>
        {sweep && sweep.length > 0 && theoretical !== null && (
          <SweepChart points={sweep} theoretical={theoretical} />
        )}

        <button className="btn btn--ghost" onClick={onBack}>
          ‹ Back
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
      {hint && <div className="stat__hint">{hint}</div>}
    </div>
  );
}

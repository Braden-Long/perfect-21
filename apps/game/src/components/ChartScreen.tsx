import { blackjackinfoUrl } from '@perfect21/engine';
import type { ChartCell, Strategy } from '@perfect21/engine';
import type { Profile } from '../profile';
import { useStrategy } from './StatsScreen';

const UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];
const UP_LABEL: Record<number, string> = { 1: 'A', 10: 'T' };

function code(cell: ChartCell): string {
  switch (cell.best) {
    case 'hit':
      return 'H';
    case 'stand':
      return 'S';
    case 'split':
      return 'P';
    case 'double':
      return cell.fallback === 'stand' ? 'Ds' : 'D';
    case 'surrender':
      return cell.fallback === 'stand' ? 'Rs' : 'Rh';
  }
}

function Row({ strategy, label, prefix }: { strategy: Strategy; label: string; prefix: string }) {
  return (
    <tr>
      <th>{label}</th>
      {UPS.map((up) => {
        const cell = strategy.getCell(`${prefix}-${up}`);
        const c = cell ? code(cell) : '·';
        return (
          <td key={up} className={`cc cc--${c[0].toLowerCase()}`}>
            {c}
          </td>
        );
      })}
    </tr>
  );
}

function Header() {
  return (
    <tr>
      <th />
      {UPS.map((up) => (
        <th key={up}>{UP_LABEL[up] ?? up}</th>
      ))}
    </tr>
  );
}

export function ChartScreen({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const strategy = useStrategy(profile.rules);

  if (!strategy) {
    return (
      <div className="room room--menu">
        <div className="loading">
          <div className="loading__sub">Deriving strategy chart…</div>
        </div>
      </div>
    );
  }

  const pairLabel: Record<number, string> = { 1: 'A,A', 10: 'T,T' };

  return (
    <div className="room room--menu room--chart">
      <div className="menu menu--wide">
        <h2 className="screen-title">Basic strategy — your table rules</h2>
        <p className="rules-note">
          Derived by expected value for {profile.rules.decks} decks · verify against the{' '}
          <a href={blackjackinfoUrl(profile.rules)} target="_blank" rel="noreferrer">
            source engine
          </a>
        </p>
        <div className="charts">
          <table className="chart">
            <caption>Hard totals</caption>
            <tbody>
              <Header />
              <Row strategy={strategy} label="5–8" prefix="h8" />
              {[9, 10, 11, 12, 13, 14, 15, 16].map((t) => (
                <Row key={t} strategy={strategy} label={String(t)} prefix={`h${t}`} />
              ))}
              <Row strategy={strategy} label="17+" prefix="h17" />
            </tbody>
          </table>
          <table className="chart">
            <caption>Soft totals</caption>
            <tbody>
              <Header />
              {[13, 14, 15, 16, 17, 18, 19, 20].map((t) => (
                <Row key={t} strategy={strategy} label={`A,${t - 11}`} prefix={`s${t}`} />
              ))}
            </tbody>
          </table>
          <table className="chart">
            <caption>Pairs</caption>
            <tbody>
              <Header />
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => (
                <Row key={r} strategy={strategy} label={pairLabel[r] ?? `${r},${r}`} prefix={`p${r}`} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="chart-legend">
          <span className="cc cc--h">H hit</span>
          <span className="cc cc--s">S stand</span>
          <span className="cc cc--d">D double (Ds: else stand)</span>
          <span className="cc cc--p">P split</span>
          <span className="cc cc--r">R surrender</span>
        </div>
        <button className="btn btn--ghost" onClick={onBack}>
          ‹ Back
        </button>
      </div>
    </div>
  );
}

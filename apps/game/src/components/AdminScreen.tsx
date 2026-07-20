import { useCallback, useEffect, useRef, useState } from 'react';
import { adminRequest } from '../api';

interface Overview {
  players: number;
  banned: number;
  activeToday: number;
  decisions: number;
  accuracy: number | null;
  rounds: number;
  net: number;
}

interface AdminPlayer {
  id: string;
  name: string;
  tier: { name: string; color: string } | null;
  rollingAccuracy: number;
  decisions: number;
  bestStreak: number;
  rounds: number;
  banned: boolean;
  rulesKey: string;
  createdAt: number;
  updatedAt: number;
  email: string | null;
  net: number;
  countingTier: { name: string; color: string } | null;
  countingDecisions: number;
}

const TOKEN_KEY = 'perfect21.adminToken';

function shortDate(t: number): string {
  return new Date(t).toLocaleDateString();
}

export function AdminScreen({ onBack }: { onBack: () => void }) {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '');
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [filter, setFilter] = useState('');
  // Two-step delete: first click arms this id, second click fires. No native
  // confirm() — it's the only browser dialog in the app and it blocks testing.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armConfirm = (id: string) => {
    setConfirmId(id);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmId(null), 4000);
  };
  useEffect(() => () => void (confirmTimer.current && clearTimeout(confirmTimer.current)), []);

  const refresh = useCallback(async (tok: string) => {
    setError(null);
    const [ov, pl] = await Promise.all([
      adminRequest<Overview>(tok, '/api/admin/overview'),
      adminRequest<{ players: AdminPlayer[] }>(tok, '/api/admin/players'),
    ]);
    if (!ov || !pl) {
      setError('Server unreachable.');
      setAuthed(false);
      return;
    }
    if (ov.status !== 200) {
      setError(ov.status === 401 ? 'Bad admin token.' : `Error ${ov.status}`);
      setAuthed(false);
      return;
    }
    setOverview(ov.body);
    setPlayers(pl.body.players);
    setAuthed(true);
    sessionStorage.setItem(TOKEN_KEY, tok);
  }, []);

  useEffect(() => {
    if (token) void refresh(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Run an admin mutation; surface failures instead of swallowing them. */
  const act = async (label: string, path: string, init: RequestInit) => {
    setActionError(null);
    setConfirmId(null);
    const res = await adminRequest(token, path, init);
    if (!res) {
      setActionError(`${label} failed: server unreachable.`);
      return;
    }
    if (res.status === 401) {
      // Token revoked mid-session (e.g. server restarted with a new one).
      sessionStorage.removeItem(TOKEN_KEY);
      setAuthed(false);
      setError('Bad admin token.');
      return;
    }
    if (res.status !== 200) {
      setActionError(`${label} failed: error ${res.status}.`);
      return;
    }
    void refresh(token);
  };

  const ban = (p: AdminPlayer) =>
    act(p.banned ? 'Unban' : 'Ban', `/api/admin/players/${p.id}/ban`, {
      method: 'POST',
      body: JSON.stringify({ banned: !p.banned }),
    });

  const remove = (p: AdminPlayer) =>
    act('Delete', `/api/admin/players/${p.id}`, { method: 'DELETE' });

  if (!authed) {
    return (
      <div className="room room--menu">
        <div className="menu">
          <h2 className="screen-title">Admin</h2>
          <p className="rules-note">
            Enter the server&rsquo;s <code>ADMIN_TOKEN</code>. (Set it as an environment variable
            when starting the server.)
          </p>
          <div className="join__row">
            <input
              className="join__input"
              type="password"
              placeholder="Admin token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && refresh(token)}
            />
            <button className="btn btn--deal" disabled={!token} onClick={() => refresh(token)}>
              Unlock
            </button>
          </div>
          {error && <p className="join__error">{error}</p>}
          <button className="btn btn--ghost" onClick={onBack}>
            ‹ Back
          </button>
        </div>
      </div>
    );
  }

  const q = filter.trim().toLowerCase();
  const shown = q
    ? players.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q)
      )
    : players;

  return (
    <div className="room room--menu">
      <div className="menu menu--wide">
        <h2 className="screen-title">Admin panel</h2>

        {overview && (
          <div className="stat-grid">
            <div className="stat">
              <div className="stat__value">{overview.players}</div>
              <div className="stat__label">Players</div>
              <div className="stat__hint">{overview.banned} banned</div>
            </div>
            <div className="stat">
              <div className="stat__value">{overview.activeToday}</div>
              <div className="stat__label">Active today</div>
            </div>
            <div className="stat">
              <div className="stat__value">{overview.decisions.toLocaleString()}</div>
              <div className="stat__label">Decisions graded</div>
            </div>
            <div className="stat">
              <div className="stat__value">
                {overview.accuracy === null ? '—' : `${(overview.accuracy * 100).toFixed(1)}%`}
              </div>
              <div className="stat__label">Community accuracy</div>
            </div>
            <div className="stat">
              <div className="stat__value">{overview.rounds.toLocaleString()}</div>
              <div className="stat__label">Hands dealt</div>
            </div>
            <div className="stat">
              <div className={`stat__value ${overview.net >= 0 ? 'stat--up' : 'stat--down'}`}>
                {overview.net >= 0 ? '' : '−'}
                {Math.abs(overview.net).toFixed(1)}
              </div>
              <div className="stat__label">Community net</div>
              <div className="stat__hint">units, all tables</div>
            </div>
          </div>
        )}

        <div className="admin-toolbar">
          <input
            className="join__input admin-filter"
            type="search"
            placeholder="Filter by name or email…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="btn btn--ghost" onClick={() => refresh(token)}>
            Refresh
          </button>
          <button
            className="btn btn--ghost"
            onClick={() => {
              sessionStorage.removeItem(TOKEN_KEY);
              setAuthed(false);
              setToken('');
            }}
          >
            Lock
          </button>
        </div>

        {actionError && <p className="join__error">{actionError}</p>}

        <div className="board-scroll">
          <table className="board board--admin">
            <thead>
              <tr>
                <th className="board__name">Player</th>
                <th>Rank</th>
                <th>Rolling</th>
                <th>Decisions</th>
                <th>Counting</th>
                <th>Streak</th>
                <th>Net</th>
                <th>Rules</th>
                <th>Seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className={p.banned ? 'board__banned' : ''}>
                  <td className="board__name">
                    {p.name}
                    {p.email && <div className="board__email">{p.email}</div>}
                  </td>
                  <td>{p.tier?.name ?? '—'}</td>
                  <td>{(p.rollingAccuracy * 100).toFixed(1)}%</td>
                  <td>{p.decisions}</td>
                  <td>
                    {p.countingDecisions > 0
                      ? `${p.countingTier?.name ?? 'Unranked'} · ${p.countingDecisions}`
                      : '—'}
                  </td>
                  <td>{p.bestStreak}</td>
                  <td className={p.net >= 0 ? 'stat--up' : 'stat--down'}>
                    {p.net >= 0 ? '' : '−'}
                    {Math.abs(p.net).toFixed(1)}
                  </td>
                  <td className="board__rules">{p.rulesKey || '—'}</td>
                  <td title={`joined ${shortDate(p.createdAt)}`}>{shortDate(p.updatedAt)}</td>
                  <td className="board__actions">
                    <button className="btn btn--ghost" onClick={() => ban(p)}>
                      {p.banned ? 'Unban' : 'Ban'}
                    </button>
                    {confirmId === p.id ? (
                      <button className="btn btn--ghost btn--danger" onClick={() => remove(p)}>
                        Confirm?
                      </button>
                    ) : (
                      <button
                        className="btn btn--ghost btn--danger"
                        onClick={() => armConfirm(p.id)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={10} className="board__rules">
                    {players.length === 0 ? 'No players yet.' : 'No players match the filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <button className="btn btn--ghost" onClick={onBack}>
          ‹ Back
        </button>
      </div>
    </div>
  );
}

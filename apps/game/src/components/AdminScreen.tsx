import { useCallback, useEffect, useState } from 'react';
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
  updatedAt: number;
}

const TOKEN_KEY = 'perfect21.adminToken';

export function AdminScreen({ onBack }: { onBack: () => void }) {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '');
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [players, setPlayers] = useState<AdminPlayer[]>([]);

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

  const ban = async (p: AdminPlayer) => {
    await adminRequest(token, `/api/admin/players/${p.id}/ban`, {
      method: 'POST',
      body: JSON.stringify({ banned: !p.banned }),
    });
    void refresh(token);
  };

  const remove = async (p: AdminPlayer) => {
    if (!window.confirm(`Permanently delete "${p.name}" from the leaderboard?`)) return;
    await adminRequest(token, `/api/admin/players/${p.id}`, { method: 'DELETE' });
    void refresh(token);
  };

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
          </div>
        )}

        <div className="admin-toolbar">
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

        <table className="board board--admin">
          <thead>
            <tr>
              <th className="board__name">Player</th>
              <th>Rank</th>
              <th>Rolling</th>
              <th>Decisions</th>
              <th>Streak</th>
              <th>Rules</th>
              <th>Last seen</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id} className={p.banned ? 'board__banned' : ''}>
                <td className="board__name">{p.name}</td>
                <td>{p.tier?.name ?? '—'}</td>
                <td>{(p.rollingAccuracy * 100).toFixed(1)}%</td>
                <td>{p.decisions}</td>
                <td>{p.bestStreak}</td>
                <td className="board__rules">{p.rulesKey || '—'}</td>
                <td>{new Date(p.updatedAt).toLocaleDateString()}</td>
                <td className="board__actions">
                  <button className="btn btn--ghost" onClick={() => ban(p)}>
                    {p.banned ? 'Unban' : 'Ban'}
                  </button>
                  <button className="btn btn--ghost btn--danger" onClick={() => remove(p)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button className="btn btn--ghost" onClick={onBack}>
          ‹ Back
        </button>
      </div>
    </div>
  );
}

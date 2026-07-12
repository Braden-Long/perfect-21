import { useEffect, useState } from 'react';
import type { Leaderboard } from '../api';
import { apiAvailable, fetchLeaderboard, joinLeaderboard, syncStats } from '../api';
import type { Profile } from '../profile';
import { saveProfile } from '../profile';

function TierBadge({ tier }: { tier: { name: string; color: string } | null }) {
  if (!tier) return <span className="board-tier board-tier--none">—</span>;
  return (
    <span className="board-tier" style={{ ['--rank-color' as string]: tier.color }}>
      {tier.name}
    </span>
  );
}

function JoinForm({ profile, onJoined }: { profile: Profile; onJoined: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    const res = await joinLeaderboard(name);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    profile.player = { id: res.id, secret: res.secret, name: res.name };
    saveProfile(profile);
    await syncStats(profile);
    onJoined();
  };

  return (
    <div className="join">
      <p className="rules-note">
        Claim a name to appear on the global board. Your stats sync automatically as you play —
        no account, no email, the credential lives in this browser.
      </p>
      <div className="join__row">
        <input
          className="join__input"
          placeholder="Display name (3–20 chars)"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && join()}
        />
        <button className="btn btn--deal" disabled={busy || name.trim().length < 3} onClick={join}>
          {busy ? 'Joining…' : 'Join'}
        </button>
      </div>
      {error && <p className="join__error">{error}</p>}
    </div>
  );
}

export function LeaderboardScreen({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [joinedTick, setJoinedTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    fetchLeaderboard().then((b) => {
      if (cancelled) return;
      setBoard(b);
      setState(b ? 'ready' : 'offline');
    });
    return () => {
      cancelled = true;
    };
  }, [joinedTick]);

  return (
    <div className="room room--menu">
      <div className="menu menu--wide">
        <h2 className="screen-title">Global leaderboard</h2>

        {state === 'loading' && <p className="rules-note">Loading…</p>}

        {state === 'offline' && (
          <p className="rules-note">
            {apiAvailable()
              ? 'The leaderboard server is unreachable right now. Solo play works fine — your stats are kept locally and will sync when the server is back.'
              : 'Leaderboards need the hosted version of Perfect 21 — this build is running without a server.'}
          </p>
        )}

        {state === 'ready' && board && (
          <>
            {!profile.player && <JoinForm profile={profile} onJoined={() => setJoinedTick((t) => t + 1)} />}
            {profile.player && (
              <p className="rules-note">
                Playing as <b>{profile.player.name}</b> — stats sync automatically after each hand.
              </p>
            )}

            {board.players.length === 0 ? (
              <p className="rules-note">
                Nobody has ranked yet ({board.minDecisions}+ graded decisions needed). Be the first.
              </p>
            ) : (
              <table className="board">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="board__name">Player</th>
                    <th>Rank</th>
                    <th>Rolling</th>
                    <th>Decisions</th>
                    <th>Best streak</th>
                  </tr>
                </thead>
                <tbody>
                  {board.players.map((p, i) => (
                    <tr key={p.name} className={p.name === profile.player?.name ? 'board__me' : ''}>
                      <td>{i + 1}</td>
                      <td className="board__name">{p.name}</td>
                      <td>
                        <TierBadge tier={p.tier} />
                      </td>
                      <td>{(p.rollingAccuracy * 100).toFixed(1)}%</td>
                      <td>{p.decisions}</td>
                      <td>{p.bestStreak}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {board.streaks.length > 0 && (
              <>
                <h3 className="board-subtitle">Endless streaks</h3>
                <table className="board board--narrow">
                  <tbody>
                    {board.streaks.map((s, i) => (
                      <tr key={s.name} className={s.name === profile.player?.name ? 'board__me' : ''}>
                        <td>{i + 1}</td>
                        <td className="board__name">{s.name}</td>
                        <td>
                          <b>{s.bestStreak}</b> in a row
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}

        <button className="btn btn--ghost" onClick={onBack}>
          ‹ Back
        </button>
      </div>
    </div>
  );
}

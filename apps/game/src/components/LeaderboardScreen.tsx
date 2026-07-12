import { useEffect, useState } from 'react';
import type { Leaderboard } from '../api';
import {
  apiAvailable,
  attachEmail,
  fetchLeaderboard,
  joinLeaderboard,
  recoverAccount,
  requestEmailRecovery,
  serverFeatures,
  syncStats,
} from '../api';
import type { Profile } from '../profile';
import { recoveryCode, saveProfile } from '../profile';

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
        Claim a name to appear on the global board — no signup, you're playing in seconds. Your
        stats sync automatically, and you can attach an email afterwards so your progress
        survives anything.
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

/** Attach/change the recovery email — the optional "account". */
function AccountSection({ profile, emailEnabled }: { profile: Profile; emailEnabled: boolean }) {
  const [email, setEmail] = useState(profile.recoveryEmail ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const res = await attachEmail(profile, email.trim().toLowerCase());
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    profile.recoveryEmail = res.email ?? undefined;
    saveProfile(profile);
    setMsg({
      ok: true,
      text: 'Saved. If you ever lose this browser, recover everything with a link to that email.',
    });
  };

  if (!profile.player) return null;
  return (
    <div className="join">
      <p className="rules-note">
        Playing as <b>{profile.player.name}</b> — stats sync automatically after each hand.
      </p>
      {emailEnabled && (
        <>
          <div className="join__row">
            <input
              className="join__input"
              type="email"
              placeholder="Email for account recovery (optional)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && save()}
            />
            <button
              className="btn btn--deal"
              disabled={busy || !email.includes('@')}
              onClick={save}
            >
              {busy ? 'Saving…' : profile.recoveryEmail ? 'Update' : 'Save'}
            </button>
          </div>
          {msg && <p className={msg.ok ? 'rules-note' : 'join__error'}>{msg.text}</p>}
          {!profile.recoveryEmail && !msg && (
            <p className="rules-note">
              Add an email and clearing this browser can't erase your progress — recovery is a
              magic link, no password to remember.
            </p>
          )}
        </>
      )}
      <details className="recovery-details">
        <summary>Advanced: offline recovery code</summary>
        <p className="rules-note">
          This code restores your account on any device even without email. Treat it like a
          password:
        </p>
        <div className="join__row">
          <code className="recovery-code">{recoveryCode(profile.player)}</code>
          <button
            className="btn btn--ghost"
            onClick={() => void navigator.clipboard?.writeText(recoveryCode(profile.player!))}
          >
            Copy
          </button>
        </div>
      </details>
    </div>
  );
}

/** Recovery entry points for a fresh browser: email link or pasted code. */
function RestoreSection({ emailEnabled }: { emailEnabled: boolean }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sendLink = async () => {
    setBusy(true);
    setMsg(null);
    const res = await requestEmailRecovery(email.trim());
    setBusy(false);
    setMsg(
      res.ok
        ? {
            ok: true,
            text: 'If that address is linked to a player, a recovery link is on its way. It works once, for 15 minutes.',
          }
        : { ok: false, text: res.error }
    );
  };

  const useCode = async () => {
    setBusy(true);
    setMsg(null);
    const res = await recoverAccount(code);
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    // Everything is written to localStorage; reload so all screens pick it up.
    location.hash = '';
    location.reload();
  };

  return (
    <details className="recovery-details">
      <summary>Played before? Restore your progress</summary>
      {emailEnabled && (
        <div className="join__row">
          <input
            className="join__input"
            type="email"
            placeholder="Your recovery email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && sendLink()}
          />
          <button className="btn btn--deal" disabled={busy || !email.includes('@')} onClick={sendLink}>
            Email me a link
          </button>
        </div>
      )}
      <div className="join__row">
        <input
          className="join__input"
          placeholder="…or paste a recovery code (p21.…)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && useCode()}
        />
        <button className="btn btn--ghost" disabled={busy || !code.trim()} onClick={useCode}>
          Restore
        </button>
      </div>
      {msg && <p className={msg.ok ? 'rules-note' : 'join__error'}>{msg.text}</p>}
    </details>
  );
}

export function LeaderboardScreen({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [joinedTick, setJoinedTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    Promise.all([fetchLeaderboard(), serverFeatures()]).then(([b, features]) => {
      if (cancelled) return;
      setBoard(b);
      setEmailEnabled(features?.email === true);
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
            {!profile.player && (
              <>
                <JoinForm profile={profile} onJoined={() => setJoinedTick((t) => t + 1)} />
                <RestoreSection emailEnabled={emailEnabled} />
              </>
            )}
            {profile.player && <AccountSection profile={profile} emailEnabled={emailEnabled} />}

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

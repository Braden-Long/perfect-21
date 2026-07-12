import { useEffect, useState } from 'react';
import { claimRecovery } from '../api';

/** Landing screen for magic recovery links (…/#recover=<token>). */
export function RecoverScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [state, setState] = useState<
    { s: 'working' } | { s: 'done'; name: string } | { s: 'failed'; error: string }
  >({ s: 'working' });

  useEffect(() => {
    let cancelled = false;
    claimRecovery(token).then((res) => {
      if (cancelled) return;
      setState(
        res.ok ? { s: 'done', name: res.profile.player!.name } : { s: 'failed', error: res.error }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="room room--menu">
      <div className="menu">
        <h2 className="screen-title">Restore progress</h2>
        {state.s === 'working' && <p className="rules-note">Checking your recovery link…</p>}
        {state.s === 'done' && (
          <>
            <p className="rules-note">
              Welcome back, <b>{state.name}</b>. Your rank, bankroll, stats and mistake history
              are restored on this device.
            </p>
            <button className="btn btn--deal" onClick={onDone}>
              Start playing
            </button>
          </>
        )}
        {state.s === 'failed' && (
          <>
            <p className="join__error">{state.error}</p>
            <p className="rules-note">
              Links work once and expire after 15 minutes — request a fresh one from the
              leaderboard screen.
            </p>
            <button className="btn btn--ghost" onClick={onDone}>
              ‹ Back to menu
            </button>
          </>
        )}
      </div>
    </div>
  );
}

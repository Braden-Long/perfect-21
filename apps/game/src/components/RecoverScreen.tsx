import { useState } from 'react';
import { claimRecovery } from '../api';

/**
 * Landing screen for magic recovery links (…/#recover=<token>).
 *
 * The token is single-use, so it must NOT be claimed on page load: corporate
 * mail scanners prefetch links (some execute the page) and would burn the
 * token before the player ever saw it. Claiming waits for a real click.
 */
export function RecoverScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [state, setState] = useState<
    { s: 'ready' } | { s: 'working' } | { s: 'done'; name: string } | { s: 'failed'; error: string }
  >({ s: 'ready' });

  const claim = () => {
    setState({ s: 'working' });
    void claimRecovery(token).then((res) => {
      setState(
        res.ok ? { s: 'done', name: res.profile.player!.name } : { s: 'failed', error: res.error }
      );
    });
  };

  return (
    <div className="room room--menu">
      <div className="menu">
        <h2 className="screen-title">Restore progress</h2>
        {state.s === 'ready' && (
          <>
            <p className="rules-note">
              This link restores your rank, bankroll, stats and mistake history on this device.
              It works once — continue on the device you want to play on.
            </p>
            <button className="btn btn--deal" onClick={claim}>
              Restore on this device
            </button>
            <button className="btn btn--ghost" onClick={onDone}>
              ‹ Not now
            </button>
          </>
        )}
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

import { useEffect, useState } from 'react';
import { SITE, configuredTips } from '../config';
import { attachWallet, refreshDonations, serverFeatures } from '../api';
import type { Profile } from '../profile';
import { saveProfile } from '../profile';
import { DECK_SKINS, skinClass, skinUnlocked } from '../skins';

/** One mini card-back pair: the base deck and its scene--reddeck opposite. */
function SkinPair({ id }: { id: string }) {
  const cls = skinClass(id);
  return (
    <span className="skin-card__pair">
      <span className={`skin-swatch ${cls}`}>
        <i className="card__back" />
      </span>
      <span className={`skin-swatch scene--reddeck ${cls}`}>
        <i className="card__back" />
      </span>
    </span>
  );
}

function SkinPicker({
  profile,
  onProfileChange,
}: {
  profile: Profile;
  onProfileChange: () => void;
}) {
  const donated = profile.donatedUsd ?? 0;
  const pick = (id: string) => {
    profile.deckSkin = id;
    saveProfile(profile);
    onProfileChange();
  };
  return (
    <div className="skins-grid">
      {DECK_SKINS.map((skin) => {
        const unlocked = skinUnlocked(skin, donated);
        const on = (profile.deckSkin ?? 'classic') === skin.id;
        return (
          <button
            key={skin.id}
            className={`skin-card ${on ? 'skin-card--on' : ''} ${unlocked ? '' : 'skin-card--locked'}`}
            onClick={() => unlocked && pick(skin.id)}
            title={unlocked ? `Deal with the ${skin.name} decks` : `Unlocks at $${skin.goalUsd} in tips`}
          >
            <div className="skin-card__name">{skin.name}</div>
            <SkinPair id={skin.id} />
            <div className="skin-card__blurb">{skin.blurb}</div>
            <div className="skin-card__goal">
              {unlocked ? (on ? 'In play' : skin.goalUsd > 0 ? 'Unlocked' : 'Free') : `$${skin.goalUsd} goal`}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Wallet link + on-chain refresh — only rendered when the server scans Solana. */
function DonationTracker({
  profile,
  tipAddress,
  onProfileChange,
}: {
  profile: Profile;
  tipAddress: string;
  onProfileChange: () => void;
}) {
  const [wallet, setWallet] = useState(profile.linkedWallet ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const link = async () => {
    setBusy(true);
    setMsg(null);
    const res = await attachWallet(profile, wallet.trim() || null);
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    profile.linkedWallet = res.wallet ?? undefined;
    saveProfile(profile);
    onProfileChange();
    setMsg({ ok: true, text: res.wallet ? 'Wallet linked.' : 'Wallet unlinked.' });
  };

  const refresh = async () => {
    setBusy(true);
    setMsg(null);
    const res = await refreshDonations(profile);
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    profile.donatedUsd = Math.max(profile.donatedUsd ?? 0, res.donatedUsd);
    saveProfile(profile);
    onProfileChange();
    setMsg({
      ok: true,
      text: `Credited $${res.donatedUsd.toFixed(2)} in tips (${res.sol.toFixed(4)} SOL + ${res.usdc.toFixed(2)} USDC).`,
    });
  };

  if (!profile.player) {
    return (
      <p className="rules-note">
        <i>Claim a leaderboard name first — goals are credited to your account.</i>
      </p>
    );
  }
  return (
    <>
      <p className="rules-note">
        Send SOL or USDC to <code className="tip__address">{tipAddress}</code>, then link the
        wallet you sent <i>from</i> — the chain is the receipt, nothing to redeem. Credited so
        far: <b>${(profile.donatedUsd ?? 0).toFixed(2)}</b>.
      </p>
      <div className="join__row">
        <input
          className="join__input"
          placeholder="Wallet you donate from (Solana address)"
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && link()}
        />
        <button className="btn btn--ghost" disabled={busy} onClick={link}>
          {profile.linkedWallet ? 'Update' : 'Link'}
        </button>
        <button
          className="btn btn--deal"
          disabled={busy || !profile.linkedWallet}
          onClick={refresh}
        >
          {busy ? 'Checking…' : 'Check chain'}
        </button>
      </div>
      {msg && <p className={msg.ok ? 'rules-note' : 'join__error'}>{msg.text}</p>}
    </>
  );
}

export function SupportDialog({
  profile,
  onProfileChange,
  onClose,
}: {
  profile: Profile;
  onProfileChange: () => void;
  onClose: () => void;
}) {
  const tips = configuredTips();
  const [copied, setCopied] = useState<string | null>(null);
  // The tip wallet being scanned, from the server; null = feature off/offline.
  const [solana, setSolana] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void serverFeatures().then((f) => {
      if (!cancelled) setSolana(f?.solana ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = async (label: string, address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(label);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // clipboard unavailable — the address is selectable text anyway
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay__panel overlay__panel--rules" onClick={(e) => e.stopPropagation()}>
        <h2>Support Perfect 21</h2>
        <p className="rules-note">
          Perfect 21 is free: no ads, no paywall, no wagering. Tips are appreciated, never
          required — chips stay valueless play tokens either way. As a thank-you, cumulative
          tips unlock cosmetic deck skins below.
        </p>

        {tips.length === 0 ? (
          <p className="rules-note">
            <i>
              No tip addresses are configured yet. (Site owner: add yours in{' '}
              <code>apps/game/src/config.ts</code>.)
            </i>
          </p>
        ) : (
          <div className="tips">
            {tips.map(({ label, address }) => (
              <div key={label} className="tip">
                <span className="tip__label">{label}</span>
                <code className="tip__address">{address}</code>
                <button className="btn btn--ghost tip__copy" onClick={() => copy(label, address)}>
                  {copied === label ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            ))}
          </div>
        )}

        <h3 className="board-subtitle">Deck skins</h3>
        <p className="rules-note">
          Every skin is a matched pair — reshuffles alternate the two decks, just like the house
          blue and red. Cosmetic only: same cards, same odds, same grading.
        </p>
        <SkinPicker profile={profile} onProfileChange={onProfileChange} />
        {solana ? (
          <DonationTracker
            profile={profile}
            tipAddress={solana}
            onProfileChange={onProfileChange}
          />
        ) : (
          <p className="rules-note">
            <i>
              Skin goals are credited on the hosted version, where the server watches the Solana
              tip jar. Already-unlocked skins work everywhere.
            </i>
          </p>
        )}

        <p className="rules-note">
          {SITE.repoUrl ? (
            <>
              You can also star the project on{' '}
              <a href={SITE.repoUrl} target="_blank" rel="noreferrer">
                GitHub
              </a>{' '}
              or just tell a friend who plays 16 vs 10 wrong.
            </>
          ) : (
            <>Or just tell a friend who plays 16 vs 10 wrong.</>
          )}
        </p>

        {SITE.feedbackUrl && (
          <p className="rules-note">
            Found a bug or have an idea?{' '}
            <a href={SITE.feedbackUrl} target="_blank" rel="noreferrer">
              Send feedback
            </a>{' '}
            — mention that you&rsquo;re on v{__APP_VERSION__}.
          </p>
        )}

        <div className="overlay__buttons">
          <button className="btn btn--deal" onClick={onClose}>
            Back to the felt
          </button>
        </div>
      </div>
    </div>
  );
}

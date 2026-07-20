import { useState } from 'react';
import { SITE, configuredTips } from '../config';

export function SupportDialog({ onClose }: { onClose: () => void }) {
  const tips = configuredTips();
  const [copied, setCopied] = useState<string | null>(null);

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
          Perfect 21 is free: no ads, no paywall, no wagering, nothing for sale. If it made you a
          sharper player and you feel like tipping the house, these jars exist. Tips change nothing
          about the game — please don&rsquo;t feel obliged.
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

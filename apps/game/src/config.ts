/**
 * Site configuration. Everything here is safe to publish — it ships in the
 * client bundle.
 */
export const SITE = {
  /**
   * Public source link, shown in the Support dialog when non-empty. The repo
   * is private for now — put the URL back here if/when it goes public.
   */
  repoUrl: '',

  /**
   * Where beta testers send feedback and bug reports: a `mailto:you@example`
   * or a form URL. Shown in the Support dialog when non-empty, hidden
   * otherwise.
   */
  feedbackUrl: '',

  /**
   * Tip-jar addresses (tips are the only monetization: no ads, no wagering,
   * no paywall — cumulative tips unlock cosmetic deck skins, see skins.ts).
   * Fill in your own addresses; empty entries are hidden from the Support
   * dialog. The Solana address the SERVER scans for skin goals is configured
   * separately via SOLANA_TIP_ADDRESS (the dialog shows that one too).
   * NEVER put private keys or seed phrases anywhere near this file.
   */
  tips: {
    Bitcoin: '',
    Ethereum: '',
    Solana: '',
    Lightning: '',
  } as Record<string, string>,
};

export function configuredTips(): Array<{ label: string; address: string }> {
  return Object.entries(SITE.tips)
    .filter(([, address]) => address.trim() !== '')
    .map(([label, address]) => ({ label, address: address.trim() }));
}

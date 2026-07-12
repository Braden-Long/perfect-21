/**
 * Site configuration. Everything here is safe to publish — it ships in the
 * client bundle.
 */
export const SITE = {
  repoUrl: 'https://github.com/Braden-Long/perfect-21',

  /**
   * Tip-jar addresses (tip-only monetization: no ads, no wagering, no paywall).
   * Fill in your own addresses; empty entries are hidden from the Support
   * dialog. NEVER put private keys or seed phrases anywhere near this file.
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

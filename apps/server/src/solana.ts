/**
 * Solana donation tracking, powering the deck-skin donation goals.
 *
 * The owner configures the tip wallet + a Helius API key; players link the
 * wallet THEY send from. Crediting scans the tip wallet's transaction history
 * (Helius enhanced-transactions API parses native SOL and SPL-token transfers
 * for us) and sums everything a given sender sent to the tip address:
 * SOL valued at the current CoinGecko price, USDC at $1.
 *
 *   HELIUS_API_KEY      from https://helius.dev (free tier is plenty)
 *   SOLANA_TIP_ADDRESS  the wallet donations arrive at
 *
 * Both unset → feature disabled (hidden from /api/health, endpoints 503),
 * same pattern as email recovery.
 */

/** Circulating USDC mint on mainnet. */
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LAMPORTS_PER_SOL = 1_000_000_000;
/** Base58, 32–44 chars — the practical shape of a Solana address. */
export const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const LEDGER_TTL_MS = 60_000;
const PRICE_TTL_MS = 5 * 60_000;
/** 10 pages × 100 txs bounds one scan; beyond that, oldest tips drop off. */
const MAX_PAGES = 10;
const FETCH_TIMEOUT_MS = 10_000;

export interface DonationTotals {
  /** Total credited, in USD (SOL at the current price + USDC at $1). */
  usd: number;
  sol: number;
  usdc: number;
}

export type DonationChecker = (senderWallet: string) => Promise<DonationTotals>;

/** The slice of a Helius enhanced transaction this module reads. */
export interface HeliusTx {
  signature: string;
  nativeTransfers?: Array<{ fromUserAccount: string; toUserAccount: string; amount: number }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
  }>;
}

/**
 * Sum what `sender` transferred to `tipAddress` across parsed transactions.
 * Pure so the parsing rules are testable without the network: only transfers
 * into the tip address count, and only SOL or USDC — other tokens are worth
 * whatever they're worth somewhere else.
 */
export function sumTransfers(
  txs: HeliusTx[],
  sender: string,
  tipAddress: string
): { sol: number; usdc: number } {
  let lamports = 0;
  let usdc = 0;
  for (const tx of txs) {
    for (const t of tx.nativeTransfers ?? []) {
      if (t.fromUserAccount === sender && t.toUserAccount === tipAddress) lamports += t.amount;
    }
    for (const t of tx.tokenTransfers ?? []) {
      if (t.fromUserAccount === sender && t.toUserAccount === tipAddress && t.mint === USDC_MINT) {
        usdc += t.tokenAmount;
      }
    }
  }
  return { sol: lamports / LAMPORTS_PER_SOL, usdc };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return (await res.json()) as T;
}

export function createDonationChecker(
  env: NodeJS.ProcessEnv = process.env
): { check: DonationChecker; tipAddress: string } | null {
  const apiKey = env.HELIUS_API_KEY;
  const tipAddress = env.SOLANA_TIP_ADDRESS;
  if (!apiKey || !tipAddress) return null;

  // One shared scan of the tip wallet serves every player's refresh: a
  // sender → totals ledger, rebuilt at most once a minute.
  let ledger: { at: number; bySender: Map<string, { sol: number; usdc: number }> } | null = null;
  let price: { at: number; usdPerSol: number } | null = null;

  const loadLedger = async () => {
    if (ledger && Date.now() - ledger.at < LEDGER_TTL_MS) return ledger.bySender;
    const txs: HeliusTx[] = [];
    let before = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await getJson<HeliusTx[]>(
        `https://api.helius.xyz/v0/addresses/${tipAddress}/transactions` +
          `?api-key=${apiKey}&limit=100${before && `&before=${before}`}`
      );
      txs.push(...batch);
      if (batch.length < 100) break;
      before = batch[batch.length - 1].signature;
    }
    const bySender = new Map<string, { sol: number; usdc: number }>();
    for (const tx of txs) {
      const senders = new Set<string>();
      for (const t of tx.nativeTransfers ?? []) senders.add(t.fromUserAccount);
      for (const t of tx.tokenTransfers ?? []) senders.add(t.fromUserAccount);
      for (const sender of senders) {
        if (!sender || bySender.has(sender)) continue;
        bySender.set(sender, { sol: 0, usdc: 0 });
      }
    }
    for (const [sender, totals] of bySender) {
      const sum = sumTransfers(txs, sender, tipAddress);
      totals.sol = sum.sol;
      totals.usdc = sum.usdc;
    }
    ledger = { at: Date.now(), bySender };
    return bySender;
  };

  const loadPrice = async () => {
    if (price && Date.now() - price.at < PRICE_TTL_MS) return price.usdPerSol;
    try {
      const body = await getJson<{ solana?: { usd?: number } }>(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
      );
      const usd = body.solana?.usd;
      if (typeof usd === 'number' && usd > 0) price = { at: Date.now(), usdPerSol: usd };
    } catch {
      // fall through to the stale price below
    }
    // A stale price beats crediting SOL at $0; no price ever seen is an error.
    if (!price) throw new Error('SOL price unavailable');
    return price.usdPerSol;
  };

  const check: DonationChecker = async (senderWallet) => {
    const [bySender, usdPerSol] = await Promise.all([loadLedger(), loadPrice()]);
    const t = bySender.get(senderWallet) ?? { sol: 0, usdc: 0 };
    return { sol: t.sol, usdc: t.usdc, usd: t.sol * usdPerSol + t.usdc };
  };

  return { check, tipAddress };
}

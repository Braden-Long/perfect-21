import { fileURLToPath } from 'node:url';
import { createApp, defaultStaticDir, parseTrustProxy } from './app';
import { openDb } from './db';
import { createMailer } from './mail';
import { createDonationChecker } from './solana';

const port = Number(process.env.PORT ?? 8721);
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../data/perfect21.db', import.meta.url));
const adminToken = process.env.ADMIN_TOKEN;
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;

// Recovery links embed PUBLIC_URL; with SMTP configured but PUBLIC_URL unset
// they would point at localhost and silently strand every recipient. Refuse
// the half-configuration instead of mailing broken links.
let sendMail = createMailer();
if (sendMail && !process.env.PUBLIC_URL) {
  console.error(
    'SMTP_URL is set but PUBLIC_URL is not — recovery links would point at ' +
      `${publicUrl}. Email recovery stays DISABLED until PUBLIC_URL is set.`
  );
  sendMail = null;
}

// Set TRUST_PROXY when behind a reverse proxy so the throttle sees real client
// IPs: `1` (one proxy hop), `true`, or a subnet like `10.0.0.0/8`. Unset =
// don't trust forwarded headers (correct when the server is directly exposed).
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

// Deck-skin donation goals: needs HELIUS_API_KEY + SOLANA_TIP_ADDRESS.
const solana = createDonationChecker();

const app = createApp({
  db: openDb(dbPath),
  adminToken,
  staticDir: defaultStaticDir(),
  sendMail: sendMail ?? undefined,
  publicUrl,
  checkDonations: solana?.check,
  solanaTipAddress: solana?.tipAddress,
  trustProxy,
});

app.listen(port, () => {
  console.log(`Perfect 21 server listening on http://localhost:${port}`);
  console.log(`  db: ${dbPath}`);
  console.log(`  admin: ${adminToken ? 'enabled' : 'DISABLED (set ADMIN_TOKEN to enable)'}`);
  console.log(
    `  email recovery: ${sendMail ? `enabled (links point at ${publicUrl})` : 'DISABLED (set SMTP_URL and MAIL_FROM to enable)'}`
  );
  console.log(
    `  deck-skin donations: ${solana ? `enabled (tip wallet ${solana.tipAddress})` : 'DISABLED (set HELIUS_API_KEY and SOLANA_TIP_ADDRESS to enable)'}`
  );
});

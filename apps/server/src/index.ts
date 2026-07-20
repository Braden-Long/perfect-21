import { fileURLToPath } from 'node:url';
import { createApp, defaultStaticDir, parseTrustProxy } from './app';
import { openDb } from './db';
import { createMailer } from './mail';

const port = Number(process.env.PORT ?? 8721);
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../data/perfect21.db', import.meta.url));
const adminToken = process.env.ADMIN_TOKEN;
const sendMail = createMailer();
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;

// Set TRUST_PROXY when behind a reverse proxy so the throttle sees real client
// IPs: `1` (one proxy hop), `true`, or a subnet like `10.0.0.0/8`. Unset =
// don't trust forwarded headers (correct when the server is directly exposed).
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

const app = createApp({
  db: openDb(dbPath),
  adminToken,
  staticDir: defaultStaticDir(),
  sendMail: sendMail ?? undefined,
  publicUrl,
  trustProxy,
});

app.listen(port, () => {
  console.log(`Perfect 21 server listening on http://localhost:${port}`);
  console.log(`  db: ${dbPath}`);
  console.log(`  admin: ${adminToken ? 'enabled' : 'DISABLED (set ADMIN_TOKEN to enable)'}`);
  console.log(
    `  email recovery: ${sendMail ? `enabled (links point at ${publicUrl})` : 'DISABLED (set SMTP_URL and MAIL_FROM to enable)'}`
  );
});

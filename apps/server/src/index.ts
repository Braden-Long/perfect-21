import { fileURLToPath } from 'node:url';
import { createApp, defaultStaticDir } from './app';
import { openDb } from './db';
import { createMailer } from './mail';

const port = Number(process.env.PORT ?? 8721);
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../data/perfect21.db', import.meta.url));
const adminToken = process.env.ADMIN_TOKEN;
const sendMail = createMailer();
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;

const app = createApp({
  db: openDb(dbPath),
  adminToken,
  staticDir: defaultStaticDir(),
  sendMail: sendMail ?? undefined,
  publicUrl,
});

app.listen(port, () => {
  console.log(`Perfect 21 server listening on http://localhost:${port}`);
  console.log(`  db: ${dbPath}`);
  console.log(`  admin: ${adminToken ? 'enabled' : 'DISABLED (set ADMIN_TOKEN to enable)'}`);
  console.log(
    `  email recovery: ${sendMail ? `enabled (links point at ${publicUrl})` : 'DISABLED (set SMTP_URL and MAIL_FROM to enable)'}`
  );
});

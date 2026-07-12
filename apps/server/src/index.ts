import { fileURLToPath } from 'node:url';
import { createApp, defaultStaticDir } from './app';
import { openDb } from './db';

const port = Number(process.env.PORT ?? 8721);
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../data/perfect21.db', import.meta.url));
const adminToken = process.env.ADMIN_TOKEN;

const app = createApp({
  db: openDb(dbPath),
  adminToken,
  staticDir: defaultStaticDir(),
});

app.listen(port, () => {
  console.log(`Perfect 21 server listening on http://localhost:${port}`);
  console.log(`  db: ${dbPath}`);
  console.log(`  admin: ${adminToken ? 'enabled' : 'DISABLED (set ADMIN_TOKEN to enable)'}`);
});

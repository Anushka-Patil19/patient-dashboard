// Runs a real PostgreSQL server from npm binaries - no Docker or system install
// needed. Creates the `outreach` (dev) and `outreach_test` databases on first run.
//   npm run db:local     (leave running in its own terminal; Ctrl+C to stop)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.pgdata');
const fresh = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'outreach',
  password: 'outreach',
  port: Number(process.env.PGPORT || 55432),
  persistent: true,
  onLog: process.env.PG_DEBUG ? console.log : () => {},
  onError: console.error,
});

if (fresh) await pg.initialise();
await pg.start();
for (const db of ['outreach', 'outreach_test']) {
  await pg.createDatabase(db).catch((err) => {
    if (!/already exists/.test(err.message)) throw err;
  });
}
console.log(`PostgreSQL ready on localhost:${process.env.PGPORT || 55432} (user/password: outreach/outreach). Ctrl+C to stop.`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

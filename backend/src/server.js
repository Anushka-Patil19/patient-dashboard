import { createApp } from './app.js';
import { config } from './config.js';
import { pool, query } from './db/pool.js';

async function maybeSeedDemoData() {
  // Lets a fresh cloud deployment come up with demo data and demo logins.
  if (process.env.SEED_DEMO_DATA !== 'true') return;
  const { rows } = await query('SELECT count(*) AS n FROM users');
  if (rows[0].n > 0) return;
  const { seed } = await import('./db/seed.js');
  await seed();
}

await maybeSeedDemoData();

const server = createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port} (${config.env})`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => pool.end().then(() => process.exit(0)));
  // SSE connections keep the server open; force-exit after a grace period.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

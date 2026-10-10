export default async function setup() {
  await import('./setup-env.js');
  const { migrate } = await import('../src/db/migrate.js');
  const { pool } = await import('../src/db/pool.js');
  await migrate({ log: () => {} });
  await pool.end();
}

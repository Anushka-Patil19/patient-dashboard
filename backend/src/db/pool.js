import pg from 'pg';
import { config } from '../config.js';

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates, which would
// otherwise be shifted by the server's local timezone.
pg.types.setTypeParser(1082, (value) => value);
// NUMERIC -> JS number (vitals are small decimals, no precision concern).
pg.types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));
// COUNT(*) returns BIGINT; counts here never approach 2^53.
pg.types.setTypeParser(20, (value) => Number(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

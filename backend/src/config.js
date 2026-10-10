import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function secret(name) {
  const value = required(name);
  // Short secrets make HMAC/JWT signatures brute-forceable; refuse to boot in production.
  if (isProd && value.length < 32) {
    throw new Error(`${name} must be at least 32 characters in production`);
  }
  return value;
}

export const config = {
  env,
  isProd,
  port: Number(process.env.PORT || 4000),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: secret('JWT_SECRET'),
  // Separate key for pseudonymising external identifiers (Aadhaar/ABHA/phone),
  // so leaking one secret does not compromise the other.
  pseudonymSecret: secret('PSEUDONYM_SECRET'),
  accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 15 * 60),
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
  // A rotated refresh token presented again within this window is treated as a
  // benign race (two tabs refreshing at once), not as token theft.
  refreshReuseGraceSeconds: 15,
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  // Secure (HTTPS-only) cookies in production unless explicitly disabled for
  // plain-HTTP localhost runs such as docker compose.
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  staticDir: process.env.STATIC_DIR || '',
};

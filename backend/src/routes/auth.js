import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { AppError, unauthorized } from '../lib/errors.js';
import { permissionsFor } from '../lib/permissions.js';
import { hashToken, newRefreshToken, signAccessToken } from '../lib/tokens.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

export const REFRESH_COOKIE = 'rt';
const cookieOptions = () => ({
  httpOnly: true, // not readable by JavaScript, so XSS cannot steal it
  secure: config.cookieSecure,
  sameSite: 'strict', // never sent on cross-site requests -> CSRF-safe
  path: '/api/auth', // only sent to the endpoints that need it
  maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
});

// Compared against when the email is unknown, so response time does not reveal
// whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', config.bcryptRounds);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.env === 'test',
  handler: (_req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } }),
});

const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

export function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name ?? u.fullName,
    role: u.role,
    facility: u.facility,
    permissions: permissionsFor(u.role),
  };
}

async function issueRefreshToken(db, userId, familyId = crypto.randomUUID()) {
  const token = newRefreshToken();
  await db.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
    [userId, familyId, hashToken(token), config.refreshTokenTtlDays],
  );
  return token;
}

function sendSession(res, user, refreshToken) {
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
  res.json({
    accessToken: signAccessToken(user),
    expiresIn: config.accessTokenTtlSeconds,
    user: publicUser(user),
  });
}

router.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.valid.body;
  const invalid = () => unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');

  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    await audit(req, { action: 'LOGIN_FAILED', changes: { email, reason: 'UNKNOWN_USER' } });
    throw invalid();
  }

  if (user.locked_until && user.locked_until > new Date()) {
    await audit(req, { action: 'LOGIN_FAILED', user, changes: { reason: 'LOCKED' } });
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Account is locked for a few minutes.');
  }

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    // Atomic increment so parallel guesses cannot slip past the threshold.
    await query(
      `UPDATE users
          SET failed_login_attempts = failed_login_attempts + 1,
              locked_until = CASE WHEN failed_login_attempts + 1 >= $2
                                  THEN now() + make_interval(mins => $3) ELSE locked_until END
        WHERE id = $1`,
      [user.id, config.maxFailedLogins, config.lockoutMinutes],
    );
    await audit(req, { action: 'LOGIN_FAILED', user, changes: { reason: 'BAD_PASSWORD' } });
    throw invalid();
  }

  if (!user.is_active) {
    await audit(req, { action: 'LOGIN_FAILED', user, changes: { reason: 'DISABLED' } });
    throw invalid();
  }

  const refreshToken = await withTransaction(async (db) => {
    await db.query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`,
      [user.id],
    );
    await audit(req, { action: 'LOGIN_SUCCESS', user }, db);
    return issueRefreshToken(db, user.id);
  });

  sendSession(res, user, refreshToken);
});

router.post('/refresh', async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (!presented) throw unauthorized('No active session', 'NO_SESSION');

  // Outcomes are returned rather than thrown so that the revocation performed
  // on token reuse is committed, not rolled back.
  const outcome = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT rt.*, u.email, u.full_name, u.role, u.facility, u.is_active
         FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1
        FOR UPDATE OF rt`,
      [hashToken(presented)],
    );
    const row = rows[0];
    if (!row) return { error: 'INVALID' };
    const user = { id: row.user_id, email: row.email, full_name: row.full_name, role: row.role, facility: row.facility };

    if (row.revoked_at) {
      const ageSeconds = (Date.now() - row.revoked_at.getTime()) / 1000;
      const benignRace = row.revoked_reason === 'ROTATED' && ageSeconds <= config.refreshReuseGraceSeconds;
      if (!benignRace) {
        await db.query(
          `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'REUSE_DETECTED'
            WHERE family_id = $1 AND revoked_at IS NULL`,
          [row.family_id],
        );
        await audit(req, { action: 'REFRESH_TOKEN_REUSE', user, changes: { familyId: row.family_id } }, db);
        return { error: 'REUSED' };
      }
    } else {
      await db.query(
        `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'ROTATED' WHERE id = $1`,
        [row.id],
      );
    }

    if (row.expires_at < new Date() || !row.is_active) return { error: 'EXPIRED' };
    return { user, token: await issueRefreshToken(db, row.user_id, row.family_id) };
  });

  if (outcome.error) {
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
    throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_ENDED');
  }
  sendSession(res, outcome.user, outcome.token);
});

router.post('/logout', async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (presented) {
    const { rows } = await query(
      `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'LOGOUT'
        WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)
          AND revoked_at IS NULL
        RETURNING user_id`,
      [hashToken(presented)],
    );
    if (rows[0]) {
      const u = (await query('SELECT id, email, role FROM users WHERE id = $1', [rows[0].user_id])).rows[0];
      await audit(req, { action: 'LOGOUT', user: u });
    }
  }
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;

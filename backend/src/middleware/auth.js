import { query } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { can } from '../lib/permissions.js';
import { verifyAccessToken } from '../lib/tokens.js';

export async function authenticate(req, _res, next) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw unauthorized('Your session has expired', 'TOKEN_EXPIRED');
    throw unauthorized('Invalid access token', 'INVALID_TOKEN');
  }

  // Role and active flag come from the database, not the token, so revoking
  // access or changing a role takes effect on the very next request.
  const { rows } = await query(
    'SELECT id, email, full_name, role, facility, is_active FROM users WHERE id = $1',
    [payload.sub],
  );
  const user = rows[0];
  if (!user || !user.is_active) throw unauthorized('Account is disabled', 'ACCOUNT_DISABLED');

  req.user = { id: user.id, email: user.email, fullName: user.full_name, role: user.role, facility: user.facility };
  req.tokenExpiresAt = payload.exp * 1000;
  next();
}

/** Allows the request if the user's role grants ANY of the listed permissions. */
export function authorize(...permissions) {
  return async (req, _res, next) => {
    if (permissions.some((p) => can(req.user.role, p))) return next();
    await audit(req, {
      action: 'ACCESS_DENIED',
      changes: { permission: permissions.join('|'), method: req.method, path: req.originalUrl },
    });
    throw forbidden();
  };
}

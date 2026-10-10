import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const ISSUER = 'rural-outreach-api';
const AUDIENCE = 'rural-outreach-web';

export function signAccessToken(user, { expiresIn = config.accessTokenTtlSeconds } = {}) {
  return jwt.sign({ role: user.role }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: user.id,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn,
  });
}

export function verifyAccessToken(token) {
  // Pin the algorithm so a token with alg "none" or RS/HS confusion is rejected.
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
}

export function newRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

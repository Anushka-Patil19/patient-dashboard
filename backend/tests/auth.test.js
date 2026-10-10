import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool.js';
import { signAccessToken } from '../src/lib/tokens.js';
import { app, auditRows, createUser, login, PASSWORD, resetDb } from './helpers.js';

const refreshCookie = (cookies) => cookies.find((c) => c.startsWith('rt=')).split(';')[0];

describe('authentication', () => {
  beforeEach(resetDb);

  it('logs in with valid credentials and sets a hardened refresh cookie', async () => {
    const user = await createUser('DOCTOR');
    const res = await request(app).post('/api/auth/login').send({ email: user.email.toUpperCase(), password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user).toMatchObject({ email: user.email, role: 'DOCTOR' });
    expect(res.body.user.permissions).toContain('encounter:update');
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(await auditRows('LOGIN_SUCCESS')).toHaveLength(1);
  });

  it('returns the same generic error for unknown email and wrong password', async () => {
    const user = await createUser('NURSE');
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: PASSWORD });
    const wrong = await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error).toEqual(wrong.body.error);
    expect(await auditRows('LOGIN_FAILED')).toHaveLength(2);
  });

  it('locks the account after 5 failed attempts, even for the right password', async () => {
    const user = await createUser('NURSE');
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' });
    }
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('rejects deactivated users at login and on existing tokens', async () => {
    const user = await createUser('DOCTOR');
    const { token } = await login(user.email);
    await query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    const loginRes = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(loginRes.status).toBe(401);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('signals TOKEN_EXPIRED so the client knows to refresh', async () => {
    const user = await createUser('DOCTOR');
    const expired = signAccessToken(user, { expiresIn: -10 });
    const res = await request(app).get('/api/encounters').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects tampered and unsigned tokens', async () => {
    const user = await createUser('NURSE');
    const { token } = await login(user.email);
    const [header, payload] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), role: 'ADMIN' }),
    ).toString('base64url');
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');

    for (const bad of [`${header}.${forgedPayload}.${token.split('.')[2]}`, `${noneHeader}.${payload}.`]) {
      const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${bad}`);
      expect(res.status).toBe(401);
    }
  });

  it('rotates refresh tokens and revokes the family when an old token is replayed', async () => {
    const user = await createUser('DOCTOR');
    const { cookie } = await login(user.email);
    const original = refreshCookie(cookie);

    const first = await request(app).post('/api/auth/refresh').set('Cookie', original);
    expect(first.status).toBe(200);
    const rotated = refreshCookie(first.headers['set-cookie']);
    expect(rotated).not.toEqual(original);

    // Simulate an attacker replaying the stolen original after the grace window.
    await query(`UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute' WHERE revoked_reason = 'ROTATED'`);
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', original);
    expect(replay.status).toBe(401);
    expect(await auditRows('REFRESH_TOKEN_REUSE')).toHaveLength(1);

    // The legitimate user's newer token is now dead too.
    const legit = await request(app).post('/api/auth/refresh').set('Cookie', rotated);
    expect(legit.status).toBe(401);
  });

  it('tolerates two tabs refreshing at the same moment', async () => {
    const user = await createUser('DOCTOR');
    const { cookie } = await login(user.email);
    const original = refreshCookie(cookie);
    const a = await request(app).post('/api/auth/refresh').set('Cookie', original);
    const b = await request(app).post('/api/auth/refresh').set('Cookie', original);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it('logout revokes the refresh token', async () => {
    const user = await createUser('NURSE');
    const { cookie } = await login(user.email);
    const rt = refreshCookie(cookie);
    expect((await request(app).post('/api/auth/logout').set('Cookie', rt)).status).toBe(204);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', rt)).status).toBe(401);
  });
});

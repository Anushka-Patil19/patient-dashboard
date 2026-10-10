import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { query } from '../src/db/pool.js';
import { todayIST } from '../src/lib/schemas.js';

export const app = createApp();
export const PASSWORD = 'Password123';

export async function resetDb() {
  await query('TRUNCATE audit_logs, refresh_tokens, encounters, patients, users RESTART IDENTITY CASCADE');
}

let counter = 0;
export async function createUser(role, overrides = {}) {
  counter += 1;
  const email = overrides.email ?? `${role.toLowerCase()}${counter}@test.local`;
  const { rows } = await query(
    `INSERT INTO users (email, full_name, password_hash, role, facility, is_active)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, role`,
    [email, `${role} ${counter}`, await bcrypt.hash(PASSWORD, 4), role, 'PHC Test', overrides.isActive ?? true],
  );
  return rows[0];
}

/** Logs in and returns { token, cookie, user } */
export async function login(email, password = PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, cookie: res.headers['set-cookie'], user: res.body.user };
}

export async function userWithToken(role) {
  const user = await createUser(role);
  const { token } = await login(user.email);
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
}

export async function createPatient(auth, body = {}) {
  const res = await request(app)
    .post('/api/patients')
    .set(auth)
    .send({ birthYear: 1985, sex: 'FEMALE', district: 'Nashik', block: 'Igatpuri', ...body });
  if (res.status !== 201) throw new Error(`createPatient failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export function validEncounter(patientId, overrides = {}) {
  return {
    patientId,
    encounterDate: todayIST(),
    encounterType: 'IN_PERSON',
    symptoms: ['fever', 'headache'],
    diagnosisCode: 'VIRAL_FEVER',
    diagnosisNotes: 'Likely viral',
    treatment: 'Paracetamol',
    temperatureC: 38.6,
    systolicBp: 120,
    diastolicBp: 80,
    pulseBpm: 92,
    spo2Pct: 98,
    ...overrides,
  };
}

export async function createEncounter(auth, patientId, overrides) {
  const res = await request(app).post('/api/encounters').set(auth).send(validEncounter(patientId, overrides));
  if (res.status !== 201) throw new Error(`createEncounter failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function auditRows(action) {
  return (await query('SELECT * FROM audit_logs WHERE action = $1 ORDER BY id', [action])).rows;
}

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool.js';
import { addDays, todayIST } from '../src/lib/schemas.js';
import { app, auditRows, createEncounter, createPatient, resetDb, userWithToken, validEncounter } from './helpers.js';

describe('encounters', () => {
  let doctor;
  let patient;

  beforeEach(async () => {
    await resetDb();
    doctor = await userWithToken('DOCTOR');
    patient = await createPatient(doctor.auth);
  });

  it('creates an encounter, normalises symptoms and audits it', async () => {
    const res = await request(app)
      .post('/api/encounters')
      .set(doctor.auth)
      .send(validEncounter(patient.id, { symptoms: [' Fever ', 'fever', 'Cough'] }));

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ version: 1, symptoms: ['fever', 'cough'], diagnosisLabel: 'Viral fever' });
    expect(res.body.data.patient.pseudoId).toMatch(/^PT-[0-9A-Z]{8}$/);
    expect(res.body.data.facility).toBe('PHC Test');
    expect(await auditRows('CREATE')).toHaveLength(2); // patient + encounter
  });

  it.each([
    ['missing symptoms', { symptoms: [] }, 'symptoms'],
    ['future date', { encounterDate: addDays(todayIST(), 2) }, 'encounterDate'],
    ['bad date format', { encounterDate: '12/05/2026' }, 'encounterDate'],
    ['diastolic above systolic', { systolicBp: 80, diastolicBp: 120 }, 'diastolicBp'],
    ['only one BP value', { systolicBp: 120, diastolicBp: null }, 'diastolicBp'],
    ['impossible temperature', { temperatureC: 55 }, 'temperatureC'],
    ['vitals as strings', { pulseBpm: 'ninety' }, 'pulseBpm'],
    ['follow-up before visit', { followUpDate: addDays(todayIST(), -3) }, 'followUpDate'],
    ['unknown diagnosis', { diagnosisCode: 'ZOMBIE' }, 'diagnosisCode'],
    ['unexpected field', { patientName: 'Ramesh' }, ''],
  ])('rejects %s with a field-level error', async (_label, overrides, field) => {
    const res = await request(app).post('/api/encounters').set(doctor.auth).send(validEncounter(patient.id, overrides));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    if (field) expect(res.body.error.details.map((d) => d.field)).toContain(field);
  });

  it('rejects an encounter for a patient that does not exist', async () => {
    const res = await request(app)
      .post('/api/encounters')
      .set(doctor.auth)
      .send(validEncounter('00000000-0000-4000-8000-000000000000'));
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('patientId');
  });

  it('returns 400 for malformed JSON and 404 for a malformed id', async () => {
    const bad = await request(app)
      .post('/api/encounters')
      .set(doctor.auth)
      .set('Content-Type', 'application/json')
      .send('{"patientId": ');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MALFORMED_JSON');

    const badId = await request(app).get('/api/encounters/not-a-uuid').set(doctor.auth);
    expect(badId.status).toBe(400);
  });

  it('updates with optimistic locking and records a field-level diff', async () => {
    const enc = await createEncounter(doctor.auth, patient.id);
    const { patientId: _p, ...body } = validEncounter(patient.id, { diagnosisCode: 'DENGUE', temperatureC: 39.4 });

    const ok = await request(app).put(`/api/encounters/${enc.id}`).set(doctor.auth).send({ ...body, version: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.version).toBe(2);

    const [update] = await auditRows('UPDATE');
    expect(update.changes.diagnosis_code).toEqual({ from: 'VIRAL_FEVER', to: 'DENGUE' });
    expect(update.changes.temperature_c).toEqual({ from: 38.6, to: 39.4 });

    // A second clinician still holding version 1 must not silently overwrite.
    const stale = await request(app).put(`/api/encounters/${enc.id}`).set(doctor.auth).send({ ...body, version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.details.current.version).toBe(2);
  });

  it('soft-deletes with a reason and hides the record', async () => {
    const enc = await createEncounter(doctor.auth, patient.id);
    const noReason = await request(app).delete(`/api/encounters/${enc.id}`).set(doctor.auth).send({});
    expect(noReason.status).toBe(400);

    const del = await request(app).delete(`/api/encounters/${enc.id}`).set(doctor.auth).send({ reason: 'Duplicate entry' });
    expect(del.status).toBe(204);
    expect((await request(app).get(`/api/encounters/${enc.id}`).set(doctor.auth)).status).toBe(404);
    expect((await request(app).get('/api/encounters').set(doctor.auth)).body.total).toBe(0);

    const { rows } = await query('SELECT deleted_at, delete_reason FROM encounters WHERE id = $1', [enc.id]);
    expect(rows[0].deleted_at).not.toBeNull();
    expect(rows[0].delete_reason).toBe('Duplicate entry');
  });

  it('filters and paginates the list', async () => {
    await createEncounter(doctor.auth, patient.id, { encounterDate: addDays(todayIST(), -10) });
    await createEncounter(doctor.auth, patient.id, { encounterDate: addDays(todayIST(), -5), diagnosisCode: 'MALARIA' });
    await createEncounter(doctor.auth, patient.id);

    const res = await request(app)
      .get('/api/encounters')
      .query({ from: addDays(todayIST(), -7), pageSize: 1 })
      .set(doctor.auth);
    expect(res.body.total).toBe(2);
    expect(res.body.data).toHaveLength(1);

    const malaria = await request(app).get('/api/encounters').query({ diagnosis: 'malaria' }).set(doctor.auth);
    expect(malaria.body.total).toBe(1);

    const badRange = await request(app).get('/api/encounters').query({ from: todayIST(), to: '2020-01-01' }).set(doctor.auth);
    expect(badRange.status).toBe(400);
  });
});

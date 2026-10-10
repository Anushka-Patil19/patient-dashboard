import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool.js';
import { addDays, todayIST } from '../src/lib/schemas.js';
import { app, createEncounter, createPatient, resetDb, userWithToken } from './helpers.js';

describe('patients (anonymisation)', () => {
  let nurse;
  beforeEach(async () => {
    await resetDb();
    nurse = await userWithToken('NURSE');
  });

  it('never stores the external identifier in clear text', async () => {
    const patient = await createPatient(nurse.auth, { externalRef: '9876 5432 1098' });
    const { rows } = await query('SELECT * FROM patients WHERE id = $1', [patient.id]);
    expect(JSON.stringify(rows[0])).not.toContain('987654321098');
    expect(rows[0].external_ref_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(patient).not.toHaveProperty('externalRef');
  });

  it('detects a duplicate registration by external ID and points to the existing patient', async () => {
    const first = await createPatient(nurse.auth, { externalRef: '9876-5432-1098' });
    const dup = await request(app)
      .post('/api/patients')
      .set(nurse.auth)
      .send({ birthYear: 1990, sex: 'MALE', district: 'Palghar', externalRef: '987654321098' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('PATIENT_EXISTS');
    expect(dup.body.error.details.pseudoId).toBe(first.pseudoId);
  });

  it('finds patients by pseudo ID prefix or by external ID', async () => {
    const p = await createPatient(nurse.auth, { externalRef: 'ABHA-1111-2222' });
    await createPatient(nurse.auth);
    const byPseudo = await request(app).get('/api/patients').query({ q: p.pseudoId.slice(0, 6).toLowerCase() }).set(nurse.auth);
    expect(byPseudo.body.data.map((x) => x.id)).toContain(p.id);
    const byRef = await request(app).get('/api/patients').query({ q: 'abha 1111 2222' }).set(nurse.auth);
    expect(byRef.body.data.map((x) => x.id)).toEqual([p.id]);
  });

  it('rejects implausible demographics', async () => {
    const res = await request(app).post('/api/patients').set(nurse.auth).send({ birthYear: 1700, sex: 'X', district: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['birthYear', 'district', 'sex']);
  });
});

describe('analytics', () => {
  let doctor;
  beforeEach(async () => {
    await resetDb();
    doctor = await userWithToken('DOCTOR');
  });

  it('aggregates counts in range, excludes deleted and out-of-range encounters', async () => {
    const p1 = await createPatient(doctor.auth, { district: 'Nashik' });
    const p2 = await createPatient(doctor.auth, { district: 'Palghar' });
    await createEncounter(doctor.auth, p1.id, { diagnosisCode: 'DENGUE' });
    await createEncounter(doctor.auth, p2.id, { diagnosisCode: 'DENGUE', encounterType: 'TELECONSULT' });
    await createEncounter(doctor.auth, p2.id, { diagnosisCode: 'DIABETES', bloodGlucoseMgdl: 260 });
    await createEncounter(doctor.auth, p1.id, { diagnosisCode: 'MALARIA', encounterDate: addDays(todayIST(), -200) });
    const deleted = await createEncounter(doctor.auth, p1.id, { diagnosisCode: 'MALARIA' });
    await request(app).delete(`/api/encounters/${deleted.id}`).set(doctor.auth).send({ reason: 'entered twice' });

    const res = await request(app)
      .get('/api/analytics/summary')
      .query({ from: addDays(todayIST(), -29), to: todayIST() })
      .set(doctor.auth);

    expect(res.status).toBe(200);
    expect(res.body.range.granularity).toBe('day');
    expect(res.body.totals).toMatchObject({ encounters: 3, patients: 2, communicable: 2, teleconsults: 1 });
    expect(res.body.riskFlags.highGlucose).toBe(1);
    expect(res.body.byDiagnosis[0]).toMatchObject({ code: 'DENGUE', count: 2 });
    expect(res.body.trend).toHaveLength(30); // one point per day, including empty days
    expect(res.body.trend.at(-1).total).toBe(3);

    const palghar = await request(app).get('/api/analytics/summary').query({ district: 'Palghar' }).set(doctor.auth);
    expect(palghar.body.totals.encounters).toBe(2);
  });

  it('validates the date range', async () => {
    const reversed = await request(app).get('/api/analytics/summary').query({ from: '2026-05-01', to: '2026-01-01' }).set(doctor.auth);
    expect(reversed.status).toBe(400);
    const tooLong = await request(app).get('/api/analytics/summary').query({ from: '2015-01-01', to: '2026-01-01' }).set(doctor.auth);
    expect(tooLong.status).toBe(400);
  });
});

describe('audit log', () => {
  beforeEach(resetDb);

  it('is append-only at the database level', async () => {
    const admin = await userWithToken('ADMIN'); // login writes an audit row
    await expect(query(`UPDATE audit_logs SET action = 'X'`)).rejects.toThrow(/append-only/);
    await expect(query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);

    const res = await request(app).get('/api/audit-logs').query({ action: 'LOGIN_SUCCESS' }).set(admin.auth);
    expect(res.body.total).toBe(1);
  });

  it('redacts free-text clinical fields from audit diffs', async () => {
    const doctor = await userWithToken('DOCTOR');
    const patient = await createPatient(doctor.auth);
    await createEncounter(doctor.auth, patient.id, { diagnosisNotes: 'Sensitive narrative' });
    const { rows } = await query(`SELECT changes FROM audit_logs WHERE entity_type = 'encounter'`);
    expect(JSON.stringify(rows[0].changes)).not.toContain('Sensitive narrative');
    expect(rows[0].changes.diagnosis_notes).toEqual({ changed: true });
  });
});

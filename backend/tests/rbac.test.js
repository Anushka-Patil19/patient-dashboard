import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, auditRows, createEncounter, createPatient, resetDb, userWithToken } from './helpers.js';

describe('role-based access control', () => {
  let doctor;
  let nurse;
  let admin;
  let patient;

  beforeEach(async () => {
    await resetDb();
    [doctor, nurse, admin] = await Promise.all([
      userWithToken('DOCTOR'),
      userWithToken('NURSE'),
      userWithToken('ADMIN'),
    ]);
    patient = await createPatient(nurse.auth);
  });

  it('requires authentication on every clinical endpoint', async () => {
    for (const path of ['/api/patients', '/api/encounters', '/api/analytics/summary', '/api/audit-logs', '/api/users']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
    }
  });

  it('lets nurses create encounters but not edit or delete them, and audits the attempt', async () => {
    const enc = await createEncounter(nurse.auth, patient.id);

    const put = await request(app)
      .put(`/api/encounters/${enc.id}`)
      .set(nurse.auth)
      .send({ ...enc, version: enc.version });
    const del = await request(app).delete(`/api/encounters/${enc.id}`).set(nurse.auth).send({ reason: 'mistake' });

    expect(put.status).toBe(403);
    expect(del.status).toBe(403);
    const denied = await auditRows('ACCESS_DENIED');
    expect(denied).toHaveLength(2);
    expect(denied[0].user_id).toBe(nurse.user.id);
  });

  it('shows nurses only the encounters they entered', async () => {
    const mine = await createEncounter(nurse.auth, patient.id);
    const doctors = await createEncounter(doctor.auth, patient.id);

    const list = await request(app).get('/api/encounters').set(nurse.auth);
    expect(list.body.data.map((e) => e.id)).toEqual([mine.id]);

    const other = await request(app).get(`/api/encounters/${doctors.id}`).set(nurse.auth);
    expect(other.status).toBe(403);

    const doctorList = await request(app).get('/api/encounters').set(doctor.auth);
    expect(doctorList.body.total).toBe(2);
  });

  it('gives admins aggregated analytics but no access to individual records', async () => {
    await createEncounter(doctor.auth, patient.id);
    expect((await request(app).get('/api/analytics/summary').set(admin.auth)).status).toBe(200);
    expect((await request(app).get('/api/encounters').set(admin.auth)).status).toBe(403);
    expect((await request(app).get('/api/patients').set(admin.auth)).status).toBe(403);
  });

  it('restricts audit logs and user management to admins', async () => {
    expect((await request(app).get('/api/audit-logs').set(doctor.auth)).status).toBe(403);
    expect((await request(app).get('/api/users').set(nurse.auth)).status).toBe(403);
    expect((await request(app).get('/api/audit-logs').set(admin.auth)).status).toBe(200);
  });

  it('keeps nurses out of analytics', async () => {
    expect((await request(app).get('/api/analytics/summary').set(nurse.auth)).status).toBe(403);
  });

  it('applies a role change immediately, without waiting for the token to expire', async () => {
    const promote = await request(app).patch(`/api/users/${nurse.user.id}`).set(admin.auth).send({ role: 'DOCTOR' });
    expect(promote.status).toBe(200);
    // Same (old) access token now carries doctor permissions, because the role is read from the DB.
    expect((await request(app).get('/api/analytics/summary').set(nurse.auth)).status).toBe(200);
  });

  it('stops an admin from deactivating themselves', async () => {
    const res = await request(app).patch(`/api/users/${admin.user.id}`).set(admin.auth).send({ isActive: false });
    expect(res.status).toBe(400);
  });
});

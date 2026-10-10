import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { audit, diff, snapshot } from '../lib/audit.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { can } from '../lib/permissions.js';
import { ageBand } from '../lib/pseudonym.js';
import { isoDate, pagination, todayIST, uuidParam } from '../lib/schemas.js';
import { authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// API field (camelCase) -> column (snake_case) for every client-editable field.
const FIELDS = {
  encounterDate: 'encounter_date',
  encounterType: 'encounter_type',
  facility: 'facility',
  symptoms: 'symptoms',
  diagnosisCode: 'diagnosis_code',
  diagnosisNotes: 'diagnosis_notes',
  treatment: 'treatment',
  temperatureC: 'temperature_c',
  systolicBp: 'systolic_bp',
  diastolicBp: 'diastolic_bp',
  pulseBpm: 'pulse_bpm',
  spo2Pct: 'spo2_pct',
  bloodGlucoseMgdl: 'blood_glucose_mgdl',
  weightKg: 'weight_kg',
  followUpDate: 'follow_up_date',
};
const COLUMNS = Object.values(FIELDS);

const optionalNumber = (min, max, label, { int = true } = {}) => {
  let n = z.number({ message: `${label} must be a number` });
  if (int) n = n.int(`${label} must be a whole number`);
  return n.min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`).nullable().optional();
};
const optionalText = z
  .string()
  .trim()
  .max(2000)
  .transform((s) => s || null)
  .nullable()
  .optional();

const shape = {
  encounterDate: isoDate,
  encounterType: z.enum(['IN_PERSON', 'TELECONSULT']).default('IN_PERSON'),
  facility: z.string().trim().min(2).max(120).optional(),
  symptoms: z
    .array(z.string().trim().min(1).max(80))
    .min(1, 'Record at least one symptom')
    .max(20)
    .transform((list) => [...new Set(list.map((s) => s.toLowerCase()))]),
  diagnosisCode: z.string().trim().toUpperCase().min(1, 'Diagnosis is required').max(40),
  diagnosisNotes: optionalText,
  treatment: optionalText,
  temperatureC: optionalNumber(30, 45, 'Temperature', { int: false }),
  systolicBp: optionalNumber(50, 300, 'Systolic BP'),
  diastolicBp: optionalNumber(30, 200, 'Diastolic BP'),
  pulseBpm: optionalNumber(20, 250, 'Pulse'),
  spo2Pct: optionalNumber(50, 100, 'SpO2'),
  bloodGlucoseMgdl: optionalNumber(20, 800, 'Blood glucose'),
  weightKg: optionalNumber(0.5, 300, 'Weight', { int: false }),
  followUpDate: isoDate.nullable().optional(),
};

// Cross-field rules shared by create and update.
function clinicalRules(v, ctx) {
  if (v.encounterDate > todayIST()) {
    ctx.addIssue({ code: 'custom', path: ['encounterDate'], message: 'Encounter date cannot be in the future' });
  }
  if (v.encounterDate < '2000-01-01') {
    ctx.addIssue({ code: 'custom', path: ['encounterDate'], message: 'Encounter date is too far in the past' });
  }
  if (v.followUpDate && v.followUpDate < v.encounterDate) {
    ctx.addIssue({ code: 'custom', path: ['followUpDate'], message: 'Follow-up cannot be before the encounter' });
  }
  if ((v.systolicBp == null) !== (v.diastolicBp == null)) {
    ctx.addIssue({ code: 'custom', path: ['diastolicBp'], message: 'Enter both systolic and diastolic BP' });
  } else if (v.systolicBp != null && v.systolicBp <= v.diastolicBp) {
    ctx.addIssue({ code: 'custom', path: ['diastolicBp'], message: 'Diastolic BP must be lower than systolic' });
  }
}

const createSchema = z
  .object({ patientId: z.uuid({ message: 'Select a patient' }), ...shape })
  .strict()
  .superRefine(clinicalRules);

const updateSchema = z
  .object({ version: z.number().int().positive(), ...shape })
  .strict()
  .superRefine(clinicalRules);

const deleteSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason for deleting').max(500) }).strict();

const listSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    diagnosis: z.string().trim().toUpperCase().max(40).optional(),
    patientId: z.uuid().optional(),
    district: z.string().trim().max(80).optional(),
    sort: z.enum(['encounter_date', '-encounter_date', 'created_at', '-created_at']).default('-encounter_date'),
    ...pagination,
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { path: ['from'], message: '"from" must be on or before "to"' });

const SELECT = `
  SELECT e.*, p.pseudo_id, p.birth_year, p.sex, p.district,
         d.label AS diagnosis_label,
         cu.full_name AS created_by_name, uu.full_name AS updated_by_name
    FROM encounters e
    JOIN patients p ON p.id = e.patient_id
    JOIN diagnosis_categories d ON d.code = e.diagnosis_code
    JOIN users cu ON cu.id = e.created_by
    LEFT JOIN users uu ON uu.id = e.updated_by`;

function toDto(row) {
  const dto = {
    id: row.id,
    patient: {
      id: row.patient_id,
      pseudoId: row.pseudo_id,
      sex: row.sex,
      ageBand: ageBand(row.birth_year, new Date(`${row.encounter_date}T00:00:00Z`)),
      ageAtEncounter: Number(row.encounter_date.slice(0, 4)) - row.birth_year,
      district: row.district,
    },
    diagnosisLabel: row.diagnosis_label,
    version: row.version,
    createdBy: { id: row.created_by, name: row.created_by_name },
    updatedBy: row.updated_by ? { id: row.updated_by, name: row.updated_by_name } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  for (const [field, column] of Object.entries(FIELDS)) dto[field] = row[column];
  return dto;
}

async function assertDiagnosisExists(code) {
  const { rowCount } = await query('SELECT 1 FROM diagnosis_categories WHERE code = $1', [code]);
  if (!rowCount) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', [
      { field: 'diagnosisCode', message: 'Unknown diagnosis category' },
    ]);
  }
}

async function loadOne(id) {
  const { rows } = await query(`${SELECT} WHERE e.id = $1 AND e.deleted_at IS NULL`, [id]);
  return rows[0];
}

/** Nurses may only read encounters they entered themselves. */
async function assertCanRead(req, row) {
  if (can(req.user.role, 'encounter:read:any') || row.created_by === req.user.id) return;
  await audit(req, {
    action: 'ACCESS_DENIED',
    entityType: 'encounter',
    entityId: row.id,
    changes: { permission: 'encounter:read:any', method: req.method, path: req.originalUrl },
  });
  throw forbidden('You can only view encounters you recorded');
}

router.get('/', authorize('encounter:read:own', 'encounter:read:any'), validate(listSchema, 'query'), async (req, res) => {
  const f = req.valid.query;
  const where = ['e.deleted_at IS NULL'];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (!can(req.user.role, 'encounter:read:any')) add('e.created_by = ?', req.user.id);
  if (f.from) add('e.encounter_date >= ?', f.from);
  if (f.to) add('e.encounter_date <= ?', f.to);
  if (f.diagnosis) add('e.diagnosis_code = ?', f.diagnosis);
  if (f.patientId) add('e.patient_id = ?', f.patientId);
  if (f.district) add('p.district = ?', f.district);

  const whereSql = `WHERE ${where.join(' AND ')}`;
  // `sort` is from a fixed enum, so interpolating it is safe.
  const orderSql = `${f.sort.replace('-', '')} ${f.sort.startsWith('-') ? 'DESC' : 'ASC'}, e.created_at DESC`;

  const total = (
    await query(`SELECT count(*) AS n FROM encounters e JOIN patients p ON p.id = e.patient_id ${whereSql}`, params)
  ).rows[0].n;
  const { rows } = await query(
    `${SELECT} ${whereSql} ORDER BY e.${orderSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.pageSize, (f.page - 1) * f.pageSize],
  );
  res.json({ data: rows.map(toDto), page: f.page, pageSize: f.pageSize, total });
});

router.get('/:id', authorize('encounter:read:own', 'encounter:read:any'), validate(uuidParam, 'params'), async (req, res) => {
  const row = await loadOne(req.valid.params.id);
  if (!row) throw notFound('Encounter');
  await assertCanRead(req, row);
  res.json({ data: toDto(row) });
});

router.post('/', authorize('encounter:create'), validate(createSchema), async (req, res) => {
  const b = req.valid.body;
  await assertDiagnosisExists(b.diagnosisCode);
  const patient = (await query('SELECT id FROM patients WHERE id = $1', [b.patientId])).rows[0];
  if (!patient) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', [
      { field: 'patientId', message: 'Patient not found' },
    ]);
  }

  const values = { ...b, facility: b.facility ?? req.user.facility ?? 'Unspecified' };
  const id = await withTransaction(async (db) => {
    const cols = ['patient_id', 'created_by', ...COLUMNS];
    const vals = [b.patientId, req.user.id, ...Object.keys(FIELDS).map((f) => values[f] ?? null)];
    const { rows } = await db.query(
      `INSERT INTO encounters (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      vals,
    );
    await audit(
      req,
      { action: 'CREATE', entityType: 'encounter', entityId: rows[0].id, changes: snapshot(rows[0], ['patient_id', ...COLUMNS]) },
      db,
    );
    return rows[0].id;
  });

  publish('encounter.created', { id });
  res.status(201).json({ data: toDto(await loadOne(id)) });
});

router.put('/:id', authorize('encounter:update'), validate(uuidParam, 'params'), validate(updateSchema), async (req, res) => {
  const { id } = req.valid.params;
  const { version, ...b } = req.valid.body;
  await assertDiagnosisExists(b.diagnosisCode);

  await withTransaction(async (db) => {
    const before = (
      await db.query('SELECT * FROM encounters WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id])
    ).rows[0];
    if (!before) throw notFound('Encounter');
    if (before.version !== version) {
      // Someone else saved first. Return the latest copy so the client can show what changed.
      throw conflict(
        'This encounter was changed by someone else after you opened it. Review the latest version and re-apply your edits.',
        { current: toDto(await loadOne(id)) },
        'VERSION_CONFLICT',
      );
    }

    const values = { ...b, facility: b.facility ?? before.facility };
    const sets = COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const { rows } = await db.query(
      `UPDATE encounters SET ${sets}, version = version + 1, updated_by = $${COLUMNS.length + 2}, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, ...Object.keys(FIELDS).map((f) => values[f] ?? null), req.user.id],
    );
    const changes = diff(before, rows[0], COLUMNS);
    await audit(req, { action: 'UPDATE', entityType: 'encounter', entityId: id, changes }, db);
  });

  publish('encounter.updated', { id });
  res.json({ data: toDto(await loadOne(id)) });
});

router.delete('/:id', authorize('encounter:delete'), validate(uuidParam, 'params'), validate(deleteSchema), async (req, res) => {
  const { id } = req.valid.params;
  await withTransaction(async (db) => {
    const { rows } = await db.query(
      `UPDATE encounters SET deleted_at = now(), deleted_by = $2, delete_reason = $3
        WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id, req.user.id, req.valid.body.reason],
    );
    if (!rows[0]) throw notFound('Encounter');
    await audit(req, { action: 'DELETE', entityType: 'encounter', entityId: id, changes: { reason: req.valid.body.reason } }, db);
  });
  publish('encounter.deleted', { id });
  res.status(204).end();
});

export default router;

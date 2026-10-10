import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { audit, snapshot } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { ageBand, generatePseudoId, hashExternalRef } from '../lib/pseudonym.js';
import { pagination, uuidParam } from '../lib/schemas.js';
import { authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const currentYear = () => new Date().getUTCFullYear();

const createSchema = z
  .object({
    birthYear: z.number().int().refine((y) => y >= currentYear() - 120 && y <= currentYear(), 'Birth year is out of range'),
    sex: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']),
    district: z.string().trim().min(2).max(80),
    block: z.string().trim().min(1).max(80).nullable().optional(),
    // Aadhaar / ABHA / phone. Used only to detect duplicates; never stored.
    externalRef: z.string().trim().min(4).max(64).nullable().optional(),
  })
  .strict();

const listSchema = z.object({
  q: z.string().trim().max(64).optional(),
  district: z.string().trim().max(80).optional(),
  ...pagination,
});

const SELECT = `
  SELECT p.id, p.pseudo_id, p.birth_year, p.sex, p.district, p.block, p.created_at,
         (SELECT count(*) FROM encounters e WHERE e.patient_id = p.id AND e.deleted_at IS NULL) AS encounter_count,
         (SELECT max(encounter_date) FROM encounters e WHERE e.patient_id = p.id AND e.deleted_at IS NULL) AS last_encounter_date
    FROM patients p`;

const toDto = (p) => ({
  id: p.id,
  pseudoId: p.pseudo_id,
  birthYear: p.birth_year,
  ageBand: ageBand(p.birth_year),
  sex: p.sex,
  district: p.district,
  block: p.block,
  encounterCount: p.encounter_count ?? 0,
  lastEncounterDate: p.last_encounter_date ?? null,
  createdAt: p.created_at,
});

router.get('/', authorize('patient:read'), validate(listSchema, 'query'), async (req, res) => {
  const { q, district, page, pageSize } = req.valid.query;
  const where = [];
  const params = [];
  if (q) {
    // Match a pseudo ID prefix, or an exact external reference via its HMAC.
    params.push(`${q.toUpperCase().replace(/[%_\\]/g, '')}%`, hashExternalRef(q));
    where.push(`(p.pseudo_id LIKE $${params.length - 1} OR p.external_ref_hash = $${params.length})`);
  }
  if (district) {
    params.push(district);
    where.push(`p.district = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await query(`SELECT count(*) AS n FROM patients p ${whereSql}`, params)).rows[0].n;
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(
    `${SELECT} ${whereSql} ORDER BY p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ data: rows.map(toDto), page, pageSize, total });
});

router.get('/:id', authorize('patient:read'), validate(uuidParam, 'params'), async (req, res) => {
  const { rows } = await query(`${SELECT} WHERE p.id = $1`, [req.valid.params.id]);
  if (!rows[0]) throw notFound('Patient');
  res.json({ data: toDto(rows[0]) });
});

router.post('/', authorize('patient:create'), validate(createSchema), async (req, res) => {
  const b = req.valid.body;
  const refHash = b.externalRef ? hashExternalRef(b.externalRef) : null;

  if (refHash) {
    const existing = (await query('SELECT id, pseudo_id FROM patients WHERE external_ref_hash = $1', [refHash])).rows[0];
    if (existing) {
      throw conflict(
        'This patient is already registered',
        { id: existing.id, pseudoId: existing.pseudo_id },
        'PATIENT_EXISTS',
      );
    }
  }

  const patient = await withTransaction(async (db) => {
    // 32^8 ids make a collision vanishingly rare, but retry rather than fail.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { rows } = await db.query(
        `INSERT INTO patients (pseudo_id, external_ref_hash, birth_year, sex, district, block, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (pseudo_id) DO NOTHING
         RETURNING *`,
        [generatePseudoId(), refHash, b.birthYear, b.sex, b.district, b.block ?? null, req.user.id],
      );
      if (rows[0]) {
        await audit(
          req,
          {
            action: 'CREATE',
            entityType: 'patient',
            entityId: rows[0].id,
            changes: snapshot(rows[0], ['pseudo_id', 'birth_year', 'sex', 'district', 'block']),
          },
          db,
        );
        return rows[0];
      }
    }
    throw new Error('Could not allocate a unique pseudo ID');
  });

  publish('patient.created', { id: patient.id });
  res.status(201).json({ data: toDto(patient) });
});

export default router;

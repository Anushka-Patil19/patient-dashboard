import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

// Reference data for forms and filters. No clinical data.
router.get('/', async (_req, res) => {
  const [diagnoses, districts] = await Promise.all([
    query('SELECT code, label, is_communicable FROM diagnosis_categories ORDER BY label'),
    query('SELECT DISTINCT district FROM patients ORDER BY district'),
  ]);
  res.json({
    diagnoses: diagnoses.rows.map((d) => ({ code: d.code, label: d.label, communicable: d.is_communicable })),
    districts: districts.rows.map((d) => d.district),
    sexes: ['FEMALE', 'MALE', 'OTHER', 'UNKNOWN'],
    encounterTypes: ['IN_PERSON', 'TELECONSULT'],
  });
});

export default router;

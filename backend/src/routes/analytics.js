import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { addDays, daysBetween, isoDate, todayIST } from '../lib/schemas.js';
import { authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(authorize('analytics:read'));

const MAX_RANGE_DAYS = 3 * 366;

const summarySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    granularity: z.enum(['auto', 'day', 'week', 'month']).default('auto'),
    district: z.string().trim().max(80).optional(),
    diagnosis: z.string().trim().toUpperCase().max(40).optional(),
  })
  .transform((v) => {
    const to = v.to ?? todayIST();
    const from = v.from ?? addDays(to, -89);
    return { ...v, from, to };
  })
  .superRefine((v, ctx) => {
    if (v.from > v.to) ctx.addIssue({ code: 'custom', path: ['from'], message: '"from" must be on or before "to"' });
    if (daysBetween(v.from, v.to) > MAX_RANGE_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'Date range cannot exceed 3 years' });
    }
  });

function pickGranularity({ granularity, from, to }) {
  if (granularity !== 'auto') return granularity;
  const days = daysBetween(from, to);
  if (days <= 45) return 'day';
  if (days <= 200) return 'week';
  return 'month';
}

const AGE_BAND_SQL = `
  CASE
    WHEN extract(year FROM e.encounter_date) - p.birth_year < 5  THEN '0-4'
    WHEN extract(year FROM e.encounter_date) - p.birth_year < 15 THEN '5-14'
    WHEN extract(year FROM e.encounter_date) - p.birth_year < 25 THEN '15-24'
    WHEN extract(year FROM e.encounter_date) - p.birth_year < 45 THEN '25-44'
    WHEN extract(year FROM e.encounter_date) - p.birth_year < 60 THEN '45-59'
    ELSE '60+'
  END`;
const AGE_BANDS = ['0-4', '5-14', '15-24', '25-44', '45-59', '60+'];

router.get('/summary', validate(summarySchema, 'query'), async (req, res) => {
  const f = req.valid.query;
  const granularity = pickGranularity(f);

  // $1 from, $2 to, $3 district|null, $4 diagnosis|null - shared by every query below.
  const base = `
    FROM encounters e
    JOIN patients p ON p.id = e.patient_id
    JOIN diagnosis_categories d ON d.code = e.diagnosis_code
   WHERE e.deleted_at IS NULL
     AND e.encounter_date BETWEEN $1::date AND $2::date
     AND ($3::text IS NULL OR p.district = $3)
     AND ($4::text IS NULL OR e.diagnosis_code = $4)`;
  const params = [f.from, f.to, f.district ?? null, f.diagnosis ?? null];

  // Equal-length window immediately before the selected one, for "vs previous period".
  const span = daysBetween(f.from, f.to) + 1;
  const prevParams = [addDays(f.from, -span), addDays(f.from, -1), params[2], params[3]];

  const [totals, previous, trend, byDiagnosis, byAge, bySex, byDistrict, followUps] = await Promise.all([
    query(
      `SELECT count(*) AS encounters,
              count(DISTINCT e.patient_id) AS patients,
              count(*) FILTER (WHERE d.is_communicable) AS communicable,
              count(*) FILTER (WHERE e.encounter_type = 'TELECONSULT') AS teleconsults,
              count(*) FILTER (WHERE e.blood_glucose_mgdl >= 200) AS high_glucose,
              count(*) FILTER (WHERE e.systolic_bp >= 140 OR e.diastolic_bp >= 90) AS high_bp,
              count(*) FILTER (WHERE e.temperature_c >= 38) AS fever,
              count(*) FILTER (WHERE e.spo2_pct < 94) AS low_spo2
         ${base}`,
      params,
    ),
    query(`SELECT count(*) AS encounters ${base}`, prevParams),
    query(
      `WITH periods AS (
         SELECT generate_series(date_trunc($5, $1::date), $2::date, ('1 ' || $5)::interval)::date AS period
       ),
       counts AS (
         SELECT date_trunc($5, e.encounter_date)::date AS period, e.diagnosis_code, count(*) AS n
           ${base}
          GROUP BY 1, 2
       )
       SELECT to_char(pr.period, 'YYYY-MM-DD') AS period, c.diagnosis_code, coalesce(c.n, 0) AS n
         FROM periods pr LEFT JOIN counts c ON c.period = pr.period
        ORDER BY pr.period`,
      [...params, granularity],
    ),
    query(
      `SELECT d.code, d.label, d.is_communicable, count(*) AS count ${base}
        GROUP BY d.code, d.label, d.is_communicable ORDER BY count DESC, d.label`,
      params,
    ),
    query(`SELECT ${AGE_BAND_SQL} AS band, count(*) AS count ${base} GROUP BY 1`, params),
    query(`SELECT p.sex, count(*) AS count ${base} GROUP BY 1 ORDER BY 2 DESC`, params),
    query(`SELECT p.district, count(*) AS count ${base} GROUP BY 1 ORDER BY 2 DESC, 1`, params),
    // Not tied to the selected range: what is coming up for the clinic team.
    query(
      `SELECT count(*) AS n FROM encounters e JOIN patients p ON p.id = e.patient_id
        WHERE e.deleted_at IS NULL AND e.follow_up_date BETWEEN $1::date AND $1::date + 7
          AND ($2::text IS NULL OR p.district = $2)`,
      [todayIST(), params[2]],
    ),
  ]);

  // Pivot (period, diagnosis, n) rows into one object per period for charting.
  const series = new Map();
  for (const r of trend.rows) {
    if (!series.has(r.period)) series.set(r.period, { period: r.period, total: 0 });
    if (r.diagnosis_code) {
      const point = series.get(r.period);
      point[r.diagnosis_code] = r.n;
      point.total += r.n;
    }
  }

  const ageCounts = Object.fromEntries(byAge.rows.map((r) => [r.band, r.count]));
  const t = totals.rows[0];

  res.json({
    range: { from: f.from, to: f.to, granularity, district: f.district ?? null, diagnosis: f.diagnosis ?? null },
    totals: {
      encounters: t.encounters,
      patients: t.patients,
      communicable: t.communicable,
      teleconsults: t.teleconsults,
      previousPeriodEncounters: previous.rows[0].encounters,
      followUpsNext7Days: followUps.rows[0].n,
    },
    riskFlags: { highGlucose: t.high_glucose, highBp: t.high_bp, fever: t.fever, lowSpo2: t.low_spo2 },
    trend: [...series.values()],
    byDiagnosis: byDiagnosis.rows.map((r) => ({ code: r.code, label: r.label, communicable: r.is_communicable, count: r.count })),
    byAgeBand: AGE_BANDS.map((band) => ({ band, count: ageCounts[band] ?? 0 })),
    bySex: bySex.rows,
    byDistrict: byDistrict.rows,
  });
});

export default router;

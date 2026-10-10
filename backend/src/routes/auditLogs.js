import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { isoDate, pagination } from '../lib/schemas.js';
import { authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(authorize('audit:read'));

export const AUDIT_ACTIONS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'REFRESH_TOKEN_REUSE',
  'CREATE',
  'UPDATE',
  'DELETE',
  'ACCESS_DENIED',
];

const listSchema = z.object({
  action: z.enum(AUDIT_ACTIONS).optional(),
  entityType: z.enum(['encounter', 'patient', 'user']).optional(),
  entityId: z.string().trim().max(64).optional(),
  userId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...pagination,
});

router.get('/', validate(listSchema, 'query'), async (req, res) => {
  const f = req.valid.query;
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.action) add('action = ?', f.action);
  if (f.entityType) add('entity_type = ?', f.entityType);
  if (f.entityId) add('entity_id = ?', f.entityId);
  if (f.userId) add('user_id = ?', f.userId);
  // Dates are interpreted in IST to match what clinic staff see on screen.
  if (f.from) add(`occurred_at >= (?::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`, f.from);
  if (f.to) add(`occurred_at < ((?::date) + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'`, f.to);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (await query(`SELECT count(*) AS n FROM audit_logs ${whereSql}`, params)).rows[0].n;
  const { rows } = await query(
    `SELECT id, occurred_at, user_id, user_email, user_role, action, entity_type, entity_id, changes, ip, user_agent, request_id
       FROM audit_logs ${whereSql}
      ORDER BY occurred_at DESC, id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.pageSize, (f.page - 1) * f.pageSize],
  );

  res.json({
    data: rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurred_at,
      user: r.user_id || r.user_email ? { id: r.user_id, email: r.user_email, role: r.user_role } : null,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      changes: r.changes,
      ip: r.ip,
      userAgent: r.user_agent,
      requestId: r.request_id,
    })),
    page: f.page,
    pageSize: f.pageSize,
    total,
  });
});

export default router;

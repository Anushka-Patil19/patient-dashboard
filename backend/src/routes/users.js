import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { audit, diff } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { ROLES } from '../lib/permissions.js';
import { passwordSchema, uuidParam } from '../lib/schemas.js';
import { authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

// No public sign-up: in a clinical system accounts are provisioned by an admin.
const router = Router();
router.use(authorize('user:manage'));

const USER_COLUMNS = 'id, email, full_name, role, facility, is_active, last_login_at, locked_until, created_at';
const toDto = (u) => ({
  id: u.id,
  email: u.email,
  fullName: u.full_name,
  role: u.role,
  facility: u.facility,
  isActive: u.is_active,
  lastLoginAt: u.last_login_at,
  lockedUntil: u.locked_until,
  createdAt: u.created_at,
});

const createSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    fullName: z.string().trim().min(2).max(120),
    role: z.enum(ROLES),
    facility: z.string().trim().min(2).max(120).nullable().optional(),
    password: passwordSchema,
  })
  .strict();

const updateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    role: z.enum(ROLES).optional(),
    facility: z.string().trim().min(2).max(120).nullable().optional(),
    isActive: z.boolean().optional(),
    password: passwordSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

router.get('/', async (_req, res) => {
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users ORDER BY role, full_name`);
  res.json({ data: rows.map(toDto) });
});

router.post('/', validate(createSchema), async (req, res) => {
  const b = req.valid.body;
  const hash = await bcrypt.hash(b.password, config.bcryptRounds);
  const user = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO users (email, full_name, password_hash, role, facility)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${USER_COLUMNS}`,
      [b.email, b.fullName, hash, b.role, b.facility ?? null],
    );
    await audit(
      req,
      { action: 'CREATE', entityType: 'user', entityId: rows[0].id, changes: diff({}, rows[0], ['email', 'role', 'facility']) },
      db,
    );
    return rows[0];
  });
  res.status(201).json({ data: toDto(user) });
});

router.patch('/:id', validate(uuidParam, 'params'), validate(updateSchema), async (req, res) => {
  const { id } = req.valid.params;
  const b = req.valid.body;

  if (id === req.user.id && (b.isActive === false || (b.role && b.role !== 'ADMIN'))) {
    throw badRequest('You cannot deactivate or demote your own account');
  }

  const user = await withTransaction(async (db) => {
    const before = (await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!before) throw notFound('User');

    const hash = b.password ? await bcrypt.hash(b.password, config.bcryptRounds) : null;
    const { rows } = await db.query(
      `UPDATE users SET
         full_name = COALESCE($2, full_name),
         role      = COALESCE($3, role),
         facility  = CASE WHEN $4::boolean THEN $5 ELSE facility END,
         is_active = COALESCE($6, is_active),
         password_hash = COALESCE($7, password_hash),
         -- an admin password reset also clears any lockout
         failed_login_attempts = CASE WHEN $7 IS NULL THEN failed_login_attempts ELSE 0 END,
         locked_until          = CASE WHEN $7 IS NULL THEN locked_until ELSE NULL END,
         updated_at = now()
       WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, b.fullName ?? null, b.role ?? null, 'facility' in b, b.facility ?? null, b.isActive ?? null, hash],
    );

    // Deactivation, role change or password reset ends every existing session.
    if (b.isActive === false || b.password || (b.role && b.role !== before.role)) {
      await db.query(
        `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'ADMIN'
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [id],
      );
    }

    const changes = diff(before, rows[0], ['full_name', 'role', 'facility', 'is_active']);
    if (b.password) changes.password = { changed: true };
    await audit(req, { action: 'UPDATE', entityType: 'user', entityId: id, changes }, db);
    return rows[0];
  });

  res.json({ data: toDto(user) });
});

export default router;

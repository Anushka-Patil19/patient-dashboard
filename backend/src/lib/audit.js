import { query } from '../db/pool.js';

// Free-text clinical fields: the audit trail records *that* they changed, not
// their content, so admins reading the audit log never see clinical narrative.
const REDACTED_FIELDS = new Set(['diagnosis_notes', 'treatment', 'symptoms', 'delete_reason']);

export function diff(before, after, fields) {
  const changes = {};
  for (const field of fields) {
    const a = before?.[field] ?? null;
    const b = after?.[field] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    changes[field] = REDACTED_FIELDS.has(field) ? { changed: true } : { from: a, to: b };
  }
  return changes;
}

export function snapshot(record, fields) {
  return diff({}, record, fields);
}

/**
 * Append an audit entry. `db` may be a transaction client so the audit row
 * commits atomically with the change it describes.
 */
export async function audit(req, { action, entityType = null, entityId = null, changes = null, user }, db) {
  const actor = user ?? req.user ?? null;
  await (db ?? { query }).query(
    `INSERT INTO audit_logs
       (user_id, user_email, user_role, action, entity_type, entity_id, changes, ip, user_agent, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      actor?.id ?? null,
      actor?.email ?? null,
      actor?.role ?? null,
      action,
      entityType,
      entityId == null ? null : String(entityId),
      changes ? JSON.stringify(changes) : null,
      req.ip ?? null,
      req.get?.('user-agent')?.slice(0, 300) ?? null,
      req.id ?? null,
    ],
  );
}

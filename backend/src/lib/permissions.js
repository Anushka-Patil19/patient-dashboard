// Single source of truth for role-based access control.
// Routes check permissions, never roles, so changing who may do what is a one-line edit here.
export const ROLES = ['ADMIN', 'DOCTOR', 'NURSE'];

const MATRIX = {
  'patient:create': ['DOCTOR', 'NURSE'],
  'patient:read': ['DOCTOR', 'NURSE'],
  'encounter:create': ['DOCTOR', 'NURSE'],
  // Nurses enter data and may review what they entered; doctors see everything.
  'encounter:read:own': ['DOCTOR', 'NURSE'],
  'encounter:read:any': ['DOCTOR'],
  'encounter:update': ['DOCTOR'],
  'encounter:delete': ['DOCTOR'],
  // Admins analyse aggregated trends but cannot open individual clinical records.
  'analytics:read': ['DOCTOR', 'ADMIN'],
  'audit:read': ['ADMIN'],
  'user:manage': ['ADMIN'],
};

export const PERMISSIONS = Object.keys(MATRIX);

export function can(role, permission) {
  const allowed = MATRIX[permission];
  if (!allowed) throw new Error(`Unknown permission ${permission}`);
  return allowed.includes(role);
}

export function permissionsFor(role) {
  return PERMISSIONS.filter((p) => MATRIX[p].includes(role));
}

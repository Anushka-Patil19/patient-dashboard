const IST = 'Asia/Kolkata';

export const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date());

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(`${dateStr.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: IST,
  });
}

export function formatPeriod(period, granularity) {
  const d = new Date(`${period}T00:00:00Z`);
  if (granularity === 'month') return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export const formatNumber = (n) => (n == null ? '—' : new Intl.NumberFormat('en-IN').format(n));

export function percent(part, whole) {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

export const SEX_LABEL = { FEMALE: 'Female', MALE: 'Male', OTHER: 'Other', UNKNOWN: 'Unknown' };
export const SEX_SHORT = { FEMALE: 'F', MALE: 'M', OTHER: 'O', UNKNOWN: '?' };
export const ROLE_LABEL = { ADMIN: 'Administrator', DOCTOR: 'Doctor', NURSE: 'Nurse' };
export const TYPE_LABEL = { IN_PERSON: 'In person', TELECONSULT: 'Teleconsult' };

import { z } from 'zod';

export const uuidParam = z.object({ id: z.uuid({ message: 'Invalid id' }) });

export const isoDate = z.iso.date({ message: 'Use YYYY-MM-DD format' });

export const pagination = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

/** Today's date (YYYY-MM-DD) in India, where the clinics operate. */
export function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200)
  .regex(/[a-z]/i, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

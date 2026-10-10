// Client-side checks mirror the API's rules for instant feedback. The server
// remains the authority: its field errors are merged into the same map.
import { todayIST } from './format.js';

const RANGES = {
  temperatureC: [30, 45, 'Temperature', false],
  systolicBp: [50, 300, 'Systolic BP', true],
  diastolicBp: [30, 200, 'Diastolic BP', true],
  pulseBpm: [20, 250, 'Pulse', true],
  spo2Pct: [50, 100, 'SpO2', true],
  bloodGlucoseMgdl: [20, 800, 'Blood glucose', true],
  weightKg: [0.5, 300, 'Weight', false],
};

export const VITAL_FIELDS = Object.keys(RANGES);

/** Converts form strings to the API payload shape (numbers / nulls). */
export function toEncounterPayload(form) {
  const payload = {
    encounterDate: form.encounterDate,
    encounterType: form.encounterType,
    facility: form.facility?.trim() || undefined,
    symptoms: form.symptoms,
    diagnosisCode: form.diagnosisCode,
    diagnosisNotes: form.diagnosisNotes?.trim() || null,
    treatment: form.treatment?.trim() || null,
    followUpDate: form.followUpDate || null,
  };
  for (const field of VITAL_FIELDS) {
    const raw = String(form[field] ?? '').trim();
    payload[field] = raw === '' ? null : Number(raw);
  }
  return payload;
}

export function validateEncounter(form, { requirePatient = true } = {}) {
  const errors = {};
  const p = toEncounterPayload(form);

  if (requirePatient && !form.patientId) errors.patientId = 'Select or register a patient';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.encounterDate || '')) errors.encounterDate = 'Enter the encounter date';
  else if (p.encounterDate > todayIST()) errors.encounterDate = 'Encounter date cannot be in the future';
  if (!p.symptoms?.length) errors.symptoms = 'Record at least one symptom';
  if (!p.diagnosisCode) errors.diagnosisCode = 'Diagnosis is required';

  for (const [field, [min, max, label, int]] of Object.entries(RANGES)) {
    const v = p[field];
    if (v === null) continue;
    if (Number.isNaN(v)) errors[field] = `${label} must be a number`;
    else if (int && !Number.isInteger(v)) errors[field] = `${label} must be a whole number`;
    else if (v < min || v > max) errors[field] = `${label} must be between ${min} and ${max}`;
  }

  if (!errors.systolicBp && !errors.diastolicBp) {
    if ((p.systolicBp === null) !== (p.diastolicBp === null)) errors.diastolicBp = 'Enter both systolic and diastolic BP';
    else if (p.systolicBp !== null && p.systolicBp <= p.diastolicBp) errors.diastolicBp = 'Diastolic BP must be lower than systolic';
  }
  if (p.followUpDate && p.encounterDate && p.followUpDate < p.encounterDate) {
    errors.followUpDate = 'Follow-up cannot be before the encounter';
  }
  return errors;
}

export function validatePatient(form) {
  const errors = {};
  const age = Number(form.age);
  if (String(form.age).trim() === '' || !Number.isInteger(age) || age < 0 || age > 120) errors.age = 'Enter age in years (0–120)';
  if (!form.sex) errors.sex = 'Select sex';
  if (!form.district?.trim() || form.district.trim().length < 2) errors.district = 'District is required';
  if (form.externalRef && form.externalRef.replace(/[^0-9a-z]/gi, '').length < 4) errors.externalRef = 'ID looks too short';
  return errors;
}

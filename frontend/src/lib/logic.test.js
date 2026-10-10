import { describe, expect, it } from 'vitest';
import { addDays, todayIST } from './format.js';
import { initialSeries, toggleSeries } from './seriesSlots.js';
import { toEncounterPayload, validateEncounter, validatePatient } from './validation.js';

const base = {
  patientId: 'p1',
  encounterDate: todayIST(),
  encounterType: 'IN_PERSON',
  symptoms: ['fever'],
  diagnosisCode: 'VIRAL_FEVER',
  temperatureC: '38.2',
  systolicBp: '',
  diastolicBp: '',
};

describe('validateEncounter', () => {
  it('accepts a minimal valid encounter', () => {
    expect(validateEncounter(base)).toEqual({});
  });

  it('flags the same rules as the API', () => {
    const errors = validateEncounter({
      ...base,
      patientId: '',
      encounterDate: addDays(todayIST(), 1),
      symptoms: [],
      diagnosisCode: '',
      temperatureC: '60',
      pulseBpm: '72.5',
      systolicBp: '80',
      diastolicBp: '90',
      followUpDate: addDays(todayIST(), -2),
    });
    expect(Object.keys(errors).sort()).toEqual(
      ['diagnosisCode', 'diastolicBp', 'encounterDate', 'followUpDate', 'patientId', 'pulseBpm', 'symptoms', 'temperatureC'].sort(),
    );
  });

  it('requires both BP values together', () => {
    expect(validateEncounter({ ...base, systolicBp: '120' }).diastolicBp).toMatch(/both/);
  });

  it('converts blank vitals to null and numbers to numbers', () => {
    const p = toEncounterPayload({ ...base, spo2Pct: ' 97 ', diagnosisNotes: '   ' });
    expect(p.temperatureC).toBe(38.2);
    expect(p.spo2Pct).toBe(97);
    expect(p.systolicBp).toBeNull();
    expect(p.diagnosisNotes).toBeNull();
  });
});

describe('validatePatient', () => {
  it('requires age, sex and district', () => {
    expect(Object.keys(validatePatient({ age: '', sex: '', district: ' ' })).sort()).toEqual(['age', 'district', 'sex']);
    expect(validatePatient({ age: '34', sex: 'FEMALE', district: 'Nashik' })).toEqual({});
  });
});

describe('series colour slots', () => {
  it('keeps colours attached to the diagnosis when another is removed', () => {
    let s = initialSeries(['DENGUE', 'MALARIA', 'ARI']);
    s = toggleSeries(s, 'DENGUE'); // remove slot 0
    expect(s).toEqual([
      { code: 'MALARIA', slot: 1 },
      { code: 'ARI', slot: 2 },
    ]);
    s = toggleSeries(s, 'TYPHOID'); // takes the freed slot
    expect(s.find((x) => x.code === 'TYPHOID').slot).toBe(0);
  });

  it('never exceeds three series', () => {
    const s = initialSeries(['A', 'B', 'C']);
    expect(toggleSeries(s, 'D')).toBe(s);
  });
});

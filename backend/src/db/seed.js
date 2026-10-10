// Generates realistic, entirely synthetic demo data: 12 months of encounters
// with seasonal disease patterns typical of rural Maharashtra.
// Usage: npm run seed            (only if the database has no users)
//        npm run seed -- --reset  (wipes all data first)
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { isMain } from '../lib/isMain.js';
import { generatePseudoId } from '../lib/pseudonym.js';
import { addDays, todayIST } from '../lib/schemas.js';
import { migrate } from './migrate.js';
import { pool, withTransaction } from './pool.js';

export const DEMO_PASSWORD = 'Demo@2026!';

const USERS = [
  { email: 'admin@demo.local', name: 'Anita Deshmukh', role: 'ADMIN', facility: 'District Health Office, Nashik' },
  { email: 'doctor@demo.local', name: 'Dr. Rahul Patil', role: 'DOCTOR', facility: 'PHC Trimbakeshwar' },
  { email: 'doctor2@demo.local', name: 'Dr. Sneha Kulkarni', role: 'DOCTOR', facility: 'PHC Jawhar' },
  { email: 'nurse@demo.local', name: 'Meena Gavit', role: 'NURSE', facility: 'PHC Trimbakeshwar' },
  { email: 'nurse2@demo.local', name: 'Sunita Valvi', role: 'NURSE', facility: 'PHC Jawhar' },
];

const DISTRICTS = {
  Nashik: ['Trimbakeshwar', 'Igatpuri', 'Peth'],
  Palghar: ['Jawhar', 'Mokhada', 'Vikramgad'],
  Nandurbar: ['Akkalkuwa', 'Dhadgaon'],
  Gadchiroli: ['Aheri', 'Etapalli'],
};

// Relative weight by month (Jan..Dec) - monsoon vector-borne peaks, winter respiratory peak.
const SEASONALITY = {
  VIRAL_FEVER: [3, 3, 3, 4, 5, 7, 10, 10, 9, 6, 4, 3],
  DENGUE: [0.3, 0.2, 0.2, 0.2, 0.3, 1, 4, 7, 8, 6, 2, 0.5],
  MALARIA: [0.5, 0.5, 0.5, 0.5, 1, 3, 6, 7, 6, 4, 2, 1],
  TYPHOID: [1, 1, 1.5, 2, 3, 3, 3, 3, 2, 1.5, 1, 1],
  TUBERCULOSIS: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  ARI: [8, 7, 4, 2, 1.5, 2, 3, 3, 3, 4, 6, 8],
  DIARRHOEA: [2, 2, 3, 5, 7, 7, 6, 5, 3, 2, 2, 2],
  SKIN_INFECTION: [1.5, 1.5, 2, 3, 3, 2, 2, 2, 2, 1.5, 1.5, 1.5],
  DIABETES: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  HYPERTENSION: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
  ANAEMIA: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
  MATERNAL_CARE: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  INJURY: [2, 2, 2, 2, 2, 3, 3, 3, 2, 2, 2, 2],
  OTHER: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
};

const PROFILES = {
  VIRAL_FEVER: { symptoms: ['fever', 'body ache', 'headache', 'fatigue', 'cough'], temp: [38, 39.5], tx: 'Paracetamol, oral fluids, rest' },
  DENGUE: { symptoms: ['high fever', 'joint pain', 'rash', 'retro-orbital pain', 'nausea'], temp: [38.5, 40.2], tx: 'NS1 positive. Paracetamol, hydration, platelet monitoring' },
  MALARIA: { symptoms: ['fever with chills', 'sweating', 'headache', 'vomiting'], temp: [38.5, 40.5], tx: 'RDT positive. ACT as per NVBDCP protocol' },
  TYPHOID: { symptoms: ['prolonged fever', 'abdominal pain', 'loss of appetite', 'weakness'], temp: [38, 39.5], tx: 'Widal positive. Azithromycin course' },
  TUBERCULOSIS: { symptoms: ['cough > 2 weeks', 'weight loss', 'night sweats', 'haemoptysis'], temp: [37.2, 38.2], tx: 'Sputum sent for CBNAAT. Referred under NTEP' },
  ARI: { symptoms: ['cough', 'cold', 'sore throat', 'breathlessness'], temp: [37, 38.6], spo2: [90, 98], tx: 'Amoxicillin, steam inhalation' },
  DIARRHOEA: { symptoms: ['loose stools', 'vomiting', 'dehydration', 'abdominal cramps'], temp: [36.8, 38], tx: 'ORS, zinc, advise safe drinking water' },
  SKIN_INFECTION: { symptoms: ['itching', 'rash', 'boils'], temp: [36.6, 37.4], tx: 'Topical antifungal, hygiene advice' },
  DIABETES: { symptoms: ['frequent urination', 'excess thirst', 'fatigue'], glucose: [160, 340], tx: 'Metformin, diet counselling' },
  HYPERTENSION: { symptoms: ['headache', 'dizziness'], bp: [[145, 185], [92, 115]], tx: 'Amlodipine, salt restriction' },
  ANAEMIA: { symptoms: ['fatigue', 'pallor', 'breathlessness on exertion'], tx: 'IFA tablets, dietary advice' },
  MATERNAL_CARE: { symptoms: ['routine antenatal check'], tx: 'IFA and calcium, TT given, next ANC scheduled' },
  INJURY: { symptoms: ['wound', 'pain', 'swelling'], tx: 'Wound dressing, TT injection' },
  OTHER: { symptoms: ['general weakness', 'body ache'], tx: 'Symptomatic treatment' },
};

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seed({ reset = false, log = console.log } = {}) {
  await migrate({ log });
  const rand = mulberry32(20260101);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (lo, hi, dp = 0) => Number((lo + rand() * (hi - lo)).toFixed(dp));
  const weighted = (entries) => {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [key, w] of entries) if ((r -= w) <= 0) return key;
    return entries[entries.length - 1][0];
  };

  await withTransaction(async (db) => {
    if (reset) {
      await db.query('TRUNCATE audit_logs, refresh_tokens, encounters, patients, users RESTART IDENTITY CASCADE');
    } else if ((await db.query('SELECT count(*) AS n FROM users')).rows[0].n > 0) {
      throw new Error('Database already has users. Run with --reset to wipe and reseed.');
    }

    const hash = await bcrypt.hash(DEMO_PASSWORD, config.bcryptRounds);
    const users = {};
    for (const u of USERS) {
      const { rows } = await db.query(
        `INSERT INTO users (email, full_name, password_hash, role, facility) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [u.email, u.name, hash, u.role, u.facility],
      );
      users[u.email] = rows[0].id;
    }
    const clinicians = USERS.filter((u) => u.role !== 'ADMIN');

    const thisYear = Number(todayIST().slice(0, 4));
    const patients = [];
    for (let i = 0; i < 220; i += 1) {
      const district = weighted([['Nashik', 4], ['Palghar', 3], ['Nandurbar', 2], ['Gadchiroli', 1.5]]);
      const age = weighted([[2, 1], [9, 1.2], [20, 1.5], [35, 2.2], [52, 2], [68, 1.6]]) + Math.floor(rand() * 10) - 4;
      const creator = pick(clinicians);
      const { rows } = await db.query(
        `INSERT INTO patients (pseudo_id, birth_year, sex, district, block, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, birth_year, sex`,
        [generatePseudoId(), thisYear - Math.max(0, age), rand() < 0.53 ? 'FEMALE' : 'MALE', district, pick(DISTRICTS[district]), users[creator.email]],
      );
      patients.push({ ...rows[0], age, creator });
    }

    const today = todayIST();
    const rows = [];
    for (let back = 364; back >= 0; back -= 1) {
      const date = addDays(today, -back);
      const month = Number(date.slice(5, 7)) - 1;
      const perDay = Math.max(0, Math.round(2 + rand() * 3 + (month >= 6 && month <= 9 ? 2 : 0)));
      for (let k = 0; k < perDay; k += 1) {
        let patient = pick(patients);
        let code = weighted(Object.entries(SEASONALITY).map(([c, w]) => [c, w[month]]));
        if (code === 'MATERNAL_CARE' && (patient.sex !== 'FEMALE' || patient.age < 18 || patient.age > 42)) code = 'VIRAL_FEVER';
        if ((code === 'DIABETES' || code === 'HYPERTENSION') && patient.age < 30) patient = pick(patients.filter((p) => p.age >= 40));
        const prof = PROFILES[code];
        const symptoms = [...new Set([prof.symptoms[0], pick(prof.symptoms), pick(prof.symptoms)])];
        const [sys, dia] = prof.bp ? [between(...prof.bp[0]), between(...prof.bp[1])] : [between(105, 135), between(68, 86)];
        const creator = rand() < 0.6 ? patient.creator : pick(clinicians);
        rows.push([
          patient.id, date, rand() < 0.22 ? 'TELECONSULT' : 'IN_PERSON', creator.facility, symptoms, code,
          null, prof.tx,
          prof.temp ? between(...prof.temp, 1) : between(36.4, 37.2, 1),
          sys, dia, between(68, 104), prof.spo2 ? between(...prof.spo2) : between(95, 99),
          prof.glucose ? between(...prof.glucose) : rand() < 0.4 ? between(80, 140) : null,
          patient.age < 12 ? between(8, 35, 1) : between(38, 78, 1),
          rand() < 0.35 ? addDays(date, pick([3, 7, 14, 30])) : null,
          users[creator.email],
        ]);
      }
    }

    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const width = chunk[0].length;
      await db.query(
        `INSERT INTO encounters (patient_id, encounter_date, encounter_type, facility, symptoms, diagnosis_code,
           diagnosis_notes, treatment, temperature_c, systolic_bp, diastolic_bp, pulse_bpm, spo2_pct,
           blood_glucose_mgdl, weight_kg, follow_up_date, created_by)
         VALUES ${chunk.map((_, r) => `(${Array.from({ length: width }, (_, c) => `$${r * width + c + 1}`).join(',')})`).join(',')}`,
        chunk.flat(),
      );
    }
    log(`Seeded ${USERS.length} users, ${patients.length} patients, ${rows.length} encounters.`);
  });
}

if (isMain(import.meta.url)) {
  seed({ reset: process.argv.includes('--reset') })
    .then(() => {
      console.log(`Demo password for all accounts: ${DEMO_PASSWORD}`);
      return pool.end();
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

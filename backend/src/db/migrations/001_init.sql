-- Rural Outreach Patient Dashboard - initial schema
-- Requires PostgreSQL 13+ (gen_random_uuid() is built in).

CREATE TYPE user_role AS ENUM ('ADMIN', 'DOCTOR', 'NURSE');
CREATE TYPE patient_sex AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNKNOWN');
CREATE TYPE encounter_type AS ENUM ('IN_PERSON', 'TELECONSULT');

-- ---------------------------------------------------------------------------
-- Users & sessions
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name             TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  role                  user_role NOT NULL,
  facility              TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Refresh tokens are stored only as SHA-256 hashes. Each login starts a
-- "family"; every refresh rotates the token. Presenting an already-rotated
-- token signals theft and revokes the whole family.
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   UUID NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  -- ROTATED (normal refresh), LOGOUT, REUSE_DETECTED, ADMIN
  revoked_reason TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- ---------------------------------------------------------------------------
-- Clinical data (anonymised)
-- ---------------------------------------------------------------------------
-- No names, phone numbers or addresses are stored. A patient is identified
-- by a random pseudo ID (printed on the patient's card) and, optionally, an
-- HMAC of a government/health ID used only to detect duplicate registrations.
CREATE TABLE patients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pseudo_id         TEXT NOT NULL UNIQUE,
  external_ref_hash TEXT UNIQUE,
  birth_year        INT NOT NULL CHECK (birth_year BETWEEN 1900 AND 2100),
  sex               patient_sex NOT NULL,
  district          TEXT NOT NULL,
  block             TEXT,
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX patients_district_idx ON patients (district);

CREATE TABLE diagnosis_categories (
  code           TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  is_communicable BOOLEAN NOT NULL
);

INSERT INTO diagnosis_categories (code, label, is_communicable) VALUES
  ('VIRAL_FEVER',   'Viral fever',                      TRUE),
  ('DENGUE',        'Dengue',                           TRUE),
  ('MALARIA',       'Malaria',                          TRUE),
  ('TYPHOID',       'Typhoid',                          TRUE),
  ('TUBERCULOSIS',  'Tuberculosis',                     TRUE),
  ('ARI',           'Acute respiratory infection',      TRUE),
  ('DIARRHOEA',     'Acute diarrhoeal disease',         TRUE),
  ('SKIN_INFECTION','Skin infection',                   TRUE),
  ('DIABETES',      'Diabetes mellitus',                FALSE),
  ('HYPERTENSION',  'Hypertension',                     FALSE),
  ('ANAEMIA',       'Anaemia',                          FALSE),
  ('MATERNAL_CARE', 'Antenatal / postnatal care',       FALSE),
  ('INJURY',        'Injury / trauma',                  FALSE),
  ('OTHER',         'Other',                            FALSE);

CREATE TABLE encounters (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         UUID NOT NULL REFERENCES patients(id),
  encounter_date     DATE NOT NULL,
  encounter_type     encounter_type NOT NULL DEFAULT 'IN_PERSON',
  facility           TEXT NOT NULL,
  symptoms           TEXT[] NOT NULL CHECK (cardinality(symptoms) > 0),
  diagnosis_code     TEXT NOT NULL REFERENCES diagnosis_categories(code),
  diagnosis_notes    TEXT,
  treatment          TEXT,
  temperature_c      NUMERIC(4,1) CHECK (temperature_c BETWEEN 30 AND 45),
  systolic_bp        INT CHECK (systolic_bp BETWEEN 50 AND 300),
  diastolic_bp       INT CHECK (diastolic_bp BETWEEN 30 AND 200),
  pulse_bpm          INT CHECK (pulse_bpm BETWEEN 20 AND 250),
  spo2_pct           INT CHECK (spo2_pct BETWEEN 50 AND 100),
  blood_glucose_mgdl INT CHECK (blood_glucose_mgdl BETWEEN 20 AND 800),
  weight_kg          NUMERIC(5,1) CHECK (weight_kg BETWEEN 0.5 AND 300),
  follow_up_date     DATE CHECK (follow_up_date IS NULL OR follow_up_date >= encounter_date),
  -- Optimistic concurrency: clients must send the version they edited.
  version            INT NOT NULL DEFAULT 1,
  created_by         UUID NOT NULL REFERENCES users(id),
  updated_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft delete: clinical records are never physically removed.
  deleted_at         TIMESTAMPTZ,
  deleted_by         UUID REFERENCES users(id),
  delete_reason      TEXT,
  CHECK (systolic_bp IS NULL OR diastolic_bp IS NULL OR systolic_bp > diastolic_bp)
);
CREATE INDEX encounters_date_idx      ON encounters (encounter_date) WHERE deleted_at IS NULL;
CREATE INDEX encounters_diag_date_idx ON encounters (diagnosis_code, encounter_date) WHERE deleted_at IS NULL;
CREATE INDEX encounters_patient_idx   ON encounters (patient_id);
CREATE INDEX encounters_creator_idx   ON encounters (created_by);

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      UUID REFERENCES users(id),
  user_email   TEXT,
  user_role    user_role,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  changes      JSONB,
  ip           TEXT,
  user_agent   TEXT,
  request_id   TEXT
);
CREATE INDEX audit_logs_occurred_idx ON audit_logs (occurred_at DESC);
CREATE INDEX audit_logs_entity_idx   ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_user_idx     ON audit_logs (user_id);

-- Tamper resistance: the application role cannot rewrite history.
CREATE FUNCTION audit_logs_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

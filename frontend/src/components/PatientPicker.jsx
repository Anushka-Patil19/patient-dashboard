import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useMeta } from '../hooks/useApi.js';
import { SEX_LABEL } from '../lib/format.js';
import { validatePatient } from '../lib/validation.js';
import { Alert, Field } from './ui.jsx';

const EMPTY = { age: '', sex: '', district: '', block: '', externalRef: '' };

export function PatientRegisterForm({ onRegistered, onCancel }) {
  const meta = useMeta();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [existing, setExisting] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    e.stopPropagation(); // may be nested inside the encounter form
    const v = validatePatient(form);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setError(null);
    setExisting(null);
    try {
      const { data } = await api('/patients', {
        method: 'POST',
        body: {
          birthYear: new Date().getFullYear() - Number(form.age),
          sex: form.sex,
          district: form.district.trim(),
          block: form.block.trim() || null,
          externalRef: form.externalRef.trim() || null,
        },
      });
      onRegistered(data);
    } catch (err) {
      if (err.code === 'PATIENT_EXISTS') setExisting(err.details);
      else if (err.code === 'VALIDATION_ERROR') setErrors({ ...err.fieldErrors, age: err.fieldErrors.birthYear });
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function useExisting() {
    const { data } = await api(`/patients/${existing.id}`);
    onRegistered(data);
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface-2/40 p-3">
      <p className="text-sm font-medium">Register new patient</p>
      <p className="text-xs text-muted">No names or phone numbers are stored. The patient receives a pseudo ID to write on their card.</p>
      {error && <Alert tone="error">{error}</Alert>}
      {existing && (
        <Alert tone="warn" title="Already registered" action={<button type="button" className="btn-secondary" onClick={useExisting}>Use {existing.pseudoId}</button>}>
          A patient with this ID number exists as <span className="font-mono">{existing.pseudoId}</span>.
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Age (years)" error={errors.age}>
          {(a) => <input {...a} className="input" inputMode="numeric" value={form.age} onChange={set('age')} />}
        </Field>
        <Field label="Sex" error={errors.sex}>
          {(a) => (
            <select {...a} className="input" value={form.sex} onChange={set('sex')}>
              <option value="">Select</option>
              {Object.entries(SEX_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="District" error={errors.district}>
          {(a) => (
            <>
              <input {...a} className="input" list="district-options" value={form.district} onChange={set('district')} />
              <datalist id="district-options">
                {meta?.districts.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Block / taluka" error={errors.block}>
          {(a) => <input {...a} className="input" value={form.block} onChange={set('block')} />}
        </Field>
      </div>
      <Field label="ABHA / Aadhaar / phone (optional)" error={errors.externalRef} hint="Used only to detect duplicate registrations. Stored as a one-way keyed hash, never as plain text.">
        {(a) => <input {...a} className="input" autoComplete="off" value={form.externalRef} onChange={set('externalRef')} />}
      </Field>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? 'Registering…' : 'Register patient'}
        </button>
      </div>
    </div>
  );
}

export function PatientSummary({ patient }) {
  return (
    <span>
      <span className="font-mono font-medium">{patient.pseudoId}</span>
      <span className="ml-2 text-sm text-muted">
        {patient.ageBand} · {SEX_LABEL[patient.sex]} · {patient.district}
        {patient.block ? `, ${patient.block}` : ''}
      </span>
    </span>
  );
}

export default function PatientPicker({ value, onChange, error, disabled }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    if (q.trim().length < 3) {
      setResults([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api('/patients', { query: { q: q.trim(), pageSize: 8 }, signal: controller.signal });
        setResults(res.data);
      } catch {
        /* aborted or failed; keep previous results */
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  if (value) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/40 px-3 py-2.5">
        <PatientSummary patient={value} />
        {!disabled && (
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => onChange(null)}>
            Change
          </button>
        )}
      </div>
    );
  }

  if (registering) {
    return (
      <PatientRegisterForm
        onCancel={() => setRegistering(false)}
        onRegistered={(p) => {
          setRegistering(false);
          onChange(p);
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="Search by pseudo ID (PT-…) or ABHA / Aadhaar / phone"
          aria-label="Search patient"
          aria-invalid={Boolean(error)}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn-secondary shrink-0" onClick={() => setRegistering(true)}>
          New patient
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {searching && <p className="mt-2 text-xs text-muted">Searching…</p>}
      {results.length > 0 && (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => onChange(p)}>
                <PatientSummary patient={p} />
                <span className="ml-2 text-xs text-muted">{p.encounterCount} visits</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!searching && q.trim().length >= 3 && results.length === 0 && (
        <p className="mt-2 text-xs text-muted">No match. Register them as a new patient.</p>
      )}
    </div>
  );
}

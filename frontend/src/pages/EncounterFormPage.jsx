import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import PatientPicker from '../components/PatientPicker.jsx';
import { Alert, ErrorAlert, Field, PageHeader, Spinner } from '../components/ui.jsx';
import { useMeta } from '../hooks/useApi.js';
import { clearDraft, loadDraft, saveDraft } from '../lib/drafts.js';
import { formatDate, formatDateTime, todayIST, TYPE_LABEL } from '../lib/format.js';
import { toEncounterPayload, validateEncounter, VITAL_FIELDS } from '../lib/validation.js';

const COMMON_SYMPTOMS = ['fever', 'cough', 'headache', 'body ache', 'vomiting', 'loose stools', 'breathlessness', 'rash', 'fatigue', 'abdominal pain'];

const VITALS = [
  ['temperatureC', 'Temp (°C)', '0.1'],
  ['systolicBp', 'BP systolic', '1'],
  ['diastolicBp', 'BP diastolic', '1'],
  ['pulseBpm', 'Pulse (bpm)', '1'],
  ['spo2Pct', 'SpO₂ (%)', '1'],
  ['bloodGlucoseMgdl', 'Glucose (mg/dL)', '1'],
  ['weightKg', 'Weight (kg)', '0.1'],
];

const FIELD_LABELS = {
  encounterDate: 'Date',
  encounterType: 'Type',
  facility: 'Facility',
  symptoms: 'Symptoms',
  diagnosisCode: 'Diagnosis',
  diagnosisNotes: 'Notes',
  treatment: 'Treatment',
  followUpDate: 'Follow-up',
  ...Object.fromEntries(VITALS.map(([k, l]) => [k, l])),
};

function blankForm(user) {
  return {
    patient: null,
    encounterDate: todayIST(),
    encounterType: 'IN_PERSON',
    facility: user.facility || '',
    symptoms: [],
    diagnosisCode: '',
    diagnosisNotes: '',
    treatment: '',
    followUpDate: '',
    ...Object.fromEntries(VITAL_FIELDS.map((f) => [f, ''])),
  };
}

function fromEncounter(e) {
  return {
    patient: e.patient,
    encounterDate: e.encounterDate,
    encounterType: e.encounterType,
    facility: e.facility,
    symptoms: e.symptoms,
    diagnosisCode: e.diagnosisCode,
    diagnosisNotes: e.diagnosisNotes ?? '',
    treatment: e.treatment ?? '',
    followUpDate: e.followUpDate ?? '',
    ...Object.fromEntries(VITAL_FIELDS.map((f) => [f, e[f] ?? ''])),
  };
}

function SymptomInput({ value, onChange, error, disabled }) {
  const [text, setText] = useState('');
  const add = (raw) => {
    const s = raw.trim().toLowerCase();
    if (s && !value.includes(s) && value.length < 20) onChange([...value, s]);
    setText('');
  };
  return (
    <div>
      <div className={`flex flex-wrap gap-1.5 rounded-lg border bg-surface p-1.5 ${error ? 'border-danger' : 'border-line-strong'}`}>
        {value.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-md bg-accent-wash px-2 py-1 text-xs text-accent-ink">
            {s}
            {!disabled && (
              <button type="button" aria-label={`Remove ${s}`} className="font-bold" onClick={() => onChange(value.filter((x) => x !== s))}>
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            className="min-w-32 flex-1 bg-transparent px-1.5 py-1 text-sm outline-none"
            placeholder={value.length ? 'Add another…' : 'Type a symptom and press Enter'}
            aria-label="Add symptom"
            aria-invalid={Boolean(error)}
            value={text}
            onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value.slice(0, -1)) : setText(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(text);
              } else if (e.key === 'Backspace' && !text && value.length) {
                onChange(value.slice(0, -1));
              }
            }}
            onBlur={() => text && add(text)}
          />
        )}
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {!disabled && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {COMMON_SYMPTOMS.filter((s) => !value.includes(s)).map((s) => (
            <button key={s} type="button" className="rounded-md border border-line px-1.5 py-0.5 text-xs text-ink-2 hover:bg-surface-2" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EncounterFormPage() {
  const { id } = useParams();
  const { user, can } = useAuth();
  const meta = useMeta();
  const navigate = useNavigate();
  const isNew = !id;
  const readOnly = !isNew && !can('encounter:update');
  const draftKey = isNew ? 'encounter:new' : `encounter:${id}`;

  const [form, setForm] = useState(() => blankForm(user));
  const [version, setVersion] = useState(null);
  const [record, setRecord] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [draftRestoredAt, setDraftRestoredAt] = useState(null);
  const dirty = useRef(false);

  // Load the record (edit/view) and/or restore an unsaved draft.
  useEffect(() => {
    let cancelled = false;
    const draft = readOnly ? null : loadDraft(draftKey);
    if (isNew) {
      if (draft) {
        setForm(draft.value.form);
        setDraftRestoredAt(draft.savedAt);
        dirty.current = true;
      }
      return undefined;
    }
    api(`/encounters/${id}`)
      .then(({ data }) => {
        if (cancelled) return;
        setRecord(data);
        if (draft && draft.value.version === data.version) {
          setForm(draft.value.form);
          setDraftRestoredAt(draft.savedAt);
          dirty.current = true;
        } else {
          setForm(fromEncounter(data));
        }
        setVersion(data.version);
      })
      .catch((err) => !cancelled && setLoadError(err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, isNew, readOnly, draftKey]);

  // Autosave the draft (debounced) so an expired session or closed tab loses nothing.
  useEffect(() => {
    if (!dirty.current || readOnly) return undefined;
    const t = setTimeout(() => saveDraft(draftKey, { form, version }), 400);
    return () => clearTimeout(t);
  }, [form, version, draftKey, readOnly]);

  useEffect(() => {
    const warn = (e) => {
      if (dirty.current && !readOnly) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [readOnly]);

  const set = (field) => (eventOrValue) => {
    const value = eventOrValue?.target ? eventOrValue.target.value : eventOrValue;
    dirty.current = true;
    setSaved(null);
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };

  const diagnosisOptions = useMemo(() => meta?.diagnoses ?? [], [meta]);

  async function save(overrideVersion) {
    setSubmitError(null);
    setConflict(null);
    const v = validateEncounter({ ...form, patientId: form.patient?.id }, { requirePatient: isNew });
    setErrors(v);
    if (Object.keys(v).length) {
      setSubmitError('Please correct the highlighted fields.');
      return;
    }

    setSaving(true);
    try {
      const payload = toEncounterPayload(form);
      if (isNew) {
        const { data } = await api('/encounters', { method: 'POST', body: { ...payload, patientId: form.patient.id } });
        clearDraft(draftKey);
        dirty.current = false;
        setSaved(data);
        // Keep date/facility/type for the next entry in a clinic session.
        setForm((f) => ({ ...blankForm(user), encounterDate: f.encounterDate, facility: f.facility, encounterType: f.encounterType }));
        setDraftRestoredAt(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        const { data } = await api(`/encounters/${id}`, { method: 'PUT', body: { ...payload, version: overrideVersion ?? version } });
        clearDraft(draftKey);
        dirty.current = false;
        navigate('/encounters', { replace: true, state: { saved: data.id } });
      }
    } catch (err) {
      if (err.code === 'VERSION_CONFLICT') {
        setConflict(err.details.current);
      } else if (err.code === 'VALIDATION_ERROR') {
        setErrors(err.fieldErrors);
        setSubmitError(err.message);
      } else if (err.code === 'SESSION_ENDED') {
        setSubmitError('You signed out. Your draft is kept in this tab until you sign in again.');
      } else {
        setSubmitError(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  function conflictingFields() {
    if (!conflict) return [];
    const theirs = fromEncounter(conflict);
    return Object.keys(FIELD_LABELS).filter((k) => JSON.stringify(String(theirs[k] ?? '')) !== JSON.stringify(String(form[k] ?? '')));
  }

  if (loading) return <Spinner />;
  if (loadError) return <ErrorAlert error={loadError} />;

  const title = isNew ? 'New encounter' : readOnly ? 'Encounter' : 'Edit encounter';

  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          record
            ? `Recorded by ${record.createdBy.name} · ${formatDateTime(record.createdAt)}${record.updatedBy ? ` · last edited by ${record.updatedBy.name}` : ''}`
            : 'Record symptoms, diagnosis and treatment for a patient visit'
        }
        actions={
          <Link to="/encounters" className="btn-secondary">
            Back to list
          </Link>
        }
      />

      <div className="space-y-4">
        {saved && (
          <Alert tone="success" title="Encounter saved" action={<Link to={`/encounters/${saved.id}`} className="btn-secondary">View</Link>}>
            {saved.patient.pseudoId} · {saved.diagnosisLabel} · {formatDate(saved.encounterDate)}. The form is ready for the next patient.
          </Alert>
        )}
        {draftRestoredAt && !saved && (
          <Alert
            tone="info"
            title="Unsaved draft restored"
            action={
              <button
                className="btn-ghost px-2 py-1 text-xs"
                onClick={() => {
                  clearDraft(draftKey);
                  dirty.current = false;
                  setForm(record ? fromEncounter(record) : blankForm(user));
                  setDraftRestoredAt(null);
                }}
              >
                Discard draft
              </button>
            }
          >
            Picked up where you left off ({formatDateTime(new Date(draftRestoredAt).toISOString())}).
          </Alert>
        )}
        {readOnly && <Alert tone="info">You can view this record. Only doctors can edit encounters.</Alert>}
        {conflict && (
          <Alert tone="warn" title="Someone else updated this encounter">
            <p>
              {conflict.updatedBy?.name ?? 'Another user'} saved changes after you opened it. Fields that differ from your version:{' '}
              <strong>{conflictingFields().map((k) => FIELD_LABELS[k]).join(', ') || 'none'}</strong>.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className="btn-secondary"
                onClick={() => {
                  setForm(fromEncounter(conflict));
                  setVersion(conflict.version);
                  setRecord(conflict);
                  setConflict(null);
                  dirty.current = false;
                  clearDraft(draftKey);
                }}
              >
                Discard mine, load theirs
              </button>
              <button className="btn-primary" onClick={() => { setVersion(conflict.version); save(conflict.version); }}>
                Keep mine and overwrite
              </button>
            </div>
          </Alert>
        )}
        {submitError && <Alert tone="error">{submitError}</Alert>}

        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <fieldset disabled={readOnly || saving} className="space-y-4">
            <section className="card space-y-4 p-4 md:p-5">
              <h2 className="text-sm font-semibold">Patient & visit</h2>
              <Field label="Patient" error={null}>
                <PatientPicker value={form.patient} onChange={set('patient')} error={errors.patientId} disabled={!isNew} />
              </Field>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Date" error={errors.encounterDate}>
                  {(a) => <input {...a} type="date" className="input" max={todayIST()} value={form.encounterDate} onChange={set('encounterDate')} />}
                </Field>
                <Field label="Type">
                  {(a) => (
                    <select {...a} className="input" value={form.encounterType} onChange={set('encounterType')}>
                      {Object.entries(TYPE_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Facility" error={errors.facility} className="col-span-2">
                  {(a) => <input {...a} className="input" value={form.facility} onChange={set('facility')} />}
                </Field>
              </div>
            </section>

            <section className="card space-y-4 p-4 md:p-5">
              <h2 className="text-sm font-semibold">Clinical details</h2>
              <Field label="Symptoms">
                <SymptomInput value={form.symptoms} onChange={set('symptoms')} error={errors.symptoms} disabled={readOnly} />
              </Field>
              <Field label="Diagnosis" error={errors.diagnosisCode}>
                {(a) => (
                  <select {...a} className="input" value={form.diagnosisCode} onChange={set('diagnosisCode')}>
                    <option value="">Select diagnosis category</option>
                    {diagnosisOptions.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Diagnosis notes" error={errors.diagnosisNotes}>
                  {(a) => <textarea {...a} rows={3} maxLength={2000} className="input" value={form.diagnosisNotes} onChange={set('diagnosisNotes')} />}
                </Field>
                <Field label="Treatment" error={errors.treatment}>
                  {(a) => <textarea {...a} rows={3} maxLength={2000} className="input" value={form.treatment} onChange={set('treatment')} />}
                </Field>
              </div>
              <p className="text-xs text-muted">Do not enter names, phone numbers or addresses in free-text fields.</p>
            </section>

            <section className="card space-y-4 p-4 md:p-5">
              <h2 className="text-sm font-semibold">
                Vitals <span className="font-normal text-muted">(optional)</span>
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {VITALS.map(([field, label, step]) => (
                  <Field key={field} label={label} error={errors[field]}>
                    {(a) => <input {...a} type="number" step={step} inputMode="decimal" className="input tabular" value={form[field]} onChange={set(field)} />}
                  </Field>
                ))}
              </div>
              <Field label="Follow-up date" error={errors.followUpDate} className="max-w-xs">
                {(a) => <input {...a} type="date" className="input" min={form.encounterDate} value={form.followUpDate} onChange={set('followUpDate')} />}
              </Field>
            </section>
          </fieldset>

          {!readOnly && (
            <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-line bg-page/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0">
              <Link to="/encounters" className="btn-ghost">
                Cancel
              </Link>
              <button className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : isNew ? 'Save encounter' : 'Save changes'}
              </button>
            </div>
          )}
        </form>
      </div>
    </>
  );
}

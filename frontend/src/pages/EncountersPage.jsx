import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Alert, Badge, EmptyState, ErrorAlert, Field, Modal, PageHeader, Pagination, Spinner } from '../components/ui.jsx';
import { useApi, useMeta } from '../hooks/useApi.js';
import { useLiveRefresh } from '../hooks/useLiveUpdates.jsx';
import { formatDate, SEX_SHORT, todayIST, TYPE_LABEL } from '../lib/format.js';

const FILTER_KEYS = ['from', 'to', 'diagnosis', 'district', 'patientId'];

function DeleteDialog({ encounter, onClose, onDeleted }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api(`/encounters/${encounter.id}`, { method: 'DELETE', body: { reason } });
      onDeleted();
    } catch (err) {
      setError(err.fieldErrors.reason || err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(encounter)}
      title="Delete encounter?"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={confirm}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      {encounter && (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            {encounter.patient.pseudoId} · {encounter.diagnosisLabel} · {formatDate(encounter.encounterDate)}
          </p>
          <p className="text-sm text-muted">
            The record is hidden from all views but kept for audit purposes. The reason is recorded in the audit log.
          </p>
          <Field label="Reason for deletion" error={error}>
            {(a11y) => (
              <input {...a11y} className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate entry" />
            )}
          </Field>
        </div>
      )}
    </Modal>
  );
}

export default function EncountersPage() {
  const { can } = useAuth();
  const meta = useMeta();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [toDelete, setToDelete] = useState(null);
  const location = useLocation();
  const [notice, setNotice] = useState(location.state?.saved ? 'Changes saved.' : null);

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || '']));
  const page = Number(params.get('page') || 1);
  const { data, error, loading, reload } = useApi('/encounters', { ...filters, page, pageSize: 20 });
  useLiveRefresh(['encounter.'], reload);

  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const seeAll = can('encounter:read:any');
  const hasFilters = FILTER_KEYS.some((k) => filters[k]);

  return (
    <>
      <PageHeader
        title={seeAll ? 'Encounters' : 'My entries'}
        subtitle={seeAll ? 'All patient encounters across facilities' : 'Encounters you have recorded'}
        actions={
          can('encounter:create') && (
            <Link to="/encounters/new" className="btn-primary">
              New encounter
            </Link>
          )
        }
      />

      <div className="card mb-4 grid grid-cols-2 gap-3 p-3 md:grid-cols-5">
        <label className="text-xs text-muted">
          From
          <input type="date" className="input mt-0.5 py-1.5" max={todayIST()} value={filters.from} onChange={(e) => update({ from: e.target.value })} />
        </label>
        <label className="text-xs text-muted">
          To
          <input type="date" className="input mt-0.5 py-1.5" max={todayIST()} value={filters.to} onChange={(e) => update({ to: e.target.value })} />
        </label>
        <label className="text-xs text-muted">
          Diagnosis
          <select className="input mt-0.5 py-1.5" value={filters.diagnosis} onChange={(e) => update({ diagnosis: e.target.value })}>
            <option value="">All</option>
            {meta?.diagnoses.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          District
          <select className="input mt-0.5 py-1.5" value={filters.district} onChange={(e) => update({ district: e.target.value })}>
            <option value="">All</option>
            {meta?.districts.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <div className="col-span-2 flex items-end md:col-span-1">
          <button className="btn-ghost w-full" disabled={!hasFilters} onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </button>
        </div>
      </div>

      {filters.patientId && (
        <div className="mb-4">
          <Alert tone="info" action={<button className="btn-ghost px-2 py-1 text-xs" onClick={() => update({ patientId: '' })}>Show all</button>}>
            Showing encounters for one patient.
          </Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert tone="success" action={<button className="btn-ghost px-2 py-1 text-xs" onClick={() => setNotice(null)}>Dismiss</button>}>
            {notice}
          </Alert>
        </div>
      )}
      <ErrorAlert error={error} onRetry={reload} />

      <div className="card overflow-hidden">
        {!data && loading ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : data?.data.length === 0 ? (
          <EmptyState title="No encounters found">{hasFilters ? 'Try widening the filters.' : 'Recorded encounters will appear here.'}</EmptyState>
        ) : data ? (
          <>
            {/* Table on wide screens */}
            <table className="hidden w-full md:table">
              <thead className="border-b border-line bg-surface-2/50">
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Patient</th>
                  <th className="th">Diagnosis</th>
                  <th className="th">Symptoms</th>
                  <th className="th">Recorded by</th>
                  <th className="th sr-only">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((e) => (
                  <tr key={e.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2/60" onClick={() => navigate(`/encounters/${e.id}`)}>
                    <td className="td tabular whitespace-nowrap">
                      {formatDate(e.encounterDate)}
                      {e.encounterType === 'TELECONSULT' && (
                        <div className="mt-0.5">
                          <Badge tone="accent">{TYPE_LABEL[e.encounterType]}</Badge>
                        </div>
                      )}
                    </td>
                    <td className="td">
                      <span className="font-mono text-xs font-medium">{e.patient.pseudoId}</span>
                      <div className="text-xs text-muted">
                        {e.patient.ageAtEncounter}y {SEX_SHORT[e.patient.sex]} · {e.patient.district}
                      </div>
                    </td>
                    <td className="td">{e.diagnosisLabel}</td>
                    <td className="td max-w-56 text-ink-2">{e.symptoms.join(', ')}</td>
                    <td className="td text-ink-2">
                      {e.createdBy.name}
                      <div className="text-xs text-muted">{e.facility}</div>
                    </td>
                    <td className="td text-right whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                      <Link to={`/encounters/${e.id}`} className="btn-ghost px-2 py-1 text-xs">
                        {can('encounter:update') ? 'Edit' : 'View'}
                      </Link>
                      {can('encounter:delete') && (
                        <button className="btn-ghost px-2 py-1 text-xs text-danger" onClick={() => setToDelete(e)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Cards on phones */}
            <ul className="divide-y divide-line md:hidden">
              {data.data.map((e) => (
                <li key={e.id}>
                  <Link to={`/encounters/${e.id}`} className="block px-4 py-3 hover:bg-surface-2/60">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{e.diagnosisLabel}</span>
                      <span className="tabular text-xs text-muted">{formatDate(e.encounterDate)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className="font-mono">{e.patient.pseudoId}</span> · {e.patient.ageAtEncounter}y {SEX_SHORT[e.patient.sex]} · {e.patient.district}
                    </p>
                    <p className="mt-1 truncate text-sm text-ink-2">{e.symptoms.join(', ')}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => update({ page: String(p) })} />
          </>
        ) : null}
      </div>

      <DeleteDialog
        encounter={toDelete}
        onClose={() => setToDelete(null)}
        onDeleted={() => {
          setToDelete(null);
          setNotice('Encounter deleted.');
          reload();
        }}
      />
    </>
  );
}

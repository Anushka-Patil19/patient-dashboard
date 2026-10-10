import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { PatientRegisterForm } from '../components/PatientPicker.jsx';
import { Alert, EmptyState, ErrorAlert, PageHeader, Pagination, Spinner } from '../components/ui.jsx';
import { invalidateMeta, useApi, useMeta } from '../hooks/useApi.js';
import { useLiveRefresh } from '../hooks/useLiveUpdates.jsx';
import { formatDate, SEX_LABEL } from '../lib/format.js';

export default function PatientsPage() {
  const { can } = useAuth();
  const meta = useMeta();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [district, setDistrict] = useState('');
  const [page, setPage] = useState(1);
  const [registering, setRegistering] = useState(false);
  const [created, setCreated] = useState(null);

  const { data, error, loading, reload } = useApi('/patients', { q: search, district, page, pageSize: 20 });
  useLiveRefresh(['patient.', 'encounter.'], reload);

  return (
    <>
      <PageHeader
        title="Patients"
        subtitle="Pseudonymised patient register — no names or contact details are stored"
        actions={
          can('patient:create') &&
          !registering && (
            <button className="btn-primary" onClick={() => setRegistering(true)}>
              Register patient
            </button>
          )
        }
      />

      {registering && (
        <div className="card mb-4 p-4">
          <PatientRegisterForm
            onCancel={() => setRegistering(false)}
            onRegistered={(p) => {
              setRegistering(false);
              setCreated(p);
              invalidateMeta();
              reload();
            }}
          />
        </div>
      )}
      {created && (
        <div className="mb-4">
          <Alert
            tone="success"
            title={`Registered as ${created.pseudoId}`}
            action={
              <Link to="/encounters/new" className="btn-secondary">
                Record encounter
              </Link>
            }
          >
            Write this ID on the patient's card so they can be found on their next visit.
          </Alert>
        </div>
      )}

      <form
        className="card mb-4 flex flex-wrap items-end gap-3 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(q.trim());
        }}
      >
        <label className="min-w-56 flex-1 text-xs text-muted">
          Search
          <input className="input mt-0.5 py-1.5" placeholder="Pseudo ID (PT-…) or ABHA / Aadhaar / phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          District
          <select
            className="input mt-0.5 py-1.5"
            value={district}
            onChange={(e) => {
              setPage(1);
              setDistrict(e.target.value);
            }}
          >
            <option value="">All</option>
            {meta?.districts.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <button className="btn-secondary">Search</button>
      </form>

      <ErrorAlert error={error} onRetry={reload} />
      <div className="card overflow-x-auto">
        {!data && loading ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : data?.data.length === 0 ? (
          <EmptyState title="No patients found" />
        ) : data ? (
          <>
            <table className="w-full min-w-[560px]">
              <thead className="border-b border-line bg-surface-2/50">
                <tr>
                  <th className="th">Pseudo ID</th>
                  <th className="th">Age group</th>
                  <th className="th">Sex</th>
                  <th className="th">Location</th>
                  <th className="th text-right">Visits</th>
                  <th className="th">Last visit</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="td">
                      <Link to={`/encounters?patientId=${p.id}`} className="font-mono text-xs font-medium text-accent-ink hover:underline">
                        {p.pseudoId}
                      </Link>
                    </td>
                    <td className="td">{p.ageBand}</td>
                    <td className="td">{SEX_LABEL[p.sex]}</td>
                    <td className="td text-ink-2">
                      {p.district}
                      {p.block ? `, ${p.block}` : ''}
                    </td>
                    <td className="td tabular text-right">{p.encounterCount}</td>
                    <td className="td tabular">{formatDate(p.lastEncounterDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        ) : null}
      </div>
    </>
  );
}

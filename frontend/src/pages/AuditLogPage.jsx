import { useState } from 'react';
import { Badge, EmptyState, ErrorAlert, PageHeader, Pagination, Spinner } from '../components/ui.jsx';
import { useApi } from '../hooks/useApi.js';
import { formatDateTime, todayIST } from '../lib/format.js';

const ACTIONS = ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'REFRESH_TOKEN_REUSE', 'CREATE', 'UPDATE', 'DELETE', 'ACCESS_DENIED'];
const TONE = {
  LOGIN_FAILED: 'warn',
  ACCESS_DENIED: 'danger',
  REFRESH_TOKEN_REUSE: 'danger',
  DELETE: 'danger',
  CREATE: 'good',
  UPDATE: 'accent',
};

function Changes({ changes }) {
  if (!changes) return <span className="text-muted">—</span>;
  const entries = Object.entries(changes);
  return (
    <ul className="space-y-0.5 text-xs">
      {entries.slice(0, 6).map(([key, v]) => (
        <li key={key} className="break-words">
          <span className="text-muted">{key}:</span>{' '}
          {v && typeof v === 'object' && ('from' in v || 'to' in v) ? (
            <>
              {'from' in v && v.from !== null && <span className="text-ink-2 line-through">{String(v.from)}</span>} <span>{String(v.to ?? '∅')}</span>
            </>
          ) : v && typeof v === 'object' && v.changed ? (
            <span className="italic text-ink-2">changed (content redacted)</span>
          ) : (
            <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
          )}
        </li>
      ))}
      {entries.length > 6 && <li className="text-muted">+{entries.length - 6} more fields</li>}
    </ul>
  );
}

export default function AuditLogPage() {
  const [filters, setFilters] = useState({ action: '', entityType: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi('/audit-logs', { ...filters, page, pageSize: 25 });
  const set = (k) => (e) => {
    setPage(1);
    setFilters({ ...filters, [k]: e.target.value });
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Append-only record of sign-ins, data changes and access violations"
        actions={
          <button className="btn-secondary" onClick={reload} disabled={loading}>
            Refresh
          </button>
        }
      />
      <div className="card mb-4 grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
        <label className="text-xs text-muted">
          Action
          <select className="input mt-0.5 py-1.5" value={filters.action} onChange={set('action')}>
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Record type
          <select className="input mt-0.5 py-1.5" value={filters.entityType} onChange={set('entityType')}>
            <option value="">All</option>
            <option value="encounter">Encounter</option>
            <option value="patient">Patient</option>
            <option value="user">User</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          From
          <input type="date" className="input mt-0.5 py-1.5" max={todayIST()} value={filters.from} onChange={set('from')} />
        </label>
        <label className="text-xs text-muted">
          To
          <input type="date" className="input mt-0.5 py-1.5" max={todayIST()} value={filters.to} onChange={set('to')} />
        </label>
      </div>

      <ErrorAlert error={error} onRetry={reload} />
      <div className="card overflow-x-auto">
        {!data && loading ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : data?.data.length === 0 ? (
          <EmptyState title="No audit entries match" />
        ) : data ? (
          <>
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-line bg-surface-2/50">
                <tr>
                  <th className="th">When (IST)</th>
                  <th className="th">User</th>
                  <th className="th">Action</th>
                  <th className="th">Record</th>
                  <th className="th">Details</th>
                  <th className="th">IP</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="td tabular whitespace-nowrap">{formatDateTime(r.occurredAt)}</td>
                    <td className="td">
                      {r.user?.email ?? <span className="text-muted">anonymous</span>}
                      {r.user?.role && <div className="text-xs text-muted">{r.user.role}</div>}
                    </td>
                    <td className="td">
                      <Badge tone={TONE[r.action] ?? 'neutral'}>{r.action}</Badge>
                    </td>
                    <td className="td text-xs">
                      {r.entityType ? (
                        <>
                          {r.entityType}
                          <div className="font-mono text-muted">{r.entityId?.slice(0, 8)}</div>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="td max-w-80">
                      <Changes changes={r.changes} />
                    </td>
                    <td className="td font-mono text-xs text-muted">{r.ip}</td>
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

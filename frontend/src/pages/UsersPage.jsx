import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Alert, Badge, ErrorAlert, Field, Modal, PageHeader, Spinner } from '../components/ui.jsx';
import { useApi } from '../hooks/useApi.js';
import { formatDateTime, ROLE_LABEL } from '../lib/format.js';

const EMPTY = { fullName: '', email: '', role: 'NURSE', facility: '', password: '' };

function CreateUserForm({ onCreated, onCancel }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await api('/users', { method: 'POST', body: { ...form, facility: form.facility.trim() || null } });
      onCreated(form.email);
    } catch (err) {
      setErrors(err.fieldErrors);
      setError(err.code === 'DUPLICATE' ? 'A user with this email already exists.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mb-4 space-y-3 p-4" noValidate>
      <p className="text-sm font-semibold">New user</p>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Full name" error={errors.fullName}>
          {(a) => <input {...a} className="input" value={form.fullName} onChange={set('fullName')} />}
        </Field>
        <Field label="Email" error={errors.email}>
          {(a) => <input {...a} type="email" className="input" autoComplete="off" value={form.email} onChange={set('email')} />}
        </Field>
        <Field label="Role" error={errors.role}>
          {(a) => (
            <select {...a} className="input" value={form.role} onChange={set('role')}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Facility" error={errors.facility}>
          {(a) => <input {...a} className="input" value={form.facility} onChange={set('facility')} />}
        </Field>
        <Field label="Temporary password" error={errors.password} hint="At least 10 characters with a letter and a number.">
          {(a) => <input {...a} type="password" className="input" autoComplete="new-password" value={form.password} onChange={set('password')} />}
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create user'}
        </button>
      </div>
    </form>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const { data, error, loading, reload } = useApi('/users');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [resetFor, setResetFor] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  async function patch(u, body, message) {
    setActionError(null);
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', body });
      setNotice(message);
      reload();
      return true;
    } catch (err) {
      setActionError(err.fieldErrors.password || err.message);
      return false;
    }
  }

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Accounts are created by administrators — there is no public sign-up"
        actions={
          !creating && (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              Add user
            </button>
          )
        }
      />
      {creating && (
        <CreateUserForm
          onCancel={() => setCreating(false)}
          onCreated={(email) => {
            setCreating(false);
            setNotice(`Created ${email}.`);
            reload();
          }}
        />
      )}
      <div className="mb-4 space-y-2">
        {notice && <Alert tone="success">{notice}</Alert>}
        {actionError && <Alert tone="error">{actionError}</Alert>}
        <ErrorAlert error={error} onRetry={reload} />
      </div>

      <div className="card overflow-x-auto">
        {!data && loading ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : data ? (
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-line bg-surface-2/50">
              <tr>
                <th className="th">Name</th>
                <th className="th">Role</th>
                <th className="th">Facility</th>
                <th className="th">Status</th>
                <th className="th">Last sign-in</th>
                <th className="th sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((u) => {
                const self = u.id === me.id;
                const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
                return (
                  <tr key={u.id} className="border-b border-line last:border-0">
                    <td className="td">
                      {u.fullName} {self && <Badge>you</Badge>}
                      <div className="text-xs text-muted">{u.email}</div>
                    </td>
                    <td className="td">
                      <select
                        className="input py-1"
                        aria-label={`Role for ${u.fullName}`}
                        value={u.role}
                        disabled={self}
                        onChange={(e) => patch(u, { role: e.target.value }, `${u.fullName} is now ${ROLE_LABEL[e.target.value]}. Their active sessions were signed out.`)}
                      >
                        {Object.entries(ROLE_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="td text-ink-2">{u.facility ?? '—'}</td>
                    <td className="td">
                      {!u.isActive ? <Badge tone="danger">Disabled</Badge> : locked ? <Badge tone="warn">Locked</Badge> : <Badge tone="good">Active</Badge>}
                    </td>
                    <td className="td tabular text-ink-2">{formatDateTime(u.lastLoginAt)}</td>
                    <td className="td text-right whitespace-nowrap">
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setResetFor(u)}>
                        Reset password
                      </button>
                      {!self && (
                        <button
                          className={`btn-ghost px-2 py-1 text-xs ${u.isActive ? 'text-danger' : ''}`}
                          onClick={() => patch(u, { isActive: !u.isActive }, `${u.fullName} ${u.isActive ? 'disabled and signed out' : 're-enabled'}.`)}
                        >
                          {u.isActive ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>

      <Modal
        open={Boolean(resetFor)}
        title={`Reset password for ${resetFor?.fullName ?? ''}`}
        onClose={() => setResetFor(null)}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setResetFor(null)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={newPassword.length < 10}
              onClick={async () => {
                if (await patch(resetFor, { password: newPassword }, `Password reset for ${resetFor.fullName}. Lockout cleared and sessions signed out.`)) {
                  setResetFor(null);
                  setNewPassword('');
                }
              }}
            >
              Reset password
            </button>
          </>
        }
      >
        <Field label="New temporary password" hint="At least 10 characters with a letter and a number. Share it securely.">
          {(a) => <input {...a} type="password" className="input" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />}
        </Field>
      </Modal>
    </>
  );
}

import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Alert, Field } from '../components/ui.jsx';

const DEMO_ACCOUNTS = [
  ['Admin', 'admin@demo.local', 'Analytics, audit log, users'],
  ['Doctor', 'doctor@demo.local', 'View, edit and delete encounters'],
  ['Nurse', 'nurse@demo.local', 'Enter encounters only'],
];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form.email, form.password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-10 w-10" />
          <div>
            <h1 className="text-lg font-semibold">Rural Outreach</h1>
            <p className="text-sm text-muted">Patient encounter dashboard</p>
          </div>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-5" noValidate>
          {error && (
            <Alert tone="error" title={error.code === 'ACCOUNT_LOCKED' ? 'Account locked' : 'Sign-in failed'}>
              {error.message}
            </Alert>
          )}
          <Field label="Email">
            {(a11y) => (
              <input
                {...a11y}
                type="email"
                className="input"
                autoComplete="username"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            )}
          </Field>
          <Field label="Password">
            {(a11y) => (
              <input
                {...a11y}
                type="password"
                className="input"
                autoComplete="current-password"
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            )}
          </Field>
          <button className="btn-primary w-full" disabled={busy || !form.email || !form.password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="card mt-4 p-4">
          <p className="text-sm font-medium">Demo accounts</p>
          <p className="mb-2 text-xs text-muted">
            Password for all: <code className="rounded bg-surface-2 px-1">Demo@2026!</code> — synthetic data only.
          </p>
          <ul className="space-y-1">
            {DEMO_ACCOUNTS.map(([role, email, desc]) => (
              <li key={email}>
                <button
                  type="button"
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
                  onClick={() => setForm({ email, password: 'Demo@2026!' })}
                >
                  <span className="text-sm font-medium">{role}</span>
                  <span className="ml-2 text-xs text-muted">{desc}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

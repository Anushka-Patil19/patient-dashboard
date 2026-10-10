import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { Alert, Field, Modal } from './ui.jsx';

/**
 * Shown over the current page when the session can no longer be refreshed.
 * The page underneath (and any half-filled form) stays mounted; once the user
 * signs in again, the request that hit the expiry is retried automatically.
 */
export default function ReLoginModal() {
  const { user, sessionExpired, reauthenticate, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await reauthenticate(password);
      setPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={sessionExpired} title="Your session has expired" dismissable={false}>
      <form onSubmit={submit} className="space-y-4">
        <Alert tone="info">
          Your work on this page has been kept. Sign in again to continue — anything you were saving will be sent
          automatically.
        </Alert>
        <p className="text-sm text-ink-2">
          Signed in as <span className="font-medium text-ink">{user?.email}</span>
        </p>
        <Field label="Password" error={error}>
          {(a11y) => (
            <input
              {...a11y}
              type="password"
              className="input"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={logout}>
            Sign out
          </button>
          <button className="btn-primary" disabled={busy || !password}>
            {busy ? 'Signing in…' : 'Sign in and continue'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

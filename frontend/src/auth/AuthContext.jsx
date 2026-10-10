import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, completeReauthentication, onSessionExpired, refreshSession, setAccessToken } from '../api/client.js';
import { clearDrafts } from '../lib/drafts.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous
  const [sessionExpired, setSessionExpired] = useState(false);

  // Restore the session from the httpOnly refresh cookie on page load.
  useEffect(() => {
    refreshSession()
      .then((session) => {
        setUser(session.user);
        setStatus('authenticated');
      })
      .catch(() => setStatus('anonymous'));
  }, []);

  useEffect(() => onSessionExpired(() => setSessionExpired(true)), []);

  const login = useCallback(async (email, password) => {
    const session = await api('/auth/login', { method: 'POST', body: { email, password } });
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
    return session.user;
  }, []);

  /** Used by the re-login dialog: same user signs in again, pending requests resume. */
  const reauthenticate = useCallback(
    async (password) => {
      await login(user.email, password);
      setSessionExpired(false);
      completeReauthentication(true);
    },
    [login, user],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setAccessToken(null);
    clearDrafts();
    completeReauthentication(false);
    setSessionExpired(false);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const can = useCallback((permission) => Boolean(user?.permissions?.includes(permission)), [user]);

  const value = useMemo(
    () => ({ user, status, sessionExpired, login, logout, reauthenticate, can }),
    [user, status, sessionExpired, login, logout, reauthenticate, can],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

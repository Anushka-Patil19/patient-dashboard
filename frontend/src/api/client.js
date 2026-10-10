// Thin fetch wrapper that owns the session lifecycle:
//  - the access token lives only in memory (never localStorage, so XSS can't harvest it)
//  - on 401 it refreshes once (deduplicated across concurrent requests) and retries
//  - if the refresh itself fails, it asks the UI to re-authenticate and *waits*,
//    then retries the original request - so a form submitted after the session
//    expired still saves instead of losing the clinician's input.

export class ApiError extends Error {
  constructor(status, error = {}) {
    super(error.message || `Request failed (${status})`);
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }

  /** Field-level validation messages keyed by field name. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(this.details.filter((d) => d.field).map((d) => [d.field, d.message]));
  }
}

let accessToken = null;
let refreshPromise = null;
let reauth = null; // { promise, resolve, reject } while waiting for the user to sign in again
const expiryListeners = new Set();

export const getAccessToken = () => accessToken;
export const setAccessToken = (token) => {
  accessToken = token;
};

export function onSessionExpired(listener) {
  expiryListeners.add(listener);
  return () => expiryListeners.delete(listener);
}

function waitForReauthentication() {
  if (!reauth) {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    reauth = { promise, resolve, reject };
    expiryListeners.forEach((fn) => fn());
  }
  return reauth.promise;
}

/** Called by the re-login dialog once the user has signed in again (or gave up). */
export function completeReauthentication(ok) {
  if (!reauth) return;
  const { resolve, reject } = reauth;
  reauth = null;
  if (ok) resolve();
  else reject(new ApiError(401, { code: 'SESSION_ENDED', message: 'Signed out' }));
}

async function parse(res) {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 200) } };
  }
}

export function refreshSession() {
  refreshPromise ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then(async (res) => {
      const body = await parse(res);
      if (!res.ok) {
        accessToken = null;
        throw new ApiError(res.status, body?.error);
      }
      accessToken = body.accessToken;
      return body;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function buildUrl(path, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ''}`;
}

export async function api(path, { method = 'GET', body, query, signal, retry = true } = {}) {
  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      signal,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, { code: 'NETWORK', message: 'Cannot reach the server. Check your connection and try again.' });
  }

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    try {
      await refreshSession();
    } catch {
      await waitForReauthentication();
    }
    return api(path, { method, body, query, signal, retry: false });
  }

  const data = await parse(res);
  if (!res.ok) throw new ApiError(res.status, data?.error);
  return data;
}

// Unsaved form drafts survive a page reload or an expired session, but only
// for this browser tab (sessionStorage), and are wiped on sign-out so the next
// person at a shared clinic computer never sees them.
const PREFIX = 'draft:';

export function loadDraft(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveDraft(key, value) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    /* storage full or disabled: drafts are a convenience, not a requirement */
  }
}

export function clearDraft(key) {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export function clearDrafts() {
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

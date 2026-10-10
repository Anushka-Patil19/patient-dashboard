import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

/**
 * Loads `path` with `query`, re-fetching when either changes. Returns
 * { data, error, loading, reload }. Stale responses from superseded requests
 * are discarded, and previous data stays visible while reloading.
 */
export function useApi(path, query, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const queryKey = JSON.stringify(query ?? {});
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || !path) return;
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path, { query: JSON.parse(queryKey) });
      if (id === latest.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === latest.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, [path, queryKey, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}

let metaCache = null;
/** Reference data (diagnosis list, districts). Cached for the tab's lifetime. */
export function useMeta() {
  const [meta, setMeta] = useState(metaCache);
  useEffect(() => {
    if (metaCache) return;
    api('/meta')
      .then((m) => {
        metaCache = m;
        setMeta(m);
      })
      .catch(() => {});
  }, []);
  return meta;
}

export function invalidateMeta() {
  metaCache = null;
}

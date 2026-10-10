import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getAccessToken, refreshSession } from '../api/client.js';

const LiveContext = createContext({ status: 'offline', subscribe: () => () => {} });

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

/**
 * One Server-Sent Events connection per signed-in tab. Uses fetch (not
 * EventSource) so the access token goes in the Authorization header. The
 * server closes the stream when the token expires; we refresh and reconnect.
 */
export function LiveUpdatesProvider({ children }) {
  const [status, setStatus] = useState('connecting');
  const subscribers = useRef(new Set());

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function run() {
      let backoff = 1000;
      while (!signal.aborted) {
        try {
          setStatus('connecting');
          if (!getAccessToken()) await refreshSession();
          const res = await fetch('/api/events', {
            headers: { Authorization: `Bearer ${getAccessToken()}`, Accept: 'text/event-stream' },
            signal,
          });
          if (res.status === 401) {
            await refreshSession();
            continue;
          }
          if (!res.ok || !res.body) throw new Error(`events ${res.status}`);

          setStatus('live');
          backoff = 1000;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let idx;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const chunk = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const event = /^event: (.*)$/m.exec(chunk)?.[1];
              const data = /^data: (.*)$/m.exec(chunk)?.[1];
              if (event === 'change' && data) {
                const payload = JSON.parse(data);
                subscribers.current.forEach((fn) => fn(payload));
              }
            }
          }
          // Stream ended normally (token expiry): reconnect promptly.
          await sleep(300, signal);
        } catch {
          if (signal.aborted) return;
          setStatus('offline');
          await sleep(backoff, signal);
          backoff = Math.min(backoff * 2, 30_000);
        }
      }
    }
    run();
    return () => controller.abort();
  }, []);

  const value = useRef({
    subscribe(fn) {
      subscribers.current.add(fn);
      return () => subscribers.current.delete(fn);
    },
  }).current;

  return <LiveContext.Provider value={{ status, subscribe: value.subscribe }}>{children}</LiveContext.Provider>;
}

export const useLiveStatus = () => useContext(LiveContext).status;

/**
 * Calls `onChange` (debounced) when a matching change event arrives,
 * e.g. useLiveRefresh(['encounter.'], reload).
 */
export function useLiveRefresh(prefixes, onChange, delay = 600) {
  const { subscribe } = useContext(LiveContext);
  const callback = useRef(onChange);
  callback.current = onChange;
  const key = prefixes.join('|');

  useEffect(() => {
    let timer;
    const unsubscribe = subscribe((event) => {
      if (!key.split('|').some((p) => event.type.startsWith(p))) return;
      clearTimeout(timer);
      timer = setTimeout(() => callback.current(event), delay);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [subscribe, key, delay]);
}

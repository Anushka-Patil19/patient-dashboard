import { useEffect, useState } from 'react';

const TOKENS = ['surface', 'ink', 'ink-2', 'muted', 'line', 'line-strong', 'series-1', 'series-2', 'series-3'];

function read() {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(TOKENS.map((t) => [t, style.getPropertyValue(`--${t}`).trim()]));
}

/**
 * Resolved colour tokens for SVG charts (Recharts writes colours as SVG
 * attributes, where CSS variables are not reliably supported). Re-reads when
 * the OS colour scheme changes so charts follow light/dark mode.
 */
export function useChartTheme() {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setTheme(read());
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return theme;
}

export const SERIES_SLOTS = ['series-1', 'series-2', 'series-3'];

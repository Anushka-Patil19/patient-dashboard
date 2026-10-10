// Colour follows the entity, never its rank: a diagnosis keeps its colour slot
// while it stays selected, and removing one never repaints the others.
export const MAX_SERIES = 3;

export function toggleSeries(selected, code) {
  if (selected.some((s) => s.code === code)) return selected.filter((s) => s.code !== code);
  if (selected.length >= MAX_SERIES) return selected;
  const used = new Set(selected.map((s) => s.slot));
  const slot = [...Array(MAX_SERIES).keys()].find((i) => !used.has(i));
  return [...selected, { code, slot }];
}

export function initialSeries(codes) {
  return codes.slice(0, MAX_SERIES).map((code, slot) => ({ code, slot }));
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when the given module is the script Node was started with. */
export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  const a = path.resolve(fileURLToPath(importMetaUrl));
  const b = path.resolve(process.argv[1]);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

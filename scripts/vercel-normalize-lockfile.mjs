/**
 * Vercel/Linux: normalize pnpm-lock.yaml so pnpm always parses lockfileVersion (BOM + CRLF fixes).
 */
import fs from 'node:fs';

const p = 'pnpm-lock.yaml';
if (!fs.existsSync(p)) {
  console.error(`vercel-normalize-lockfile: missing ${p}`);
  process.exit(1);
}
let s = fs.readFileSync(p, 'utf8');
if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
fs.writeFileSync(p, s);

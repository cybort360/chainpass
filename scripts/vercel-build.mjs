/**
 * Vercel: workspace build + copy client/dist → repo root dist/
 * (buildCommand in vercel.json is limited to 256 characters).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();
process.chdir(root);

const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const pnpmVer = pkg.packageManager.replace(/^pnpm@/, '');

function npxPnpm(args) {
  const r = spawnSync('npx', ['--yes', `pnpm@${pnpmVer}`, ...args], {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

npxPnpm(['--filter', '@chainpass/shared', 'run', 'build']);
npxPnpm(['--filter', 'client', 'run', 'build']);

const clientDist = path.join(root, 'client', 'dist');
const outDist = path.join(root, 'dist');
fs.rmSync(outDist, { recursive: true, force: true });
fs.cpSync(clientDist, outDist, { recursive: true });

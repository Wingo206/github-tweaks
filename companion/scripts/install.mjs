import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { name, version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const vsix = resolve(root, `${name}-${version}.vsix`);

execFileSync(
  'pnpm',
  ['exec', 'vsce', 'package', '--no-dependencies', '--allow-missing-repository', '--skip-license', '--out', vsix],
  { cwd: root, stdio: 'inherit' },
);
execFileSync('cursor', ['--install-extension', vsix, '--force'], { stdio: 'inherit' });

console.log(`Installed ${vsix}. Run "Developer: Reload Window" in each Cursor window.`);

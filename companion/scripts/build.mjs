import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [resolve(root, 'src/extension/extension.ts')],
    outfile: resolve(root, 'out/extension.js'),
    external: ['vscode'],
  }),
  build({
    ...shared,
    entryPoints: [resolve(root, 'src/server/main.ts')],
    outfile: resolve(root, 'out/server.js'),
  }),
]);

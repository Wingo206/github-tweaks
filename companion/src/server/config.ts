import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

export interface RememberedClone {
  path: string;
  remotes: string[];
  lastSeenAt: number;
}

export function defaultConfigDir(): string {
  return join(homedir(), '.config', 'github-tweaks-companion');
}

export function defaultSocketPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir && existsSync(runtimeDir)) {
    return join(runtimeDir, 'github-tweaks-companion.sock');
  }
  return join(tmpdir(), `github-tweaks-companion-${userInfo().uid}.sock`);
}

export function tokenPath(configDir: string): string {
  return join(configDir, 'token');
}

export function readToken(configDir: string): string | null {
  try {
    const token = readFileSync(tokenPath(configDir), 'utf8').trim();
    return /^[0-9a-f]{64}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function loadOrCreateToken(configDir: string): string {
  const existing = readToken(configDir);
  if (existing) {
    return existing;
  }
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('hex');
  writeFileSync(tokenPath(configDir), `${token}\n`, { mode: 0o600 });
  chmodSync(tokenPath(configDir), 0o600);
  return token;
}

export function loadClones(
  configDir: string,
  exists: (path: string) => boolean = existsSync,
): RememberedClone[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(configDir, 'clones.json'), 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (clone): clone is RememberedClone =>
      !!clone &&
      typeof clone === 'object' &&
      typeof clone.path === 'string' &&
      Array.isArray(clone.remotes) &&
      clone.remotes.every((remote: unknown) => typeof remote === 'string') &&
      typeof clone.lastSeenAt === 'number' &&
      exists(clone.path),
  );
}

export function saveClones(configDir: string, clones: RememberedClone[]): void {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const target = join(configDir, 'clones.json');
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(clones, null, 2)}\n`);
  renameSync(temporary, target);
}

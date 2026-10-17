import type {
  HealthResponse,
  OpenRequest,
  OpenResponse,
} from '../../companion/src/protocol';
import type {
  CompanionSettingsView,
  CompanionStatus,
  OpenFailureReason,
  OpenResult,
} from '../shared/types';

export const DEFAULT_COMPANION_PORT = 17380;

const PORT_KEY = 'companion-port';
const TOKEN_KEY = 'companion-token';
const LAUNCH_CACHE_KEY = 'companion-launch-cache';

const RETRY_INTERVAL_MS = 1_000;
const RETRY_BUDGET_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface CompanionSettings {
  port: number;
  token: string | null;
}

interface LaunchCacheEntry {
  folder: string;
  launchUrl: string;
}

export interface OpenDependencies {
  openUrl(url: string): Promise<void>;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

type Attempt =
  | { kind: 'offline' }
  | { kind: 'unauthorized' }
  | { kind: 'rejected'; message: string }
  | { kind: 'response'; response: OpenResponse };

export async function getCompanionSettings(): Promise<CompanionSettings> {
  const stored = await browser.storage.local.get([PORT_KEY, TOKEN_KEY]);
  const port = stored[PORT_KEY];
  const token = stored[TOKEN_KEY];
  return {
    port: isValidPort(port) ? port : DEFAULT_COMPANION_PORT,
    token: typeof token === 'string' && token.length > 0 ? token : null,
  };
}

export async function getCompanionSettingsView(): Promise<CompanionSettingsView> {
  const settings = await getCompanionSettings();
  return { port: settings.port, paired: settings.token !== null };
}

export async function saveCompanionSettings(update: {
  port?: number;
  token?: string;
}): Promise<CompanionSettingsView> {
  if (update.port !== undefined) {
    if (!isValidPort(update.port)) {
      throw new Error('Enter a port between 1 and 65535.');
    }
    await browser.storage.local.set({ [PORT_KEY]: update.port });
  }
  if (update.token !== undefined) {
    const token = update.token.trim();
    if (token) {
      await browser.storage.local.set({ [TOKEN_KEY]: token });
    } else {
      await browser.storage.local.remove(TOKEN_KEY);
    }
  }
  return getCompanionSettingsView();
}

export async function getCompanionStatus(): Promise<CompanionStatus> {
  const settings = await getCompanionSettings();
  if (!settings.token) {
    return { connected: false, reason: 'not-paired' };
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl(settings)}/health`, {
      headers: { Authorization: `Bearer ${settings.token}` },
    });
  } catch {
    return { connected: false, reason: 'offline' };
  }
  if (response.status === 401) {
    return { connected: false, reason: 'unauthorized' };
  }
  try {
    const health = (await response.json()) as HealthResponse;
    return { connected: true, version: health.version, windows: health.windows };
  } catch {
    return { connected: false, reason: 'offline' };
  }
}

/**
 * Sends `request` to the companion. When the server is not running, opens the
 * cached launch URL for the repository (at most once) and retries until the
 * new window's server answers.
 */
export async function openInCursor(
  request: OpenRequest,
  deps: OpenDependencies,
): Promise<OpenResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = deps.now ?? Date.now;
  const settings = await getCompanionSettings();
  if (!settings.token) {
    return failed(
      'not-paired',
      'Not paired. Run “GitHub Tweaks: Copy pairing token” in Cursor and paste it into the GitHub Tweaks popup.',
    );
  }

  const repoKey = request.repo.toLowerCase();
  let attempt = await postOpen(settings, request);

  if (attempt.kind === 'offline') {
    const cached = (await getLaunchCache())[repoKey];
    if (!cached) {
      return failed('companion-offline', 'Companion offline. Open a Cursor window to start it.');
    }
    await deps.openUrl(cached.launchUrl);
    const deadline = now() + RETRY_BUDGET_MS;
    while (true) {
      await sleep(RETRY_INTERVAL_MS);
      attempt = await postOpen(settings, request);
      const waiting =
        attempt.kind === 'offline' ||
        (attempt.kind === 'response' &&
          (attempt.response.status === 'launch' || attempt.response.status === 'launching'));
      if (attempt.kind === 'response') {
        await rememberLaunch(repoKey, attempt.response);
      }
      if (!waiting) {
        break;
      }
      if (now() >= deadline) {
        return failed('timeout', 'Cursor did not start in time.');
      }
    }
  } else if (attempt.kind === 'response') {
    await rememberLaunch(repoKey, attempt.response);
    if (attempt.response.status === 'launch') {
      await deps.openUrl(attempt.response.launchUrl);
    }
  }

  return toResult(attempt, request.repo);
}

function toResult(attempt: Attempt, repo: string): OpenResult {
  switch (attempt.kind) {
    case 'offline':
      return failed('companion-offline', 'Companion offline. Open a Cursor window to start it.');
    case 'unauthorized':
      return failed('not-paired', 'Pairing token rejected. Copy it again from Cursor.');
    case 'rejected':
      return failed('open-failed', attempt.message);
  }
  const { response } = attempt;
  switch (response.status) {
    case 'opened':
    case 'launch':
    case 'launching':
      return { status: 'opened' };
    case 'no-clone':
      return failed(
        'no-clone',
        `No local clone of ${repo} is known. Open it in Cursor once so the companion remembers it.`,
      );
    case 'error':
      return failed(response.reason, response.message);
  }
}

async function postOpen(settings: CompanionSettings, request: OpenRequest): Promise<Attempt> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl(settings)}/open`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
  } catch {
    return { kind: 'offline' };
  }
  if (response.status === 401) {
    return { kind: 'unauthorized' };
  }
  if (!response.ok) {
    return { kind: 'rejected', message: `The companion rejected the request (${response.status}).` };
  }
  try {
    return { kind: 'response', response: (await response.json()) as OpenResponse };
  } catch {
    return { kind: 'rejected', message: 'The companion returned an unreadable response.' };
  }
}

async function getLaunchCache(): Promise<Record<string, LaunchCacheEntry>> {
  const stored = (await browser.storage.local.get(LAUNCH_CACHE_KEY))[LAUNCH_CACHE_KEY];
  return stored && typeof stored === 'object' ? (stored as Record<string, LaunchCacheEntry>) : {};
}

async function rememberLaunch(repoKey: string, response: OpenResponse): Promise<void> {
  if (response.status !== 'opened' && response.status !== 'launch') {
    return;
  }
  const { folder, launchUrl } = response;
  if (!launchUrl?.startsWith('cursor://')) {
    return;
  }
  const cache = await getLaunchCache();
  const existing = cache[repoKey];
  if (existing && existing.folder === folder && existing.launchUrl === launchUrl) {
    return;
  }
  cache[repoKey] = { folder, launchUrl };
  await browser.storage.local.set({ [LAUNCH_CACHE_KEY]: cache });
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function baseUrl(settings: CompanionSettings): string {
  return `http://127.0.0.1:${settings.port}`;
}

function failed(reason: OpenFailureReason, message: string): OpenResult {
  return { status: 'failed', reason, message };
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

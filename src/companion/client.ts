import {
  describeCheckoutBlocker,
  type BranchStatusRequest,
  type BranchStatusResponse,
  type CheckoutRequest,
  type CheckoutResponse,
  type FocusRequest,
  type FocusResponse,
  type HealthResponse,
  type OpenRequest,
  type OpenResponse,
} from '../../companion/src/protocol';
import type {
  CheckoutActionResult,
  CheckoutStatusResult,
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

type Attempt<T = OpenResponse> =
  | { kind: 'offline' }
  | { kind: 'unauthorized' }
  | { kind: 'rejected'; message: string }
  | { kind: 'response'; response: T };

const NOT_PAIRED_MESSAGE =
  'Not paired. Run “GitHub Tweaks: Copy pairing token” in Cursor and paste it into the GitHub Tweaks popup.';
const OFFLINE_MESSAGE = 'Companion offline. Open a Cursor window to start it.';
const UNAUTHORIZED_MESSAGE = 'Pairing token rejected. Copy it again from Cursor.';

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
    return failed('not-paired', NOT_PAIRED_MESSAGE);
  }

  const repoKey = request.repo.toLowerCase();
  let attempt = await post<OpenResponse>(settings, '/open', request);

  if (attempt.kind === 'offline') {
    const cached = (await getLaunchCache())[repoKey];
    if (!cached) {
      return failed('companion-offline', OFFLINE_MESSAGE);
    }
    await deps.openUrl(cached.launchUrl);
    const deadline = now() + RETRY_BUDGET_MS;
    while (true) {
      await sleep(RETRY_INTERVAL_MS);
      attempt = await post<OpenResponse>(settings, '/open', request);
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

export async function getBranchStatus(request: BranchStatusRequest): Promise<CheckoutStatusResult> {
  const settings = await getCompanionSettings();
  if (!settings.token) {
    return { status: 'failed', reason: 'not-paired', message: NOT_PAIRED_MESSAGE };
  }
  const attempt = await post<BranchStatusResponse>(settings, '/branch-status', request);
  switch (attempt.kind) {
    case 'offline':
      return { status: 'failed', reason: 'companion-offline', message: OFFLINE_MESSAGE };
    case 'unauthorized':
      return { status: 'failed', reason: 'not-paired', message: UNAUTHORIZED_MESSAGE };
    case 'rejected':
      return { status: 'failed', reason: 'failed', message: attempt.message };
    case 'response':
      return { status: 'ok', clones: attempt.response.clones };
  }
}

/** Starts a checkout in the clone's Cursor window and brings it forward. */
export async function startCheckout(
  request: CheckoutRequest,
  deps: Pick<OpenDependencies, 'openUrl'>,
): Promise<CheckoutActionResult> {
  const attempt = await postAction<CheckoutResponse>('/checkout', request);
  if (attempt.kind !== 'response') {
    return attempt.result;
  }
  const { response } = attempt;
  switch (response.status) {
    case 'started':
    case 'checked-out':
      if (response.launchUrl) {
        await deps.openUrl(response.launchUrl);
      }
      return { status: response.status };
    case 'blocked':
      return { status: 'failed', message: `${describeCheckoutBlocker(response.blocker)}.` };
    case 'not-open':
      return { status: 'failed', message: 'That clone is no longer open in Cursor.' };
    case 'error':
      return { status: 'failed', message: response.message };
  }
}

export async function focusFolder(
  request: FocusRequest,
  deps: Pick<OpenDependencies, 'openUrl'>,
): Promise<CheckoutActionResult> {
  const attempt = await postAction<FocusResponse>('/focus', request);
  if (attempt.kind !== 'response') {
    return attempt.result;
  }
  const { response } = attempt;
  switch (response.status) {
    case 'focused':
      return { status: 'focused' };
    case 'launch':
      await deps.openUrl(response.launchUrl);
      return { status: 'focused' };
    case 'not-open':
      return { status: 'failed', message: 'That clone is no longer open in Cursor.' };
  }
}

async function postAction<T>(
  path: string,
  body: unknown,
): Promise<{ kind: 'response'; response: T } | { kind: 'failed'; result: CheckoutActionResult }> {
  const settings = await getCompanionSettings();
  if (!settings.token) {
    return { kind: 'failed', result: { status: 'failed', message: NOT_PAIRED_MESSAGE } };
  }
  const attempt = await post<T>(settings, path, body);
  switch (attempt.kind) {
    case 'offline':
      return { kind: 'failed', result: { status: 'failed', message: OFFLINE_MESSAGE } };
    case 'unauthorized':
      return { kind: 'failed', result: { status: 'failed', message: UNAUTHORIZED_MESSAGE } };
    case 'rejected':
      return { kind: 'failed', result: { status: 'failed', message: attempt.message } };
    case 'response':
      return attempt;
  }
}

function toResult(attempt: Attempt, repo: string): OpenResult {
  switch (attempt.kind) {
    case 'offline':
      return failed('companion-offline', OFFLINE_MESSAGE);
    case 'unauthorized':
      return failed('not-paired', UNAUTHORIZED_MESSAGE);
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

async function post<T>(settings: CompanionSettings, path: string, body: unknown): Promise<Attempt<T>> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl(settings)}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
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
    return { kind: 'response', response: (await response.json()) as T };
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

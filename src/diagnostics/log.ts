import type { PerfLogEntry, StoredPerfLogEntry } from '../shared/types';

export const PERF_LOG_KEY = 'perf-log';
/** About 10 minutes of samples across a few tabs. */
export const PERF_LOG_LIMIT = 2_000;

let writes: Promise<void> = Promise.resolve();

/** Appends in order, one write at a time, so tabs logging together don't overwrite each other. */
export function appendPerfLog(entries: readonly PerfLogEntry[], tabId: number | null): Promise<void> {
  writes = writes
    .then(async () => {
      const stored = await readPerfLog();
      stored.push(...entries.map((entry) => ({ ...entry, tabId })));
      await browser.storage.local.set({ [PERF_LOG_KEY]: stored.slice(-PERF_LOG_LIMIT) });
    })
    .catch(() => {});
  return writes;
}

export async function readPerfLog(): Promise<StoredPerfLogEntry[]> {
  const stored = (await browser.storage.local.get(PERF_LOG_KEY))[PERF_LOG_KEY];
  return Array.isArray(stored) ? (stored as StoredPerfLogEntry[]) : [];
}

export function clearPerfLog(): Promise<void> {
  writes = writes.then(() => browser.storage.local.remove(PERF_LOG_KEY)).catch(() => {});
  return writes;
}

/** "12 samples from 2 page loads, 1 of which never finished (crashed or still open)". */
export function summarizePerfLog(entries: readonly StoredPerfLogEntry[]): string {
  const sessions = new Set(entries.map((entry) => entry.session));
  const ended = new Set(entries.filter((entry) => entry.kind === 'end').map((entry) => entry.session));
  const samples = entries.filter((entry) => entry.kind === 'sample').length;
  const open = [...sessions].filter((session) => !ended.has(session)).length;
  const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;
  const base = `${plural(samples, 'sample')} from ${plural(sessions.size, 'page load')}`;
  return open ? `${base}, ${open} of which never finished (crashed or still open)` : base;
}

export function perfLogFilename(exportedAt: string): string {
  return `ght-perf-log-${exportedAt.replace(/[:.]/g, '-')}.json`;
}

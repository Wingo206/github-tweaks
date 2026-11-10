import { describe, expect, it } from 'vitest';
import type { PerfLogEntry } from '../shared/types';
import { appendPerfLog, clearPerfLog, PERF_LOG_LIMIT, readPerfLog, summarizePerfLog } from './log';

function entry(session: string, kind: 'start' | 'end' | 'slow' = 'slow', t = 0): PerfLogEntry {
  const base = { session, at: '2026-11-10T00:00:00.000Z', t };
  if (kind === 'start') {
    return { ...base, kind, url: 'https://github.com/', build: 'dev', userAgent: 'test' };
  }
  if (kind === 'end') {
    return { ...base, kind, reason: 'pagehide' };
  }
  return { ...base, kind, key: 'pr-sticky-tabs sync', ms: 250 };
}

describe('performance log storage', () => {
  it('appends entries in order with the tab they came from', async () => {
    void appendPerfLog([entry('a', 'start')], 7);
    await appendPerfLog([entry('a', 'slow', 5)], 7);
    expect((await readPerfLog()).map(({ kind, tabId }) => [kind, tabId])).toEqual([
      ['start', 7],
      ['slow', 7],
    ]);
  });

  it('keeps only the newest entries', async () => {
    await appendPerfLog(
      Array.from({ length: PERF_LOG_LIMIT + 5 }, (_, index) => entry('a', 'slow', index)),
      null,
    );
    const stored = await readPerfLog();
    expect(stored).toHaveLength(PERF_LOG_LIMIT);
    expect(stored[0]!.t).toBe(5);
  });

  it('clears', async () => {
    await appendPerfLog([entry('a')], null);
    await clearPerfLog();
    expect(await readPerfLog()).toEqual([]);
  });

  it('summarizes page loads, and the ones that never finished', () => {
    const stored = [entry('a', 'start'), entry('a', 'end'), entry('b', 'start')].map((item) => ({
      ...item,
      tabId: 1,
    }));
    expect(summarizePerfLog(stored)).toBe(
      '0 samples from 2 page loads, 1 of which never finished (crashed or still open)',
    );
  });
});

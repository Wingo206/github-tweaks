import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PerfLogEntry } from '../shared/types';
import { startPerfLog, stopPerfLog, tracked, trackedObserver } from './recorder';

let sent: PerfLogEntry[] = [];

function start(): void {
  sent = [];
  startPerfLog((entries) => sent.push(...entries));
}

function ofKind<K extends PerfLogEntry['kind']>(kind: K): Extract<PerfLogEntry, { kind: K }>[] {
  return sent.filter((entry): entry is Extract<PerfLogEntry, { kind: K }> => entry.kind === kind);
}

afterEach(() => {
  stopPerfLog();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('performance log recorder', () => {
  it('runs work untouched while the log is off', () => {
    expect(tracked('pr-sticky-tabs', 'sync', () => 42)).toBe(42);
  });

  it('starts a session, then samples page changes and each feature’s work', async () => {
    vi.useFakeTimers();
    start();
    const observer = trackedObserver('pr-sticky-tabs', () => {});
    observer.observe(document.body, { childList: true });
    document.body.append(...Array.from({ length: 10 }, () => document.createElement('div')));
    await Promise.resolve();
    tracked('pr-sticky-tabs', 'sync', () => {});
    tracked('pr-sticky-tabs', 'sync', () => {});
    observer.disconnect();
    vi.advanceTimersByTime(5_000);

    expect(ofKind('start')).toEqual([expect.objectContaining({ build: 'dev', t: 0 })]);
    const [sample] = ofKind('sample');
    expect(sample!.pageAddedPerSec).toBe(2);
    expect(sample!.work.map(({ key, calls, records }) => [key, calls, records])).toEqual(
      expect.arrayContaining([
        ['pr-sticky-tabs observer', 1, 1],
        ['pr-sticky-tabs sync', 2, 0],
      ]),
    );
  });

  it('reports slow work right away, once per sample window', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    start();
    tracked('pr-sidebar-metadata', 'render', () => {
      now += 300;
    });
    tracked('pr-sidebar-metadata', 'render', () => {
      now += 400;
    });
    expect(ofKind('slow')).toEqual([expect.objectContaining({ key: 'pr-sidebar-metadata render', ms: 300 })]);
  });

  it('keeps reporting slow work, and samples from it when the timer is starved', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    start();
    for (let call = 0; call < 3; call += 1) {
      tracked('pr-auto-collapse-viewed', 'reconcile', () => {
        now += 6_000;
      });
    }
    expect(ofKind('slow')).toHaveLength(3);
    const samples = ofKind('sample');
    expect(samples.length).toBeGreaterThan(0);
    expect(samples[0]!.work[0]).toMatchObject({ key: 'pr-auto-collapse-viewed reconcile', maxMs: 6_000 });
    expect(samples[0]!.timerLateMs).toBeGreaterThan(0);
  });

  it('still times work that throws', () => {
    start();
    expect(() =>
      tracked('open-in-cursor', 'sync', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
  });

  it('ends the session when stopped or when the page is hidden for good', () => {
    start();
    window.dispatchEvent(new Event('pagehide'));
    stopPerfLog();
    expect(ofKind('end').map((entry) => entry.reason)).toEqual(['pagehide', 'stopped']);
    expect(tracked('open-in-cursor', 'sync', () => 'still runs')).toBe('still runs');
  });
});

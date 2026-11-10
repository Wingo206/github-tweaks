import { BUILD_TIME } from '../shared/build';
import { sendBackgroundMessage } from '../shared/messaging';
import type { PerfLogEntry, PerfWorkStat } from '../shared/types';

const SAMPLE_MS = 5_000;
/** One callback taking longer than this is reported right away (at most every 5 s per step). */
const SLOW_MS = 200;
/** This many mutation records in one sample window are reported right away. */
const BURST_RECORDS = 20_000;
const TOP_WORK = 10;

/** Attributes GitHub Tweaks puts on the elements it adds. */
const EXTENSION_MARKERS = [
  'data-ght-pr-metadata',
  'data-ght-tree-viewport',
  'data-ght-open-in-cursor',
  'data-ght-checkout-branch',
  'data-ght-sticky-tabs',
  'data-ght-handback',
  'data-ght-pp-pin',
  'data-ght-pp-pinned',
  'data-ght-pin-button',
  'data-ght-pins',
  'data-ght-mermaid-open',
];

type Send = (entries: PerfLogEntry[]) => void;

const sendToBackground: Send = (entries) => {
  void sendBackgroundMessage<void>({ type: 'perf-log:append', entries }).catch(() => {});
};

let recorder: Recorder | null = null;

/**
 * A MutationObserver whose callbacks are timed under `feature` while the
 * performance log is on.
 */
export function trackedObserver(feature: string, callback: MutationCallback): MutationObserver {
  return new MutationObserver((records, observer) =>
    measure(`${feature} observer`, records.length, () => callback(records, observer)),
  );
}

/** Runs `work`, timing it under `feature` and `label` while the performance log is on. */
export function tracked<T>(feature: string, label: string, work: () => T): T {
  return measure(`${feature} ${label}`, 0, work);
}

function measure<T>(key: string, records: number, work: () => T): T {
  return recorder ? recorder.measure(key, records, work) : work();
}

export function startPerfLog(send: Send = sendToBackground): void {
  if (recorder) {
    return;
  }
  recorder = new Recorder(send);
  recorder.start();
}

export function stopPerfLog(): void {
  recorder?.stop();
  recorder = null;
}

interface SampleWindow {
  records: number;
  added: number;
  removed: number;
  extensionWrites: number;
  longTaskMs: number;
  attributes: Map<string, number>;
  work: Map<string, PerfWorkStat>;
}

function freshWindow(): SampleWindow {
  return {
    records: 0,
    added: 0,
    removed: 0,
    extensionWrites: 0,
    longTaskMs: 0,
    attributes: new Map(),
    work: new Map(),
  };
}

class Recorder {
  private readonly session = crypto.randomUUID();
  private readonly startedAt = performance.now();
  private counts: SampleWindow = freshWindow();
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastSampleAt = performance.now();
  private pageObserver: MutationObserver | null = null;
  private longTasks: PerformanceObserver | null = null;
  /** When each slow or burst note was last sent, so a stuck tab can't flood the log. */
  private readonly reportedAt = new Map<string, number>();

  constructor(private readonly send: Send) {}

  start(): void {
    this.emit({
      ...this.base(),
      kind: 'start',
      url: location.href,
      build: BUILD_TIME,
      userAgent: navigator.userAgent,
    });
    this.pageObserver = new MutationObserver((records) => this.countPage(records));
    this.pageObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    try {
      this.longTasks = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.counts.longTaskMs += entry.duration;
        }
      });
      this.longTasks.observe({ type: 'longtask' });
    } catch {
      this.longTasks = null;
    }
    this.timer = setInterval(() => this.sample(), SAMPLE_MS);
    window.addEventListener('pagehide', this.onPageHide);
  }

  stop(): void {
    clearInterval(this.timer);
    this.pageObserver?.disconnect();
    this.longTasks?.disconnect();
    window.removeEventListener('pagehide', this.onPageHide);
    this.emit({ ...this.base(), kind: 'end', reason: 'stopped' });
  }

  measure<T>(key: string, records: number, work: () => T): T {
    const started = performance.now();
    try {
      return work();
    } finally {
      const ms = performance.now() - started;
      const stat = this.counts.work.get(key) ?? { key, calls: 0, ms: 0, maxMs: 0, records: 0 };
      this.counts.work.set(key, stat);
      stat.calls += 1;
      stat.ms += ms;
      stat.records += records;
      stat.maxMs = Math.max(stat.maxMs, ms);
      if (ms > SLOW_MS) {
        this.reportOnce(`slow ${key}`, () => ({ ...this.base(), kind: 'slow', key, ms: round(ms) }));
      }
      if (stat.records > BURST_RECORDS) {
        this.reportOnce(`burst ${key}`, () => ({
          ...this.base(),
          kind: 'burst',
          key,
          records: stat.records,
        }));
      }
      // A tab stuck in back-to-back long frames never runs its sample timer.
      if (performance.now() - this.lastSampleAt > SAMPLE_MS * 2) {
        this.sample();
      }
    }
  }

  private countPage(records: MutationRecord[]): void {
    const current = this.counts;
    current.records += records.length;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!;
      if (record.type === 'attributes') {
        const name = record.attributeName ?? '';
        current.attributes.set(name, (current.attributes.get(name) ?? 0) + 1);
        if (name.startsWith('data-ght')) {
          current.extensionWrites += 1;
        }
      } else if (record.type === 'childList') {
        current.added += record.addedNodes.length;
        current.removed += record.removedNodes.length;
        if (index < 200) {
          for (const node of record.addedNodes) {
            if (isExtensionNode(node)) {
              current.extensionWrites += 1;
            }
          }
        }
      }
    }
    if (current.records > BURST_RECORDS) {
      this.reportOnce('burst page', () => ({
        ...this.base(),
        kind: 'burst',
        key: 'page',
        records: current.records,
      }));
    }
  }

  private sample(): void {
    const now = performance.now();
    const elapsed = now - this.lastSampleAt;
    this.lastSampleAt = now;
    const current = this.counts;
    this.counts = freshWindow();
    const perSecond = (count: number): number => Math.round(count / (elapsed / 1000));
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;

    this.emit({
      ...this.base(),
      kind: 'sample',
      url: location.href,
      hidden: document.hidden,
      heapMB: heap ? Math.round(heap.usedJSHeapSize / 1e6) : null,
      domNodes: document.getElementsByTagName('*').length,
      extensionNodes: Object.fromEntries(
        EXTENSION_MARKERS.map((marker) => [marker.slice('data-ght-'.length), document.querySelectorAll(`[${marker}]`).length])
          .filter(([, count]) => count),
      ),
      pageMutationsPerSec: perSecond(current.records),
      pageAddedPerSec: perSecond(current.added),
      pageRemovedPerSec: perSecond(current.removed),
      extensionWritesPerSec: perSecond(current.extensionWrites),
      topAttributes: [...current.attributes]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 4)
        .map(([name, count]) => `${name} ×${count}`),
      longTaskMs: Math.round(current.longTaskMs),
      timerLateMs: Math.max(0, Math.round(elapsed - SAMPLE_MS)),
      work: [...current.work.values()]
        .sort((left, right) => right.ms - left.ms)
        .slice(0, TOP_WORK)
        .map((stat) => ({ ...stat, ms: round(stat.ms), maxMs: round(stat.maxMs) })),
    });
  }

  private reportOnce(id: string, entry: () => PerfLogEntry): void {
    const now = performance.now();
    const last = this.reportedAt.get(id);
    if (last === undefined || now - last >= SAMPLE_MS) {
      this.reportedAt.set(id, now);
      this.emit(entry());
    }
  }

  private emit(entry: PerfLogEntry): void {
    try {
      this.send([entry]);
    } catch {
      // The log must never break the page.
    }
  }

  private base(): { session: string; at: string; t: number } {
    return {
      session: this.session,
      at: new Date().toISOString(),
      t: Math.round((performance.now() - this.startedAt) / 1000),
    };
  }

  private readonly onPageHide = (): void => {
    this.emit({ ...this.base(), kind: 'end', reason: 'pagehide' });
  };
}

function isExtensionNode(node: Node): boolean {
  if (!(node instanceof Element)) {
    return false;
  }
  return (
    (typeof node.className === 'string' && /(^|\s)ght-/.test(node.className)) ||
    node.getAttributeNames().some((name) => name.startsWith('data-ght'))
  );
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

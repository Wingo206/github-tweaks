import type { OpenRequest } from '../protocol';

export const LAUNCH_WINDOW_MS = 60_000;

interface LaunchRecord {
  launchedAt: number;
  request: OpenRequest | null;
  queuedAt: number;
}

/**
 * Open requests waiting for a launched Cursor window to connect, keyed by
 * folder path. A folder is launched at most once per `LAUNCH_WINDOW_MS`.
 */
export class LaunchQueue {
  private readonly records = new Map<string, LaunchRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Queues `request` for `folder`. Returns `launch` when the caller should
   * open a new window, or `launching` when one was launched recently.
   */
  enqueue(folder: string, request: OpenRequest): 'launch' | 'launching' {
    this.prune();
    const now = this.now();
    const existing = this.records.get(folder);
    if (existing && now - existing.launchedAt < LAUNCH_WINDOW_MS) {
      existing.request = request;
      existing.queuedAt = now;
      return 'launching';
    }
    this.records.set(folder, { launchedAt: now, request, queuedAt: now });
    return 'launch';
  }

  /** Removes and returns the live queued request for `folder`, if any. */
  take(folder: string): OpenRequest | null {
    this.prune();
    const record = this.records.get(folder);
    if (!record?.request) {
      return null;
    }
    const { request } = record;
    record.request = null;
    return request;
  }

  private prune(): void {
    const now = this.now();
    for (const [folder, record] of this.records) {
      if (record.request && now - record.queuedAt >= LAUNCH_WINDOW_MS) {
        record.request = null;
      }
      if (now - record.launchedAt >= LAUNCH_WINDOW_MS && !record.request) {
        this.records.delete(folder);
      }
    }
  }
}

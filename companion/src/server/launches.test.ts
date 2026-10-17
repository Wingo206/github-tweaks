import { describe, expect, it } from 'vitest';
import type { OpenRequest } from '../protocol';
import { LAUNCH_WINDOW_MS, LaunchQueue } from './launches';

function request(line: number): OpenRequest {
  return { repo: 'acme/widgets', path: 'a.ts', line, column: 1, ref: null };
}

describe('LaunchQueue', () => {
  it('launches once per folder and replaces the queued request', () => {
    let now = 0;
    const queue = new LaunchQueue(() => now);
    expect(queue.enqueue('/w', request(1))).toBe('launch');
    now = 1_000;
    expect(queue.enqueue('/w', request(2))).toBe('launching');
    expect(queue.enqueue('/other', request(3))).toBe('launch');
    expect(queue.take('/w')).toEqual(request(2));
    expect(queue.take('/w')).toBeNull();
  });

  it('expires queued requests and allows a new launch after the window', () => {
    let now = 0;
    const queue = new LaunchQueue(() => now);
    queue.enqueue('/w', request(1));
    now = LAUNCH_WINDOW_MS;
    expect(queue.take('/w')).toBeNull();
    expect(queue.enqueue('/w', request(2))).toBe('launch');
  });

  it('launches again once the launch is old even if a replacement is still queued', () => {
    let now = 0;
    const queue = new LaunchQueue(() => now);
    queue.enqueue('/w', request(1));
    now = LAUNCH_WINDOW_MS - 1;
    expect(queue.enqueue('/w', request(2))).toBe('launching');
    now = LAUNCH_WINDOW_MS + 1;
    expect(queue.enqueue('/w', request(3))).toBe('launch');
    expect(queue.take('/w')).toEqual(request(3));
  });
});

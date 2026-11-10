import { describe, expect, it, vi } from 'vitest';
import { LayoutFeatures } from './layouts';
import type { Feature } from './types';

function fake(matches: boolean): Feature & { calls: string[] } {
  const calls: string[] = [];
  return {
    id: 'pr-people-pins',
    calls,
    matches: vi.fn(() => matches),
    start: vi.fn(() => void calls.push('start')),
    update: vi.fn(() => void calls.push('update')),
    stop: vi.fn(() => void calls.push('stop')),
  };
}

describe('LayoutFeatures', () => {
  it('forwards every lifecycle call to each layout’s implementation', async () => {
    const current = fake(true);
    const classic = fake(true);
    const feature = new LayoutFeatures('pr-people-pins', [current, classic]);
    const context = { url: new URL('https://github.com/acme/widgets/pull/42') };

    expect(feature.matches(context)).toBe(true);
    await feature.start(context);
    await feature.update(context);
    feature.stop();
    expect(current.calls).toEqual(['start', 'update', 'stop']);
    expect(classic.calls).toEqual(['start', 'update', 'stop']);
  });

  it('matches when any implementation does', () => {
    const feature = new LayoutFeatures('pr-people-pins', [fake(false), fake(false)]);
    expect(feature.matches({ url: new URL('https://github.com/') })).toBe(false);
  });
});

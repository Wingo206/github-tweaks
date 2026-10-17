import { describe, expect, it } from 'vitest';
import { getFeatureFlags, setFeatureEnabled } from './flags';
import { FEATURES, resolveFeatureFlags } from './registry';

describe('feature flags', () => {
  it('enables every feature by default', async () => {
    const flags = await getFeatureFlags();

    for (const feature of FEATURES) {
      expect(flags[feature.id]).toBe(feature.defaultEnabled);
    }
  });

  it('persists a toggle without touching other features', async () => {
    await setFeatureEnabled('mermaid-fullscreen', false);

    const flags = await getFeatureFlags();
    expect(flags['mermaid-fullscreen']).toBe(false);
    expect(flags['pr-people-pins']).toBe(true);

    await setFeatureEnabled('mermaid-fullscreen', true);
    await expect(getFeatureFlags()).resolves.toMatchObject({
      'mermaid-fullscreen': true,
    });
  });

  it('ignores malformed and unknown stored values', () => {
    expect(
      resolveFeatureFlags({
        'pr-sidebar-metadata': 'no',
        'removed-feature': false,
      }),
    ).toEqual(resolveFeatureFlags(undefined));
    expect(resolveFeatureFlags('garbage')['pr-sidebar-metadata']).toBe(true);
  });
});

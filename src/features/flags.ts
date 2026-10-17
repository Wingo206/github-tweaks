import { resolveFeatureFlags, type FeatureFlags, type FeatureId } from './registry';

const FLAGS_KEY = 'feature-flags';

export async function getFeatureFlags(): Promise<FeatureFlags> {
  const result = await browser.storage.local.get(FLAGS_KEY);
  return resolveFeatureFlags(result[FLAGS_KEY]);
}

export async function setFeatureEnabled(
  id: FeatureId,
  enabled: boolean,
): Promise<FeatureFlags> {
  const result = await browser.storage.local.get(FLAGS_KEY);
  const stored =
    result[FLAGS_KEY] && typeof result[FLAGS_KEY] === 'object'
      ? (result[FLAGS_KEY] as Record<string, unknown>)
      : {};
  const next = { ...stored, [id]: enabled };
  await browser.storage.local.set({ [FLAGS_KEY]: next });
  return resolveFeatureFlags(next);
}

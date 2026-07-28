import type {
  PullRequestFilesSnapshot,
  PullRequestRef,
} from '../shared/types';

const TOKEN_KEY = 'github-token';
const CACHE_PREFIX = 'pull-files:';

function cacheKey(ref: PullRequestRef): string {
  return `${CACHE_PREFIX}${ref.owner}/${ref.repository}#${ref.number}`;
}

export async function getToken(): Promise<string | null> {
  const result = await browser.storage.local.get(TOKEN_KEY);
  const token = result[TOKEN_KEY];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

export async function saveToken(token: string): Promise<void> {
  await browser.storage.local.set({ [TOKEN_KEY]: token });
}

export async function removeToken(): Promise<void> {
  await browser.storage.local.remove(TOKEN_KEY);
}

export async function getCachedPullRequest(
  ref: PullRequestRef,
): Promise<PullRequestFilesSnapshot | null> {
  const key = cacheKey(ref);
  const result = await browser.storage.local.get(key);
  const snapshot = result[key];

  return isSnapshot(snapshot) ? snapshot : null;
}

export async function cachePullRequest(
  snapshot: PullRequestFilesSnapshot,
): Promise<void> {
  await browser.storage.local.set({ [cacheKey(snapshot.ref)]: snapshot });
}

function isSnapshot(value: unknown): value is PullRequestFilesSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PullRequestFilesSnapshot>;
  return (
    typeof candidate.pullRequestId === 'string' &&
    typeof candidate.headOid === 'string' &&
    typeof candidate.savedAt === 'number' &&
    Array.isArray(candidate.files) &&
    !!candidate.ref
  );
}

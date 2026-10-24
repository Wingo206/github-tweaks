import type {
  PinnedPerson,
  PullRequestChangeSelection,
  PullRequestFilesSnapshot,
  PullRequestRef,
} from '../shared/types';

const TOKEN_KEY = 'github-token';
const CACHE_PREFIX = 'pull-files:';

function cacheKey(
  ref: PullRequestRef,
  selection: PullRequestChangeSelection,
): string {
  const suffix =
    selection.kind === 'all'
      ? 'all'
      : selection.kind === 'commit'
        ? `commit:${selection.oid}`
        : `range:${selection.startOid}..${selection.endOid}`;
  return `${CACHE_PREFIX}${ref.owner}/${ref.repository}#${ref.number}:${suffix}`;
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
  selection: PullRequestChangeSelection,
): Promise<PullRequestFilesSnapshot | null> {
  const key = cacheKey(ref, selection);
  const result = await browser.storage.local.get(key);
  const snapshot = result[key];

  return isSnapshot(snapshot) ? snapshot : null;
}

export async function cachePullRequest(
  snapshot: PullRequestFilesSnapshot,
): Promise<void> {
  await browser.storage.local.set({
    [cacheKey(snapshot.ref, snapshot.selection)]: snapshot,
  });
}

export async function updateCachedViewedState(
  ref: PullRequestRef,
  selection: PullRequestChangeSelection,
  pullRequestId: string,
  path: string,
  viewed: boolean,
): Promise<void> {
  const cached = await getCachedPullRequest(ref, selection);
  if (!cached || cached.pullRequestId !== pullRequestId) {
    return;
  }

  await cachePullRequest({
    ...cached,
    files: cached.files.map((file) =>
      file.path === path
        ? { ...file, viewedState: viewed ? 'VIEWED' : 'UNVIEWED' }
        : file,
    ),
  });
}

const PINS_PREFIX = 'people-pins:';

export function peoplePinsKey(owner: string, repository: string): string {
  return `${PINS_PREFIX}${owner.trim().toLowerCase()}/${repository.trim().toLowerCase()}`;
}

export async function getPeoplePins(
  owner: string,
  repository: string,
): Promise<PinnedPerson[]> {
  const key = peoplePinsKey(owner, repository);
  const result = await browser.storage.local.get(key);
  const people = result[key];
  if (!Array.isArray(people)) {
    return [];
  }

  return people.filter(isPinnedPerson).sort(comparePins);
}

export async function savePeoplePins(
  owner: string,
  repository: string,
  people: PinnedPerson[],
): Promise<PinnedPerson[]> {
  const stored = people.filter(isPinnedPerson).sort(comparePins);
  await browser.storage.local.set({
    [peoplePinsKey(owner, repository)]: stored,
  });
  return stored;
}

function comparePins(left: PinnedPerson, right: PinnedPerson): number {
  return left.login.localeCompare(right.login, undefined, { sensitivity: 'base' });
}

function isPinnedPerson(value: unknown): value is PinnedPerson {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const person = value as Partial<PinnedPerson>;
  return (
    typeof person.id === 'string' &&
    /^[0-9]+$/.test(person.id) &&
    typeof person.login === 'string' &&
    person.login.length > 0 &&
    !person.login.includes('/') &&
    typeof person.name === 'string' &&
    typeof person.avatarUrl === 'string' &&
    (person.avatarUrl.length === 0 || person.avatarUrl.startsWith('https://'))
  );
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
    isSelection(candidate.selection) &&
    Array.isArray(candidate.files) &&
    !!candidate.ref
  );
}

function isSelection(
  value: unknown,
): value is PullRequestChangeSelection {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<PullRequestChangeSelection>;
  return (
    candidate.kind === 'all' ||
    (candidate.kind === 'commit' &&
      typeof candidate.oid === 'string') ||
    (candidate.kind === 'range' &&
      typeof candidate.startOid === 'string' &&
      typeof candidate.endOid === 'string')
  );
}

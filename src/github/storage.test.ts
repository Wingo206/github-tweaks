import { describe, expect, it } from 'vitest';
import {
  cachePullRequest,
  getCachedPullRequest,
  getPeoplePins,
  savePeoplePins,
  updateCachedViewedState,
} from './storage';
import type { PinnedPerson, PullRequestFilesSnapshot } from '../shared/types';

const ben: PinnedPerson = {
  id: '22',
  login: 'ben',
  name: 'Ben Adey',
  avatarUrl: 'https://avatars.githubusercontent.com/u/22?s=40&v=4',
};
const ada: PinnedPerson = {
  id: '33',
  login: 'ada',
  name: 'Ada Lovelace',
  avatarUrl: '',
};

describe('people pin storage', () => {
  it('stores a per-repository list in alphabetical order', async () => {
    await savePeoplePins('Acme', 'Widgets', [ben, ada]);

    await expect(getPeoplePins('acme', 'widgets')).resolves.toEqual([ada, ben]);
    await expect(getPeoplePins('acme', 'other')).resolves.toEqual([]);
  });

  it('drops teams and unsafe records', async () => {
    await savePeoplePins('acme', 'widgets', [
      ada,
      {
        id: '99',
        login: 'acme/platform',
        name: 'Platform',
        avatarUrl: '',
      },
      {
        id: '5',
        login: 'bad',
        name: 'Bad',
        avatarUrl: 'javascript:alert(1)',
      },
    ]);

    await expect(getPeoplePins('acme', 'widgets')).resolves.toEqual([ada]);
  });
});

describe('pull request cache', () => {
  const snapshot: PullRequestFilesSnapshot = {
    ref: { owner: 'acme', repository: 'widgets', number: 42 },
    selection: { kind: 'all' },
    pullRequestId: 'PR_1',
    headOid: 'head',
    savedAt: 1,
    files: [
      { path: 'src/a.ts', additions: 1, deletions: 0, viewedState: 'UNVIEWED' },
      { path: 'src/b.ts', additions: 2, deletions: 0, viewedState: 'UNVIEWED' },
    ],
  };

  it('updates one file’s viewed state in the cached snapshot', async () => {
    await cachePullRequest(snapshot);

    await updateCachedViewedState(snapshot.ref, snapshot.selection, 'PR_1', 'src/a.ts', true);

    const cached = await getCachedPullRequest(snapshot.ref, snapshot.selection);
    expect(cached?.files.map((file) => file.viewedState)).toEqual(['VIEWED', 'UNVIEWED']);
  });

  it('leaves a cache for a different pull request id alone', async () => {
    await cachePullRequest(snapshot);

    await updateCachedViewedState(snapshot.ref, snapshot.selection, 'PR_other', 'src/a.ts', true);

    const cached = await getCachedPullRequest(snapshot.ref, snapshot.selection);
    expect(cached?.files[0]?.viewedState).toBe('UNVIEWED');
  });
});

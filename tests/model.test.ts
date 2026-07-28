import { describe, expect, it } from 'vitest';
import {
  aggregateFolder,
  parsePullRequestUrl,
  updateFileViewedState,
} from '../src/features/pr-sidebar-metadata/model';
import type { PullRequestFilesSnapshot } from '../src/shared/types';

const snapshot: PullRequestFilesSnapshot = {
  ref: { owner: 'acme', repository: 'widgets', number: 42 },
  pullRequestId: 'PR_1',
  headOid: 'abc',
  savedAt: 1,
  files: [
    {
      path: 'src/index.ts',
      additions: 5,
      deletions: 2,
      viewedState: 'UNVIEWED',
    },
    {
      path: 'src/components/button.ts',
      additions: 3,
      deletions: 0,
      viewedState: 'VIEWED',
    },
    {
      path: 'docs/readme.md',
      additions: 1,
      deletions: 1,
      viewedState: 'DISMISSED',
    },
  ],
};

describe('pull request sidebar model', () => {
  it('parses both current and legacy changed-files routes', () => {
    expect(
      parsePullRequestUrl(
        new URL('https://github.com/acme/widgets/pull/42/changes'),
      ),
    ).toEqual({ owner: 'acme', repository: 'widgets', number: 42 });
    expect(
      parsePullRequestUrl(
        new URL('https://github.com/acme/widgets/pull/42/files'),
      ),
    ).toEqual({ owner: 'acme', repository: 'widgets', number: 42 });
    expect(
      parsePullRequestUrl(
        new URL('https://github.com/acme/widgets/pull/42/checks'),
      ),
    ).toBeNull();
  });

  it('aggregates all descendants and counts dismissed as unviewed', () => {
    expect(aggregateFolder('src', snapshot.files)).toEqual({
      additions: 8,
      deletions: 2,
      viewed: 1,
      total: 2,
    });
  });

  it('updates one file without mutating the snapshot', () => {
    const updated = updateFileViewedState(snapshot, 'src/index.ts', true);
    expect(updated.files[0]?.viewedState).toBe('VIEWED');
    expect(snapshot.files[0]?.viewedState).toBe('UNVIEWED');
  });
});

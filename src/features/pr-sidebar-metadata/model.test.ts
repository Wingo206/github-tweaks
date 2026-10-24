import { describe, expect, it } from 'vitest';
import {
  aggregateFolder,
  applyViewedOverrides,
  aggregateLineViewProgress,
  formatLineViewProgressLabel,
  lineViewProgressRatio,
  parseChangeSelection,
  parsePullRequestUrl,
  sameChangeSelection,
  updateFileViewedState,
} from './model';
import type { PullRequestFilesSnapshot } from '../../shared/types';

const snapshot: PullRequestFilesSnapshot = {
  ref: { owner: 'acme', repository: 'widgets', number: 42 },
  selection: { kind: 'all' },
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

  it('parses all, single-commit, and inclusive range selections', () => {
    expect(
      parseChangeSelection(
        new URL('https://github.com/acme/widgets/pull/42/changes'),
      ),
    ).toEqual({ kind: 'all' });
    expect(
      parseChangeSelection(
        new URL(
          'https://github.com/acme/widgets/pull/42/changes/abcdef1',
        ),
      ),
    ).toEqual({ kind: 'commit', oid: 'abcdef1' });
    expect(
      parseChangeSelection(
        new URL(
          'https://github.com/acme/widgets/pull/42/changes/abcdef1..1234567',
        ),
      ),
    ).toEqual({
      kind: 'range',
      startOid: 'abcdef1',
      endOid: '1234567',
    });
    expect(
      sameChangeSelection(
        { kind: 'commit', oid: 'abcdef1' },
        { kind: 'commit', oid: 'abcdef1' },
      ),
    ).toBe(true);
    expect(
      sameChangeSelection(
        { kind: 'commit', oid: 'abcdef1' },
        { kind: 'commit', oid: '1234567' },
      ),
    ).toBe(false);
  });

  it('aggregates line counts from unviewed descendants only', () => {
    expect(aggregateFolder('src', snapshot.files)).toEqual({
      additions: 5,
      deletions: 2,
      viewed: 1,
      total: 2,
    });
  });

  it('aggregates viewed changed-line totals across the pull request', () => {
    expect(aggregateLineViewProgress(snapshot.files)).toEqual({
      viewed: 3,
      total: 12,
    });
  });

  it('formats combined line progress like the native viewed meter', () => {
    expect(formatLineViewProgressLabel({ viewed: 3, total: 12 })).toBe(
      '3 / 12 changes',
    );
    expect(formatLineViewProgressLabel({ viewed: 0, total: 0 })).toBe(
      '0 / 0 changes',
    );
    expect(formatLineViewProgressLabel(null)).toBe('… / … changes');
  });

  it('maps line progress to a ring fill ratio', () => {
    expect(lineViewProgressRatio({ viewed: 3, total: 12 })).toBe(0.25);
    expect(lineViewProgressRatio({ viewed: 0, total: 0 })).toBe(1);
    expect(lineViewProgressRatio(null)).toBeNull();
  });

  it('updates one file without mutating the snapshot', () => {
    const updated = updateFileViewedState(snapshot, 'src/index.ts', true);
    expect(updated.files[0]?.viewedState).toBe('VIEWED');
    expect(snapshot.files[0]?.viewedState).toBe('UNVIEWED');
  });
});

describe('viewed overrides', () => {
  it('applies sidebar choices over a fetched snapshot', () => {
    const result = applyViewedOverrides(
      snapshot,
      new Map([
        ['src/index.ts', true],
        ['src/components/button.ts', false],
      ]),
    );

    expect(result.files.map((file) => file.viewedState)).toEqual([
      'VIEWED',
      'UNVIEWED',
      'DISMISSED',
    ]);
    expect(applyViewedOverrides(snapshot, new Map())).toBe(snapshot);
  });
});

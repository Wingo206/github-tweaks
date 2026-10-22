import { describe, expect, it } from 'vitest';
import {
  followScrollTop,
  intersects,
  isPullRequestFilesUrl,
  treeRowCandidates,
  unionExtent,
} from './model';

describe('isPullRequestFilesUrl', () => {
  it.each([
    'https://github.com/acme/widgets/pull/42/files',
    'https://github.com/acme/widgets/pull/42/changes',
    'https://github.com/acme/widgets/pull/42/changes/abc1234',
    'https://github.com/acme/widgets/pull/42/changes/abc1234..def5678#diff-1',
  ])('accepts %s', (url) => {
    expect(isPullRequestFilesUrl(new URL(url))).toBe(true);
  });

  it.each([
    'https://github.com/acme/widgets/pull/42',
    'https://github.com/acme/widgets/pull/42/commits',
    'https://github.com/acme/widgets/blob/main/src/index.ts',
    'https://example.com/acme/widgets/pull/42/files',
  ])('rejects %s', (url) => {
    expect(isPullRequestFilesUrl(new URL(url))).toBe(false);
  });
});

describe('intersects', () => {
  const viewport = { top: 60, bottom: 600 };

  it('includes partly visible extents', () => {
    expect(intersects({ top: 0, bottom: 61 }, viewport)).toBe(true);
    expect(intersects({ top: 599, bottom: 900 }, viewport)).toBe(true);
    expect(intersects({ top: 0, bottom: 2000 }, viewport)).toBe(true);
  });

  it('excludes extents that only touch an edge or have no height', () => {
    expect(intersects({ top: 0, bottom: 60 }, viewport)).toBe(false);
    expect(intersects({ top: 600, bottom: 700 }, viewport)).toBe(false);
    expect(intersects({ top: 100, bottom: 100 }, viewport)).toBe(false);
  });
});

describe('unionExtent', () => {
  it('spans every non-empty extent', () => {
    expect(
      unionExtent([
        { top: 64, bottom: 96 },
        { top: 10, bottom: 10 },
        { top: 0, bottom: 32 },
      ]),
    ).toEqual({ top: 0, bottom: 96 });
  });

  it('returns null without extents', () => {
    expect(unionExtent([])).toBeNull();
    expect(unionExtent([{ top: 5, bottom: 5 }])).toBeNull();
  });
});

describe('treeRowCandidates', () => {
  it('lists the file and then each folder, deepest first', () => {
    expect(treeRowCandidates('src/utils/format.ts')).toEqual([
      'src/utils/format.ts',
      'src/utils',
      'src',
    ]);
  });

  it('handles top-level files', () => {
    expect(treeRowCandidates('README.md')).toEqual(['README.md']);
  });
});

describe('followScrollTop', () => {
  const view = { scrollTop: 100, height: 300 };

  it('leaves a fully visible band alone', () => {
    expect(followScrollTop({ top: 100, bottom: 400 }, view, 16)).toBeNull();
  });

  it('scrolls up to a band above the view', () => {
    expect(followScrollTop({ top: 50, bottom: 82 }, view, 16)).toBe(34);
  });

  it('scrolls down to a band below the view', () => {
    expect(followScrollTop({ top: 420, bottom: 452 }, view, 16)).toBe(168);
  });

  it('aligns a band taller than the view to its top', () => {
    expect(followScrollTop({ top: 500, bottom: 1200 }, view, 16)).toBe(484);
  });

  it('never scrolls above the start', () => {
    expect(followScrollTop({ top: 4, bottom: 36 }, view, 16)).toBe(0);
  });
});

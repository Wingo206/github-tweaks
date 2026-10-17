import { describe, expect, it } from 'vitest';
import type { FolderState, OpenRequest } from '../protocol';
import { cloneCandidates, rankTargets, windowCandidates } from './ranking';

const remote = 'github.com/acme/widgets';

function folder(path: string, overrides: Partial<FolderState> = {}): FolderState {
  return { path, remotes: [remote], branch: 'main', upstreamBranch: 'main', ...overrides };
}

function request(overrides: Partial<OpenRequest> = {}): OpenRequest {
  return { repo: 'Acme/Widgets', path: 'src/a.ts', line: 1, column: 1, ref: null, ...overrides };
}

const allExist = (): boolean => true;

describe('rankTargets', () => {
  it('requires a repo match on any remote', () => {
    const windows = [
      { id: 'other', folders: [folder('/other', { remotes: ['github.com/acme/other'] })], focusedAt: 9 },
      {
        id: 'fork',
        folders: [folder('/fork', { remotes: ['github.com/me/widgets', remote] })],
        focusedAt: 1,
      },
    ];
    expect(rankTargets(request(), windowCandidates(windows), allExist)?.item.id).toBe('fork');
    expect(
      rankTargets(request({ repo: 'acme/missing' }), windowCandidates(windows), allExist),
    ).toBeNull();
  });

  it('prefers a branch match on local or upstream branch over recency', () => {
    const windows = [
      { id: 'recent', folders: [folder('/a', { branch: 'main' })], focusedAt: 10 },
      {
        id: 'upstream',
        folders: [folder('/b', { branch: 'local-name', upstreamBranch: 'feature' })],
        focusedAt: 2,
      },
      { id: 'local', folders: [folder('/c', { branch: 'feature', upstreamBranch: null })], focusedAt: 1 },
    ];
    const ranked = rankTargets(
      request({ ref: { kind: 'branch', name: 'feature' } }),
      windowCandidates(windows),
      allExist,
    );
    expect(ranked?.item.id).toBe('upstream');
    expect(ranked?.matchedBranch).toBe(true);
  });

  it('ignores branches for commit refs', () => {
    const windows = [
      { id: 'old', folders: [folder('/a', { branch: 'abc' })], focusedAt: 1 },
      { id: 'new', folders: [folder('/b')], focusedAt: 5 },
    ];
    const ranked = rankTargets(
      request({ ref: { kind: 'commit', sha: 'abc' } }),
      windowCandidates(windows),
      allExist,
    );
    expect(ranked?.item.id).toBe('new');
    expect(ranked?.matchedBranch).toBe(false);
  });

  it('prefers folders where the file exists', () => {
    const windows = [
      { id: 'missing', folders: [folder('/a')], focusedAt: 10 },
      { id: 'present', folders: [folder('/b')], focusedAt: 1 },
    ];
    const ranked = rankTargets(
      request(),
      windowCandidates(windows),
      (path) => path === '/b/src/a.ts',
    );
    expect(ranked?.item.id).toBe('present');
  });

  it('breaks ties by most recent focus and sorts never-focused last', () => {
    const windows = [
      { id: 'never', folders: [folder('/a')], focusedAt: null },
      { id: 'older', folders: [folder('/b')], focusedAt: 3 },
      { id: 'newer', folders: [folder('/c')], focusedAt: 7 },
    ];
    expect(rankTargets(request(), windowCandidates(windows), allExist)?.item.id).toBe('newer');
    expect(
      rankTargets(request(), windowCandidates([windows[0]!, windows[1]!]), allExist)?.item.id,
    ).toBe('older');
  });

  it('returns the matching folder of a multi-root window', () => {
    const windows = [
      {
        id: 'multi',
        folders: [folder('/x', { remotes: ['github.com/acme/other'] }), folder('/y')],
        focusedAt: 1,
      },
    ];
    expect(rankTargets(request(), windowCandidates(windows), allExist)?.folder.path).toBe('/y');
  });

  it('ranks remembered clones by last seen time', () => {
    const clones = [
      { path: '/old', remotes: [remote], lastSeenAt: 1 },
      { path: '/new', remotes: [remote], lastSeenAt: 2 },
      { path: '/unrelated', remotes: ['github.com/acme/other'], lastSeenAt: 3 },
    ];
    expect(rankTargets(request(), cloneCandidates(clones), allExist)?.folder.path).toBe('/new');
    expect(rankTargets(request(), cloneCandidates([]), allExist)).toBeNull();
  });
});

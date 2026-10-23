import { describe, expect, it } from 'vitest';
import type { FolderState } from '../protocol';
import { branchStatus, findFolder } from './checkout';

const CLEAN = { staged: 0, modified: 0, conflicts: 0, rebasing: false };

function folder(path: string, overrides: Partial<FolderState> = {}): FolderState {
  return {
    path,
    remotes: ['github.com/acme/widgets'],
    branch: 'main',
    upstreamBranch: 'main',
    workingTree: CLEAN,
    ...overrides,
  };
}

describe('branchStatus', () => {
  it('lists matching clones by focus recency with checkout state and blockers', () => {
    const windows = [
      { folders: [folder('/old', { branch: 'feat/x', upstreamBranch: 'feat/x' })], focusedAt: 1 },
      { folders: [folder('/other', { remotes: ['github.com/acme/other'] })], focusedAt: 9 },
      { folders: [folder('/dirty', { workingTree: { ...CLEAN, modified: 3 } })], focusedAt: 5 },
      { folders: [folder('/never')], focusedAt: null },
    ];
    expect(branchStatus(windows, { repo: 'Acme/Widgets', branch: 'feat/x' })).toEqual({
      clones: [
        {
          path: '/dirty',
          branch: 'main',
          checkedOut: false,
          blocker: { kind: 'changes', staged: 0, modified: 3, conflicts: 0 },
        },
        { path: '/old', branch: 'feat/x', checkedOut: true, blocker: null },
        { path: '/never', branch: 'main', checkedOut: false, blocker: null },
      ],
    });
  });

  it('matches on the upstream name and lists a folder open in two windows once', () => {
    const local = folder('/w', { branch: 'review-x', upstreamBranch: 'feat/x' });
    const windows = [
      { folders: [local], focusedAt: 2 },
      { folders: [local], focusedAt: 1 },
    ];
    expect(branchStatus(windows, { repo: 'acme/widgets', branch: 'feat/x' }).clones).toEqual([
      { path: '/w', branch: 'review-x', checkedOut: true, blocker: null },
    ]);
  });
});

describe('findFolder', () => {
  it('returns the most recently focused window with the folder', () => {
    const older = { id: 'older', folders: [folder('/w')], focusedAt: 1 };
    const newer = { id: 'newer', folders: [folder('/w')], focusedAt: 2 };
    expect(findFolder([older, newer], '/w')?.window.id).toBe('newer');
    expect(findFolder([older], '/missing')).toBeNull();
  });
});

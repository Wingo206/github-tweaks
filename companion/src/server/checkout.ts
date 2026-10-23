import {
  checkoutBlocker,
  isCheckedOut,
  type BranchStatusRequest,
  type BranchStatusResponse,
  type FolderState,
} from '../protocol';
import { windowCandidates, type FocusableWindow } from './ranking';

/** Open clones of `request.repo`, most recently focused window first. */
export function branchStatus(
  windows: FocusableWindow[],
  request: BranchStatusRequest,
): BranchStatusResponse {
  const remote = `github.com/${request.repo}`.toLowerCase();
  const seen = new Set<string>();
  const clones = windowCandidates(windows)
    .filter(({ folder }) => folder.remotes.includes(remote))
    .sort((left, right) => (right.recency ?? -1) - (left.recency ?? -1))
    .filter(({ folder }) => !seen.has(folder.path) && seen.add(folder.path))
    .map(({ folder }) => ({
      path: folder.path,
      branch: folder.branch,
      checkedOut: isCheckedOut(folder, request.branch),
      blocker: checkoutBlocker(folder),
    }));
  return { clones };
}

/** The most recently focused window that has `path` open. */
export function findFolder<W extends FocusableWindow>(
  windows: W[],
  path: string,
): { window: W; folder: FolderState } | null {
  const match = windowCandidates(windows)
    .filter(({ folder }) => folder.path === path)
    .sort((left, right) => (right.recency ?? -1) - (left.recency ?? -1))[0];
  return match ? { window: match.item, folder: match.folder } : null;
}

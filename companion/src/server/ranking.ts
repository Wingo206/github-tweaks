import { join } from 'node:path';
import type { FolderState, OpenRequest } from '../protocol';
import type { RememberedClone } from './config';

export interface RankCandidate<T> {
  item: T;
  folder: FolderState;
  /** Larger is more recent; null sorts last. */
  recency: number | null;
}

export interface RankedTarget<T> {
  item: T;
  folder: FolderState;
  matchedBranch: boolean;
}

export function rankTargets<T>(
  request: OpenRequest,
  candidates: RankCandidate<T>[],
  fileExists: (path: string) => boolean,
): RankedTarget<T> | null {
  const remote = `github.com/${request.repo}`.toLowerCase();
  const ref = request.ref;
  const scored = candidates
    .filter(({ folder }) => folder.remotes.includes(remote))
    .map((candidate) => ({
      candidate,
      matchedBranch:
        ref?.kind === 'branch' &&
        (candidate.folder.branch === ref.name || candidate.folder.upstreamBranch === ref.name),
      exists: fileExists(join(candidate.folder.path, request.path)),
    }));

  scored.sort(
    (left, right) =>
      Number(right.matchedBranch) - Number(left.matchedBranch) ||
      Number(right.exists) - Number(left.exists) ||
      compareRecency(left.candidate.recency, right.candidate.recency),
  );

  const best = scored[0];
  return best
    ? { item: best.candidate.item, folder: best.candidate.folder, matchedBranch: best.matchedBranch }
    : null;
}

function compareRecency(left: number | null, right: number | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return right - left;
}

export interface FocusableWindow {
  folders: FolderState[];
  focusedAt: number | null;
}

export function windowCandidates<W extends FocusableWindow>(windows: W[]): RankCandidate<W>[] {
  return windows.flatMap((window) =>
    window.folders.map((folder) => ({ item: window, folder, recency: window.focusedAt })),
  );
}

export function cloneCandidates(clones: RememberedClone[]): RankCandidate<RememberedClone>[] {
  return clones.map((clone) => ({
    item: clone,
    folder: { path: clone.path, remotes: clone.remotes, branch: null, upstreamBranch: null, workingTree: null },
    recency: clone.lastSeenAt,
  }));
}

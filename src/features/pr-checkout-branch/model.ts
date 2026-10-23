import { describeCheckoutBlocker, isSafeBranchName } from '../../../companion/src/protocol';
import type { CheckoutTarget, CloneStatus, PullRequestRef } from '../../shared/types';

export function parseRoute(url: URL): PullRequestRef | null {
  if (url.hostname !== 'github.com') {
    return null;
  }
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  return {
    owner: decodeURIComponent(match[1]),
    repository: decodeURIComponent(match[2]),
    number: Number(match[3]),
  };
}

export function sameRoute(left: PullRequestRef, right: PullRequestRef | null | undefined): boolean {
  return (
    !!right &&
    left.owner === right.owner &&
    left.repository === right.repository &&
    left.number === right.number
  );
}

/**
 * Reads the head branch link (`/owner/repo/tree/<branch>`, text `<branch>`).
 * Returns null for branch names the companion will not pass to a shell.
 */
export function parseHeadBranch(
  link: { href: string; text: string },
  pull: PullRequestRef,
): CheckoutTarget | null {
  const branch = link.text.trim();
  let path: string;
  try {
    path = new URL(link.href, 'https://github.com').pathname;
  } catch {
    return null;
  }
  const match = path.match(/^\/([^/]+)\/([^/]+)\/tree\/./);
  if (!match?.[1] || !match[2] || !isSafeBranchName(branch)) {
    return null;
  }
  const headRepo = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`;
  const fork = headRepo.toLowerCase() !== `${pull.owner}/${pull.repository}`.toLowerCase();
  return { ...pull, branch, fork };
}

export function cloneName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

export type EntryState = 'checked-out' | 'available' | 'blocked';

export interface MenuEntry {
  path: string;
  name: string;
  state: EntryState;
  detail: string;
  /** Checked-out and blocked clones focus their window instead. */
  action: 'checkout' | 'focus';
}

const STATE_ORDER: Record<EntryState, number> = { 'checked-out': 0, available: 1, blocked: 2 };

/** Checked-out clones first, then clean ones, then blocked; stable within each. */
export function menuEntries(clones: readonly CloneStatus[]): MenuEntry[] {
  return clones
    .map((clone): MenuEntry => {
      const name = cloneName(clone.path);
      const on = clone.branch ? `on ${clone.branch}` : 'detached HEAD';
      if (clone.checkedOut) {
        return { path: clone.path, name, state: 'checked-out', detail: 'Checked out here', action: 'focus' };
      }
      if (clone.blocker) {
        return {
          path: clone.path,
          name,
          state: 'blocked',
          detail: `${describeCheckoutBlocker(clone.blocker)} · ${on}`,
          action: 'focus',
        };
      }
      return { path: clone.path, name, state: 'available', detail: on, action: 'checkout' };
    })
    .sort((left, right) => STATE_ORDER[left.state] - STATE_ORDER[right.state]);
}

/** Names of clones that already have the branch checked out. */
export function checkedOutNames(clones: readonly CloneStatus[] | null): string[] {
  return (clones ?? []).filter((clone) => clone.checkedOut).map((clone) => cloneName(clone.path));
}

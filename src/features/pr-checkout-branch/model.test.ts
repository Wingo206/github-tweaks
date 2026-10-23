import { describe, expect, it } from 'vitest';
import type { CloneStatus } from '../../shared/types';
import { checkedOutNames, menuEntries, parseHeadBranch, parseRoute } from './model';

const pull = { owner: 'acme', repository: 'widgets', number: 42 };

describe('parseRoute', () => {
  it('matches every pull request tab', () => {
    expect(parseRoute(new URL('https://github.com/acme/widgets/pull/42'))).toEqual(pull);
    expect(parseRoute(new URL('https://github.com/acme/widgets/pull/42/changes'))).toEqual(pull);
    expect(parseRoute(new URL('https://github.com/acme/widgets/pulls'))).toBeNull();
    expect(parseRoute(new URL('https://gist.github.com/acme/widgets/pull/42'))).toBeNull();
  });
});

describe('parseHeadBranch', () => {
  it('reads a same-repository head branch', () => {
    expect(parseHeadBranch({ href: '/acme/widgets/tree/feature/x', text: ' feature/x ' }, pull)).toEqual({
      ...pull,
      branch: 'feature/x',
      fork: false,
    });
  });

  it('flags fork branches by the head repository in the link', () => {
    expect(parseHeadBranch({ href: '/someone/widgets/tree/feature/x', text: 'feature/x' }, pull)).toMatchObject({
      fork: true,
    });
    expect(parseHeadBranch({ href: '/ACME/Widgets/tree/x', text: 'x' }, pull)?.fork).toBe(false);
  });

  it('skips branches the companion would not pass to a shell', () => {
    expect(parseHeadBranch({ href: '/acme/widgets/tree/x', text: "it's" }, pull)).toBeNull();
    expect(parseHeadBranch({ href: '/acme/widgets', text: 'x' }, pull)).toBeNull();
  });
});

describe('menuEntries', () => {
  const clones: CloneStatus[] = [
    { path: '/home/me/dirty', branch: 'main', checkedOut: false, blocker: { kind: 'changes', staged: 0, modified: 2, conflicts: 0 } },
    { path: '/home/me/clean', branch: null, checkedOut: false, blocker: null },
    { path: '/home/me/here', branch: 'feature/x', checkedOut: true, blocker: null },
  ];

  it('orders checked-out, then available, then blocked clones and explains each', () => {
    expect(menuEntries(clones)).toEqual([
      { path: '/home/me/here', name: 'here', state: 'checked-out', detail: 'Checked out here', action: 'focus' },
      { path: '/home/me/clean', name: 'clean', state: 'available', detail: 'detached HEAD', action: 'checkout' },
      {
        path: '/home/me/dirty',
        name: 'dirty',
        state: 'blocked',
        detail: 'Uncommitted changes: 2 modified · on main',
        action: 'focus',
      },
    ]);
    expect(checkedOutNames(clones)).toEqual(['here']);
    expect(checkedOutNames(null)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { NO_GROUP, planJoin, planOrganize, pullRequestKey, type TabInfo } from './model';

const PR = 'https://github.com/acme/widgets/pull/42';

function tab(id: number, url: string | undefined, groupId = NO_GROUP, extra: Partial<TabInfo> = {}): TabInfo {
  return { id, windowId: 1, index: id, groupId, pinned: false, url, ...extra };
}

describe('pullRequestKey', () => {
  it.each([
    PR,
    `${PR}/`,
    `${PR}/files`,
    `${PR}/changes`,
    `${PR}/commits/abc123`,
    `${PR}/checks?check_run_id=1`,
    `${PR}#issuecomment-1`,
    'https://github.com/Acme/Widgets/pull/42',
  ])('keys %s to the pull request', (url) => {
    expect(pullRequestKey(url)).toBe('acme/widgets#42');
  });

  it.each([
    'https://github.com/acme/widgets/pulls',
    'https://github.com/acme/widgets/pull/new/main',
    'https://github.com/acme/widgets/issues/42',
    'https://gist.github.com/acme/widgets/pull/42',
    'chrome://newtab/',
    'not a url',
    undefined,
  ])('ignores %s', (url) => {
    expect(pullRequestKey(url)).toBeNull();
  });
});

describe('planJoin', () => {
  it('joins the group holding another page of the same pull request', () => {
    const tabs = [tab(0, PR, 7), tab(1, `${PR}/checks`, 7), tab(2, 'https://github.com'), tab(3, `${PR}/files`)];
    expect(planJoin(tabs[3]!, tabs)).toEqual({ tabId: 3, groupId: 7, afterTabId: 1 });
  });

  it('does nothing without a group for that pull request', () => {
    const tabs = [tab(0, PR), tab(1, 'https://github.com/acme/widgets/pull/43', 7), tab(2, `${PR}/files`)];
    expect(planJoin(tabs[2]!, tabs)).toBeNull();
  });

  it('does nothing when the pull request spans several groups', () => {
    const tabs = [tab(0, PR, 7), tab(1, `${PR}/checks`, 8), tab(2, `${PR}/files`)];
    expect(planJoin(tabs[2]!, tabs)).toBeNull();
  });

  it('leaves grouped, pinned, and non-PR tabs alone', () => {
    const group = tab(0, PR, 7);
    expect(planJoin(tab(1, `${PR}/files`, 8), [group])).toBeNull();
    expect(planJoin(tab(1, `${PR}/files`, NO_GROUP, { pinned: true }), [group])).toBeNull();
    expect(planJoin(tab(1, 'https://github.com/acme/widgets'), [group])).toBeNull();
  });

  it('ignores groups in other windows', () => {
    const tabs = [tab(0, PR, 7, { windowId: 2 }), tab(1, `${PR}/files`)];
    expect(planJoin(tabs[1]!, tabs)).toBeNull();
  });
});

describe('planOrganize', () => {
  it('chains several tabs of one pull request in tab-strip order', () => {
    const other = 'https://github.com/acme/widgets/pull/43';
    const tabs = [
      tab(0, PR, 7),
      tab(1, other, 8),
      tab(2, `${PR}/files`),
      tab(3, 'https://github.com/acme/widgets/pull/44'),
      tab(4, `${other}/files`),
      tab(5, `${PR}/checks`),
    ];
    expect(planOrganize(tabs)).toEqual([
      { tabId: 2, groupId: 7, afterTabId: 0 },
      { tabId: 4, groupId: 8, afterTabId: 1 },
      { tabId: 5, groupId: 7, afterTabId: 2 },
    ]);
  });
});

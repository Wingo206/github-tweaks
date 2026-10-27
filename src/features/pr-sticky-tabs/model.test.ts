import { describe, expect, it } from 'vitest';
import { accessibleName, isPlainClick, isPullRequestPage, tabsKey, type StickyTab } from './model';

const tab: StickyTab = {
  href: '/acme/widgets/pull/42',
  label: 'Conversation',
  count: '8',
  current: true,
  icon: 'octicon-comment-discussion',
};

const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

describe('isPullRequestPage', () => {
  it.each([
    'https://github.com/acme/widgets/pull/42',
    'https://github.com/acme/widgets/pull/42/changes',
    'https://github.com/acme/widgets/pull/42/files',
    'https://github.com/acme/widgets/pull/42/commits/abc123',
    'https://github.com/acme/widgets/pull/42/checks?check_run_id=1',
  ])('accepts %s', (url) => {
    expect(isPullRequestPage(new URL(url))).toBe(true);
  });

  it.each([
    'https://github.com/acme/widgets/pulls',
    'https://github.com/acme/widgets/pull/new/main',
    'https://github.com/acme/widgets/issues/42',
    'https://gist.github.com/acme/widgets/pull/42',
  ])('rejects %s', (url) => {
    expect(isPullRequestPage(new URL(url))).toBe(false);
  });
});

describe('tabsKey', () => {
  it('changes when a count or the current tab changes', () => {
    const key = tabsKey([tab]);
    expect(tabsKey([{ ...tab }])).toBe(key);
    expect(tabsKey([{ ...tab, count: '9' }])).not.toBe(key);
    expect(tabsKey([{ ...tab, current: false }])).not.toBe(key);
  });
});

describe('accessibleName', () => {
  it('includes the count when there is one', () => {
    expect(accessibleName(tab)).toBe('Conversation (8)');
    expect(accessibleName({ label: 'Checks', count: null })).toBe('Checks');
  });
});

describe('isPlainClick', () => {
  it('accepts only unmodified primary clicks', () => {
    expect(isPlainClick(plain)).toBe(true);
    expect(isPlainClick({ ...plain, button: 1 })).toBe(false);
    expect(isPlainClick({ ...plain, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, altKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, defaultPrevented: true })).toBe(false);
  });
});

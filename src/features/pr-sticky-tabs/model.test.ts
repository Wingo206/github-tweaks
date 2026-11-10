import { describe, expect, it } from 'vitest';
import {
  accessibleName,
  isPlainClick,
  isPullRequestPage,
  lineCountsLabel,
  parseLineCounts,
  tabsKey,
  type StickyTab,
} from './model';

const tab: StickyTab = {
  href: '/acme/widgets/pull/42',
  label: 'Overview',
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

  it('changes when the line counts change or appear', () => {
    const lines = { additions: 5, deletions: 2 };
    const key = tabsKey([tab], lines);
    expect(tabsKey([tab], { ...lines })).toBe(key);
    expect(tabsKey([tab], { ...lines, deletions: 3 })).not.toBe(key);
    expect(tabsKey([tab], null)).not.toBe(key);
  });
});

describe('parseLineCounts', () => {
  it('reads GitHub’s “Lines changed” text, singular or plural', () => {
    expect(parseLineCounts('Lines changed: 1479 additions & 340 deletions')).toEqual({ additions: 1479, deletions: 340 });
    expect(parseLineCounts(' Lines changed: 1 addition & 1 deletion ')).toEqual({ additions: 1, deletions: 1 });
    expect(parseLineCounts('Lines changed: 2,084 additions & 0 deletions')).toEqual({ additions: 2084, deletions: 0 });
  });

  it('rejects other screen-reader text', () => {
    expect(parseLineCounts('0 of 4,762 changes viewed')).toBeNull();
    expect(parseLineCounts('16 changes: 8 additions & 8 deletions')).toBeNull();
  });
});

describe('lineCountsLabel', () => {
  it('formats both totals with the right plural', () => {
    expect(lineCountsLabel({ additions: 1479, deletions: 1 })).toBe('1,479 additions and 1 deletion');
    expect(lineCountsLabel({ additions: 1, deletions: 0 })).toBe('1 addition and 0 deletions');
  });
});

describe('accessibleName', () => {
  it('includes the count when there is one', () => {
    expect(accessibleName(tab)).toBe('Overview (8)');
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

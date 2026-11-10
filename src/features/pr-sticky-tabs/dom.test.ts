import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearStickyTabs,
  createNav,
  findNativeLineCounts,
  findNativeTabs,
  findStickyMounts,
  MARKER,
  showsLineCounts,
  syncTabs,
} from './dom';

function fixture(path: string): string {
  return readFileSync(resolve(process.cwd(), `tests/fixtures/${path}.html`), 'utf8');
}

function showOverview(): void {
  document.body.innerHTML = fixture('pr-sticky-tabs/overview');
}

function selectTab(href: string): void {
  document.querySelector('nav[aria-label="Pull request"] a[aria-current]')!.removeAttribute('aria-current');
  document.querySelector(`nav[aria-label="Pull request"] a[href="${href}"]`)!.setAttribute('aria-current', 'page');
}

function navs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[${MARKER}="nav"]`)];
}

function tabSummary(nav: HTMLElement): string[] {
  return [...nav.querySelectorAll('a')].map(
    (link) => `${link.getAttribute('aria-label')}${link.getAttribute('aria-current') ? ' *' : ''}`,
  );
}

function bar(): Element {
  return document.querySelector('[data-testid="diff-comparison-viewer-sticky-header-bar"]')!;
}

describe('findNativeTabs', () => {
  it('reads GitHub’s tab bar in order', () => {
    showOverview();
    expect(findNativeTabs(document).map(({ link: _link, svg: _svg, ...tab }) => tab)).toEqual([
      { href: '/acme/widgets/pull/42', label: 'Overview', count: null, current: true, icon: 'octicon-tasklist' },
      { href: '/acme/widgets/pull/42/commits', label: 'Commits', count: '2', current: false, icon: 'octicon-git-commit' },
      { href: '/acme/widgets/pull/42/checks', label: 'Checks', count: '5', current: false, icon: 'octicon-checklist' },
      { href: '/acme/widgets/pull/42/changes', label: 'Files changed', count: '26', current: false, icon: 'octicon-file-diff' },
    ]);
  });

  it('returns nothing without GitHub’s tab bar', () => {
    document.body.innerHTML = '<nav><a href="/acme/widgets/pull/42">Overview</a></nav>';
    expect(findNativeTabs(document)).toEqual([]);
  });
});

describe('findNativeLineCounts', () => {
  it('reads the totals from the main header', () => {
    showOverview();
    expect(findNativeLineCounts(document)).toEqual({ additions: 1479, deletions: 1 });
  });

  it('ignores the per-file counts in diff headers', () => {
    showOverview();
    [...document.querySelectorAll('[data-component="PageHeader"] .sr-only')]
      .find((label) => label.textContent?.startsWith('Lines changed'))!
      .remove();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div data-diff-header-wrapper="true"><span class="sr-only">Lines changed: 3 additions &amp; 2 deletions</span></div>',
    );
    expect(findNativeLineCounts(document)).toBeNull();
  });
});

describe('showsLineCounts', () => {
  it('leaves Files changed to its own toolbar meter', () => {
    showOverview();
    expect(showsLineCounts(findNativeTabs(document))).toBe(true);
    selectTab('/acme/widgets/pull/42/changes');
    expect(showsLineCounts(findNativeTabs(document))).toBe(false);
  });
});

describe('findStickyMounts', () => {
  it('picks the sticky bar’s title block, not the main header', () => {
    showOverview();
    const mounts = findStickyMounts(document);
    expect(mounts).toHaveLength(1);
    expect(bar().contains(mounts[0]!)).toBe(true);
    expect(mounts[0]!.querySelector('a[href="#top"]')).not.toBeNull();
  });
});

describe('syncTabs', () => {
  it('places one tab bar right after the sticky bar’s title block, idempotently', () => {
    showOverview();
    syncTabs(document, findNativeTabs(document), null, createNav);
    const first = navs()[0];
    syncTabs(document, findNativeTabs(document), null, createNav);

    expect(navs()).toHaveLength(1);
    expect(navs()[0]).toBe(first);
    expect(bar().contains(navs()[0]!)).toBe(true);
    expect(navs()[0]!.previousElementSibling!.querySelector('a[href="#top"]')).not.toBeNull();
  });

  it('shows each tab with its icon, name, count and current state', () => {
    showOverview();
    selectTab('/acme/widgets/pull/42/changes');
    syncTabs(document, findNativeTabs(document), null, createNav);
    const nav = navs()[0]!;
    expect(tabSummary(nav)).toEqual(['Overview', 'Commits (2)', 'Checks (5)', 'Files changed (26) *']);
    const files = nav.querySelector<HTMLAnchorElement>('a[aria-current="page"]')!;
    expect(files.getAttribute('href')).toBe('/acme/widgets/pull/42/changes');
    expect(files.querySelector('svg')?.getAttribute('class')).toBe('octicon octicon-file-diff ght-pst-icon');
    expect(files.querySelector('.ght-pst-label')?.textContent).toBe('Files changed');
    expect(files.querySelector('.ght-pst-count')?.textContent).toBe('26');
    expect(files.id).toBe('');
  });

  it('replaces the bar when a count or the current tab changes', () => {
    showOverview();
    syncTabs(document, findNativeTabs(document), null, createNav);
    const first = navs()[0];

    document.querySelector('#prs-commits-anchor-tab [data-component="CounterLabel"]')!.textContent = '3';
    syncTabs(document, findNativeTabs(document), null, createNav);
    expect(navs()).toHaveLength(1);
    expect(navs()[0]).not.toBe(first);
    expect(tabSummary(navs()[0]!)[1]).toBe('Commits (3)');
  });

  it('shows the line totals after the tabs, and replaces the bar when they change', () => {
    showOverview();
    const tabs = findNativeTabs(document);
    syncTabs(document, tabs, { additions: 1479, deletions: 1 }, createNav);
    const first = navs()[0]!;
    const lines = first.lastElementChild!;
    expect(lines.className).toBe('ght-pst-lines');
    expect([...lines.querySelectorAll('[aria-hidden="true"]')].map((span) => span.textContent)).toEqual([
      '+1,479',
      '-1',
    ]);
    expect(lines.querySelector('.sr-only')?.textContent).toBe('Lines changed: 1,479 additions and 1 deletion');

    syncTabs(document, tabs, { additions: 1479, deletions: 1 }, createNav);
    expect(navs()[0]).toBe(first);
    syncTabs(document, tabs, { additions: 1480, deletions: 1 }, createNav);
    expect(navs()[0]).not.toBe(first);
    syncTabs(document, tabs, null, createNav);
    expect(navs()[0]!.querySelector('.ght-pst-lines')).toBeNull();
  });

  it('removes the bar when GitHub’s tab bar goes away, and on cleanup', () => {
    showOverview();
    syncTabs(document, findNativeTabs(document), null, createNav);
    expect(navs()).toHaveLength(1);

    syncTabs(document, [], null, createNav);
    expect(navs()).toHaveLength(0);

    syncTabs(document, findNativeTabs(document), null, createNav);
    clearStickyTabs();
    expect(document.querySelectorAll(`[${MARKER}]`)).toHaveLength(0);
  });
});

// TODO(classic-1): the classic layout's tab bar and sticky headers.
describe('classic layout', () => {
  function showClassic(name: 'conversation' | 'files-changed'): void {
    document.body.innerHTML = fixture(`classic/pr-sticky-tabs/${name}`);
  }

  it('reads the classic tab bar and its line totals', () => {
    showClassic('conversation');
    expect(findNativeTabs(document).map(({ label, count, current }) => [label, count, current])).toEqual([
      ['Conversation', '8', true],
      ['Commits', '2', false],
      ['Checks', null, false],
      ['Files changed', '26', false],
    ]);
    expect(findNativeLineCounts(document)).toEqual({ additions: 1479, deletions: 1 });
  });

  it('picks the sticky header’s branch group, not the main header’s', () => {
    showClassic('conversation');
    const mounts = findStickyMounts(document);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]!.closest('h2')).not.toBeNull();
    expect(mounts[0]!.querySelectorAll('a[data-component="BranchName"]')).toHaveLength(2);
  });

  it('picks the stuck files toolbar on Files changed', () => {
    showClassic('files-changed');
    const mounts = findStickyMounts(document);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]!.closest('section')).not.toBeNull();
  });

  it.each(['conversation', 'files-changed'] as const)(
    'places one tab bar right after the copy and checkout buttons on %s, idempotently',
    (name) => {
      showClassic(name);
      syncTabs(document, findNativeTabs(document), null, createNav);
      const first = navs()[0];
      syncTabs(document, findNativeTabs(document), null, createNav);

      expect(navs()).toHaveLength(1);
      expect(navs()[0]).toBe(first);
      const group = navs()[0]!.previousElementSibling!;
      expect(group.lastElementChild!.lastElementChild!.getAttribute('data-ght-checkout-branch')).toBe('button');
    },
  );
});

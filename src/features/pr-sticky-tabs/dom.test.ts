import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearStickyTabs, createNav, findNativeTabs, findStickyMounts, MARKER, syncTabs } from './dom';

function fixture(name: 'conversation' | 'files-changed'): string {
  return readFileSync(resolve(process.cwd(), `tests/fixtures/pr-sticky-tabs/${name}.html`), 'utf8');
}

function navs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[${MARKER}="nav"]`)];
}

function tabSummary(nav: HTMLElement): string[] {
  return [...nav.querySelectorAll('a')].map(
    (link) => `${link.getAttribute('aria-label')}${link.getAttribute('aria-current') ? ' *' : ''}`,
  );
}

describe('findNativeTabs', () => {
  it('reads GitHub’s tab bar in order', () => {
    document.body.innerHTML = fixture('conversation');
    expect(findNativeTabs(document).map(({ link: _link, svg: _svg, ...tab }) => tab)).toEqual([
      { href: '/acme/widgets/pull/42', label: 'Conversation', count: '8', current: true, icon: 'octicon-comment-discussion' },
      { href: '/acme/widgets/pull/42/commits', label: 'Commits', count: '2', current: false, icon: 'octicon-git-commit' },
      { href: '/acme/widgets/pull/42/checks', label: 'Checks', count: null, current: false, icon: 'octicon-checklist' },
      { href: '/acme/widgets/pull/42/changes', label: 'Files changed', count: '26', current: false, icon: 'octicon-file-diff' },
    ]);
  });

  it('returns nothing without GitHub’s tab bar', () => {
    document.body.innerHTML = '<nav><a href="/acme/widgets/pull/42">Conversation</a></nav>';
    expect(findNativeTabs(document)).toEqual([]);
  });
});

describe('findStickyMounts', () => {
  it('picks the sticky header’s branch group, not the main header’s', () => {
    document.body.innerHTML = fixture('conversation');
    const mounts = findStickyMounts(document);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]!.closest('h2')).not.toBeNull();
    expect(mounts[0]!.querySelectorAll('a[data-component="BranchName"]')).toHaveLength(2);
  });

  it('picks the stuck files toolbar on Files changed', () => {
    document.body.innerHTML = fixture('files-changed');
    const mounts = findStickyMounts(document);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]!.closest('section')).not.toBeNull();
  });
});

describe('syncTabs', () => {
  it.each(['conversation', 'files-changed'] as const)(
    'places one tab bar right after the copy and checkout buttons on %s, idempotently',
    (name) => {
      document.body.innerHTML = fixture(name);
      const tabs = findNativeTabs(document);
      syncTabs(document, tabs, createNav);
      const first = navs()[0];
      syncTabs(document, findNativeTabs(document), createNav);

      expect(navs()).toHaveLength(1);
      expect(navs()[0]).toBe(first);
      const group = navs()[0]!.previousElementSibling!;
      expect(group.lastElementChild!.lastElementChild!.getAttribute('data-ght-checkout-branch')).toBe('button');
    },
  );

  it('shows each tab with its icon, name, count and current state', () => {
    document.body.innerHTML = fixture('files-changed');
    syncTabs(document, findNativeTabs(document), createNav);
    const nav = navs()[0]!;
    expect(tabSummary(nav)).toEqual(['Conversation (35)', 'Commits (10)', 'Checks (5)', 'Files changed (81) *']);
    const files = nav.querySelector<HTMLAnchorElement>('a[aria-current="page"]')!;
    expect(files.getAttribute('href')).toBe('/acme/widgets/pull/42/changes');
    expect(files.querySelector('svg')?.getAttribute('class')).toBe('octicon octicon-file-diff ght-pst-icon');
    expect(files.querySelector('.ght-pst-label')?.textContent).toBe('Files changed');
    expect(files.querySelector('.ght-pst-count')?.textContent).toBe('81');
    expect(files.hasAttribute('data-hotkey')).toBe(false);
    expect(files.id).toBe('');
  });

  it('replaces the bar when a count or the current tab changes', () => {
    document.body.innerHTML = fixture('conversation');
    syncTabs(document, findNativeTabs(document), createNav);
    const first = navs()[0];

    document.querySelector('#prs-commits-anchor-tab [data-component="CounterLabel"]')!.textContent = '3';
    syncTabs(document, findNativeTabs(document), createNav);
    expect(navs()).toHaveLength(1);
    expect(navs()[0]).not.toBe(first);
    expect(tabSummary(navs()[0]!)[1]).toBe('Commits (3)');
  });

  it('removes the bar when GitHub’s tab bar goes away, and on cleanup', () => {
    document.body.innerHTML = fixture('conversation');
    syncTabs(document, findNativeTabs(document), createNav);
    expect(navs()).toHaveLength(1);

    syncTabs(document, [], createNav);
    expect(navs()).toHaveLength(0);

    syncTabs(document, findNativeTabs(document), createNav);
    clearStickyTabs();
    expect(document.querySelectorAll(`[${MARKER}]`)).toHaveLength(0);
  });
});

import { findHeadBranchMounts, findStickyBarTitleBlocks } from '../../shared/prHeader';
import {
  accessibleName,
  formatLineCount,
  lineCountsLabel,
  parseLineCounts,
  tabsKey,
  type LineCounts,
  type StickyTab,
} from './model';

export const MARKER = 'data-ght-sticky-tabs';
const KEY = 'data-ght-pst-key';

/** GitHub gives these two tab links fixed IDs; their `nav` holds every tab. */
const NATIVE_TAB_ANCHORS = '#prs-files-anchor-tab, #prs-commits-anchor-tab';
const FILES_TAB_ID = 'prs-files-anchor-tab';

export interface NativeTab extends StickyTab {
  link: HTMLAnchorElement;
  svg: SVGElement | null;
}

/** GitHub's own tab links, in order, or none when its tab bar is not on the page. */
export function findNativeTabs(root: ParentNode): NativeTab[] {
  const nav = root.querySelector(NATIVE_TAB_ANCHORS)?.closest('nav');
  if (!nav) {
    return [];
  }
  return [...nav.querySelectorAll<HTMLAnchorElement>('a[href]')].map(readTab);
}

/**
 * The pull request's line totals from the main header. Diff file headers
 * reuse the same "Lines changed" text, so the search stays inside the header.
 */
export function findNativeLineCounts(root: ParentNode): LineCounts | null {
  const header = root.querySelector(NATIVE_TAB_ANCHORS)?.closest('[data-component="PageHeader"]');
  for (const label of header?.querySelectorAll('.sr-only') ?? []) {
    const counts = parseLineCounts(label.textContent ?? '');
    if (counts) {
      return counts;
    }
  }
  return null;
}

/** Files changed has its own changes meter in the sticky toolbar. */
export function showsLineCounts(tabs: readonly NativeTab[]): boolean {
  return !tabs.some((tab) => tab.current && tab.link.id === FILES_TAB_ID);
}

function readTab(link: HTMLAnchorElement): NativeTab {
  const svg = link.querySelector('svg');
  return {
    link,
    svg,
    href: link.getAttribute('href') ?? '',
    label: tabLabel(link),
    count: link.querySelector('[data-component="CounterLabel"]')?.textContent?.trim() || null,
    current: link.getAttribute('aria-current') === 'page',
    icon: svg ? ([...svg.classList].find((name) => name.startsWith('octicon-')) ?? null) : null,
  };
}

function tabLabel(link: HTMLAnchorElement): string {
  const text = link.querySelector('[data-component="text"]');
  if (text) {
    return text.textContent?.trim() ?? '';
  }
  // TODO(classic-1): classic tab links hold their label as a bare text node.
  return [...link.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
}

/**
 * Where the tabs go in each sticky header: after the title block of GitHub's
 * sticky bar, or after the branch group of a classic sticky header.
 */
export function findStickyMounts(root: ParentNode): Element[] {
  return [...findStickyBarTitleBlocks(root), ...findClassicStickyMounts(root)];
}

/**
 * TODO(classic-1): the classic sticky header (and the stuck Files changed
 * toolbar) repeats the branch summary; it has a `#top` title link and no tab
 * bar, while the main header is the other way round.
 */
function findClassicStickyMounts(root: ParentNode): Element[] {
  return findHeadBranchMounts(root).flatMap(({ link }) => {
    const header = link.closest('[data-component="PageHeader"], section');
    if (!header?.querySelector('a[href="#top"]') || header.querySelector(NATIVE_TAB_ANCHORS)) {
      return [];
    }
    const group = classicBranchGroup(link, header);
    return group ? [group] : [];
  });
}

/** TODO(classic-1) */
function classicBranchGroup(link: Element, header: Element): Element | null {
  for (let element = link.parentElement; element && element !== header; element = element.parentElement) {
    if (element.querySelectorAll('a[data-component="BranchName"]').length >= 2) {
      return element;
    }
  }
  return link.parentElement;
}

/**
 * Places one tab bar after each sticky mount, replacing it only when the tabs
 * changed, and removes bars whose mount is gone. Returns the bars in `root`.
 */
export function syncTabs(
  root: ParentNode,
  tabs: readonly NativeTab[],
  lines: LineCounts | null,
  create: (tabs: readonly NativeTab[], lines: LineCounts | null) => HTMLElement,
): HTMLElement[] {
  const key = tabsKey(tabs, lines);
  const kept = new Set<Element>();
  if (tabs.length) {
    for (const mount of findStickyMounts(root)) {
      const existing = mount.nextElementSibling?.matches(`[${MARKER}="nav"]`) ? mount.nextElementSibling : null;
      if (existing?.getAttribute(KEY) === key) {
        kept.add(existing);
        continue;
      }
      const nav = create(tabs, lines);
      if (existing) {
        existing.replaceWith(nav);
      } else {
        mount.after(nav);
      }
      kept.add(nav);
    }
  }
  for (const nav of root.querySelectorAll(`[${MARKER}="nav"]`)) {
    if (!kept.has(nav)) {
      nav.remove();
    }
  }
  return [...root.querySelectorAll<HTMLElement>(`[${MARKER}="nav"]`)];
}

export function createNav(tabs: readonly NativeTab[], lines: LineCounts | null = null): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'ght-pst-nav';
  nav.setAttribute(MARKER, 'nav');
  nav.setAttribute(KEY, tabsKey(tabs, lines));
  nav.setAttribute('aria-label', 'Pull request tabs');
  nav.append(...tabs.map(createTab));
  if (lines) {
    nav.append(createLineCounts(lines));
  }
  return nav;
}

function createLineCounts(lines: LineCounts): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'ght-pst-lines';
  wrapper.title = lineCountsLabel(lines);
  wrapper.append(
    textSpan('ght-pst-additions', `+${formatLineCount(lines.additions)}`, true),
    textSpan('ght-pst-deletions', `-${formatLineCount(lines.deletions)}`, true),
    textSpan('sr-only', `Lines changed: ${lineCountsLabel(lines)}`, false),
  );
  return wrapper;
}

function textSpan(className: string, text: string, hidden: boolean): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  if (hidden) {
    span.setAttribute('aria-hidden', 'true');
  }
  return span;
}

function createTab(tab: NativeTab): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'ght-pst-tab';
  link.setAttribute('href', tab.href);
  link.setAttribute('aria-label', accessibleName(tab));
  link.title = tab.label;
  if (tab.current) {
    link.setAttribute('aria-current', 'page');
  }
  if (tab.svg) {
    const icon = tab.svg.cloneNode(true) as SVGElement;
    icon.setAttribute('class', `octicon ${tab.icon ?? ''} ght-pst-icon`.trim());
    icon.setAttribute('aria-hidden', 'true');
    icon.removeAttribute('style');
    link.append(icon);
  }
  const label = document.createElement('span');
  label.className = 'ght-pst-label';
  label.textContent = tab.label;
  link.append(label);
  if (tab.count) {
    const count = document.createElement('span');
    count.className = 'ght-pst-count';
    count.textContent = tab.count;
    link.append(count);
  }
  return link;
}

export function clearStickyTabs(root: ParentNode = document): void {
  root.querySelectorAll(`[${MARKER}]`).forEach((element) => element.remove());
}

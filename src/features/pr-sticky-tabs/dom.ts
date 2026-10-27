import { findHeadBranchMounts } from '../../shared/prHeader';
import { accessibleName, tabsKey, type StickyTab } from './model';

export const MARKER = 'data-ght-sticky-tabs';
const KEY = 'data-ght-pst-key';

/** GitHub gives these two tab links fixed IDs; their parent holds every tab. */
const NATIVE_TAB_ANCHORS = '#prs-files-anchor-tab, #prs-commits-anchor-tab';

export interface NativeTab extends StickyTab {
  link: HTMLAnchorElement;
  svg: SVGElement | null;
}

/** GitHub's own tab links, in order, or none when its tab bar is not on the page. */
export function findNativeTabs(root: ParentNode): NativeTab[] {
  const list = root.querySelector(NATIVE_TAB_ANCHORS)?.parentElement;
  if (!list) {
    return [];
  }
  return [...list.querySelectorAll<HTMLAnchorElement>(':scope > a[href]')].map(readTab);
}

function readTab(link: HTMLAnchorElement): NativeTab {
  const label = [...link.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
  const svg = link.querySelector('svg');
  return {
    link,
    svg,
    href: link.getAttribute('href') ?? '',
    label,
    count: link.querySelector('[data-component="CounterLabel"]')?.textContent?.trim() || null,
    current: link.getAttribute('aria-current') === 'page',
    icon: svg ? ([...svg.classList].find((name) => name.startsWith('octicon-')) ?? null) : null,
  };
}

/**
 * The branch group in each sticky header's summary row; tabs go right after
 * it, so after the copy and checkout buttons inside it. A sticky header has a
 * `#top` title link and no tab bar; the main header is the other way round.
 */
export function findStickyMounts(root: ParentNode): Element[] {
  return findHeadBranchMounts(root).flatMap(({ link }) => {
    const header = link.closest('[data-component="PageHeader"], section');
    if (!header?.querySelector('a[href="#top"]') || header.querySelector(NATIVE_TAB_ANCHORS)) {
      return [];
    }
    const group = branchGroup(link, header);
    return group ? [group] : [];
  });
}

function branchGroup(link: Element, header: Element): Element | null {
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
  create: (tabs: readonly NativeTab[]) => HTMLElement,
): HTMLElement[] {
  const key = tabsKey(tabs);
  const kept = new Set<Element>();
  if (tabs.length) {
    for (const mount of findStickyMounts(root)) {
      const existing = mount.nextElementSibling?.matches(`[${MARKER}="nav"]`) ? mount.nextElementSibling : null;
      if (existing?.getAttribute(KEY) === key) {
        kept.add(existing);
        continue;
      }
      const nav = create(tabs);
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

export function createNav(tabs: readonly NativeTab[]): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'ght-pst-nav';
  nav.setAttribute(MARKER, 'nav');
  nav.setAttribute(KEY, tabsKey(tabs));
  nav.setAttribute('aria-label', 'Pull request tabs');
  nav.append(...tabs.map(createTab));
  return nav;
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

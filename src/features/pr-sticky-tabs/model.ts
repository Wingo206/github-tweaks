/** One pull request tab, as GitHub's own tab bar shows it. */
export interface StickyTab {
  href: string;
  label: string;
  count: string | null;
  current: boolean;
  /** Octicon class such as `octicon-git-commit`. */
  icon: string | null;
}

/** `/owner/repo/pull/42` and any of its tabs or sub-routes. */
export function isPullRequestPage(url: URL): boolean {
  return url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(url.pathname);
}

/** Changes whenever anything the rendered tabs show changes. */
export function tabsKey(tabs: readonly StickyTab[]): string {
  return JSON.stringify(tabs.map(({ href, label, count, current, icon }) => [href, label, count, current, icon]));
}

export function accessibleName({ label, count }: Pick<StickyTab, 'label' | 'count'>): string {
  return count ? `${label} (${count})` : label;
}

type ClickLike = Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>;

/** Unmodified primary clicks; anything else keeps the link's own new-tab/window behavior. */
export function isPlainClick(event: ClickLike): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

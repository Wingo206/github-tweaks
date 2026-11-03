/** One pull request tab, as GitHub's own tab bar shows it. */
export interface StickyTab {
  href: string;
  label: string;
  count: string | null;
  current: boolean;
  /** Octicon class such as `octicon-git-commit`. */
  icon: string | null;
}

/** Whole pull request line totals, as GitHub's header states them. */
export interface LineCounts {
  additions: number;
  deletions: number;
}

/** `/owner/repo/pull/42` and any of its tabs or sub-routes. */
export function isPullRequestPage(url: URL): boolean {
  return url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(url.pathname);
}

/** Changes whenever anything the rendered tabs or line counts show changes. */
export function tabsKey(tabs: readonly StickyTab[], lines: LineCounts | null = null): string {
  return JSON.stringify([
    tabs.map(({ href, label, count, current, icon }) => [href, label, count, current, icon]),
    lines && [lines.additions, lines.deletions],
  ]);
}

/** Parses GitHub's screen-reader text, e.g. "Lines changed: 1479 additions & 1 deletion". */
export function parseLineCounts(text: string): LineCounts | null {
  const match = /^Lines changed:\s*([\d,]+)\s+additions?\s*&\s*([\d,]+)\s+deletions?$/i.exec(text.trim());
  if (!match) {
    return null;
  }
  return { additions: toNumber(match[1]!), deletions: toNumber(match[2]!) };
}

function toNumber(digits: string): number {
  return Number(digits.replaceAll(',', ''));
}

export function formatLineCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function lineCountsLabel({ additions, deletions }: LineCounts): string {
  return `${formatLineCount(additions)} ${additions === 1 ? 'addition' : 'additions'} and ${formatLineCount(deletions)} ${deletions === 1 ? 'deletion' : 'deletions'}`;
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

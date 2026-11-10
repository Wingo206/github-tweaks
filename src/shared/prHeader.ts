/**
 * Pull request header anchors shared by features that mount beside GitHub's
 * branch summary ("X wants to merge … into base from head") or in its sticky
 * bar.
 */

const COPY_HEAD_LABEL = 'Copy head branch name to clipboard';

export interface HeadBranchMount {
  /** The copy button's tooltip (or the button itself). */
  anchor: Element;
  link: HTMLAnchorElement;
}

/** Head branch rows, found through GitHub's "Copy head branch name" control. */
export function findHeadBranchMounts(root: ParentNode): HeadBranchMount[] {
  const anchors = [
    ...root.querySelectorAll(`[data-component="Tooltip"][aria-label="${COPY_HEAD_LABEL}"]`),
    ...root.querySelectorAll(`button[aria-label="${COPY_HEAD_LABEL}"]`),
  ];
  return anchors.flatMap((anchor) => {
    const link = anchor.parentElement?.querySelector<HTMLAnchorElement>('a[data-component="BranchName"]');
    return link ? [{ anchor, link }] : [];
  });
}

/**
 * The title block (state, number, `#top` title link, Copy link) of the bar
 * GitHub keeps at the top of every pull request tab while scrolling.
 */
export function findStickyBarTitleBlocks(root: ParentNode): Element[] {
  return [
    ...root.querySelectorAll('[data-testid="diff-comparison-viewer-sticky-header-bar"] a[href="#top"]'),
  ].flatMap((link) => (link.parentElement ? [link.parentElement] : []));
}

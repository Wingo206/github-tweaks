/**
 * Pull request header anchors shared by features that mount beside GitHub's
 * branch summary ("X wants to merge … into base from head").
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

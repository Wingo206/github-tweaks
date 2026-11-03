import type { FolderRowState } from './model';

export const TREE_ROOT_SELECTOR = '#pr-file-tree';
const FOLDER_ROW_SELECTOR = 'li[role="treeitem"][aria-expanded][id]';
const TOGGLE_SELECTOR =
  ':scope > .PRIVATE_TreeView-item-container > .PRIVATE_TreeView-item-toggle';

export function findFolderRows(doc: Document = document): HTMLElement[] {
  return Array.from(
    doc.querySelectorAll<HTMLElement>(`${TREE_ROOT_SELECTOR} ${FOLDER_ROW_SELECTOR}`),
  );
}

export function isFolderRow(node: Node): node is HTMLElement {
  return (
    node instanceof HTMLElement &&
    node.matches(FOLDER_ROW_SELECTOR) &&
    node.closest(TREE_ROOT_SELECTOR) !== null
  );
}

export function readFolderRow(row: HTMLElement): FolderRowState {
  return { path: row.id, expanded: row.getAttribute('aria-expanded') === 'true' };
}

/**
 * Clicks GitHub's own chevron so the tree's React state stays in charge of
 * which folders are open. Returns false when the row has no chevron.
 */
export function toggleFolder(row: HTMLElement): boolean {
  const toggle = row.querySelector<HTMLElement>(TOGGLE_SELECTOR);
  if (!toggle) {
    return false;
  }
  toggle.click();
  return true;
}

/** Whether a childList mutation added or removed rows in the file tree. */
export function touchesTree(mutation: MutationRecord): boolean {
  const target = mutation.target;
  if (target instanceof Element && target.closest(TREE_ROOT_SELECTOR)) {
    return true;
  }
  return Array.from(mutation.addedNodes).some(
    (node) =>
      node instanceof Element &&
      (node.matches(TREE_ROOT_SELECTOR) || node.querySelector(TREE_ROOT_SELECTOR) !== null),
  );
}

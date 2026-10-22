import { treeRowCandidates, type Extent } from './model';

export const MARKER = 'data-ght-tree-viewport';
const HOST_CLASS = 'ght-tv-host';
const BAND_CLASS = 'ght-tv-band';

export const TREE_ROOT_SELECTOR = '#pr-file-tree';
const TREE_SELECTOR = 'ul[role="tree"]';
const TREE_ROW_SELECTOR = 'li[role="treeitem"]';
const ROW_BOX_SELECTOR = ':scope > .PRIVATE_TreeView-item-container';
const DIFF_SELECTOR = 'div[role="region"][id^="diff-"]';
const TOOLBAR_SELECTOR =
  'section[class^="stickyHeader__"], section[class*=" stickyHeader__"]';

export interface DiffEntry {
  element: HTMLElement;
  id: string;
}

export function findTreeRoot(doc: Document = document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(TREE_ROOT_SELECTOR);
}

export function readDiffEntries(doc: Document = document): DiffEntry[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(DIFF_SELECTOR), (element) => ({
    element,
    id: element.id,
  }));
}

export function viewportExtent(element: Element): Extent {
  const { top, bottom } = element.getBoundingClientRect();
  return { top, bottom };
}

/** The part of the window where diffs show, below GitHub's sticky toolbar. */
export function diffViewport(doc: Document = document): Extent {
  const toolbar = doc.querySelector(TOOLBAR_SELECTOR);
  const top = toolbar ? Math.max(0, toolbar.getBoundingClientRect().bottom) : 0;
  return { top, bottom: doc.defaultView?.innerHeight ?? 0 };
}

export function readDiffPath(entry: HTMLElement): string | null {
  const explicit = entry.querySelector<HTMLElement>('[data-file-path]')?.dataset.filePath;
  if (explicit) {
    return explicit;
  }
  const text = entry
    .querySelector(`h3 a[href="#${entry.id}"] code`)
    ?.textContent?.replace(/[\u200e\u200f]/g, '')
    .trim();
  return text || null;
}

/** File rows keyed by the diff id their link points at. */
export function indexTreeLinks(treeRoot: HTMLElement): Map<string, HTMLElement> {
  const rows = new Map<string, HTMLElement>();
  for (const link of treeRoot.querySelectorAll('a[href^="#diff-"]')) {
    const row = link.closest<HTMLElement>(TREE_ROW_SELECTOR);
    if (row) {
      rows.set(link.getAttribute('href')!.slice(1), row);
    }
  }
  return rows;
}

/**
 * The tree row that stands for a diff: its own file row, or the deepest
 * rendered folder when the file is inside a collapsed folder.
 */
export function findTreeRow(
  treeRoot: HTMLElement,
  links: ReadonlyMap<string, HTMLElement>,
  entry: DiffEntry,
): HTMLElement | null {
  const linked = links.get(entry.id);
  if (linked) {
    return linked;
  }

  const path = readDiffPath(entry.element);
  if (!path) {
    return null;
  }
  const doc = treeRoot.ownerDocument;
  for (const id of treeRowCandidates(path)) {
    const row = doc.getElementById(id);
    if (row?.matches(TREE_ROW_SELECTOR) && treeRoot.contains(row)) {
      return row;
    }
  }
  return null;
}

/** A row's own line, without the children of an expanded folder. */
export function treeRowBox(row: HTMLElement): HTMLElement {
  return row.querySelector<HTMLElement>(ROW_BOX_SELECTOR) ?? row;
}

/** The element that scrolls the file tree, or the tree's parent if none does. */
export function findTreeScroller(treeRoot: HTMLElement): HTMLElement | null {
  const tree = treeRoot.querySelector<HTMLElement>(TREE_SELECTOR);
  if (!tree) {
    return null;
  }
  const view = treeRoot.ownerDocument.defaultView;
  for (let node = tree.parentElement; node; node = node.parentElement) {
    const overflowY = view?.getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node;
    }
    if (node === treeRoot) {
      break;
    }
  }
  return tree.parentElement;
}

/** Converts a window-relative extent to `host`'s scrolled content coordinates. */
export function toContentExtent(host: HTMLElement, extent: Extent): Extent {
  const offset = host.scrollTop - host.getBoundingClientRect().top - host.clientTop;
  return { top: extent.top + offset, bottom: extent.bottom + offset };
}

export class TreeViewportBand {
  private band: HTMLElement | null = null;
  private host: HTMLElement | null = null;

  constructor(private readonly doc: Document = document) {}

  isBand(node: Node): boolean {
    return node instanceof Element && node.hasAttribute(MARKER);
  }

  /** Places the band at `extent`, in `host`'s content coordinates. */
  show(host: HTMLElement, extent: Extent): void {
    if (this.host !== host) {
      this.clear();
      host.classList.add(HOST_CLASS);
      this.host = host;
    }

    if (!this.band) {
      this.band = this.doc.createElement('div');
      this.band.className = BAND_CLASS;
      this.band.setAttribute(MARKER, 'band');
      this.band.setAttribute('aria-hidden', 'true');
    }
    if (this.band.parentElement !== host) {
      host.append(this.band);
    }

    this.band.style.top = `${extent.top}px`;
    this.band.style.height = `${extent.bottom - extent.top}px`;
  }

  clear(): void {
    this.doc.querySelectorAll(`[${MARKER}]`).forEach((element) => element.remove());
    this.doc
      .querySelectorAll(`.${HOST_CLASS}`)
      .forEach((element) => element.classList.remove(HOST_CLASS));
    this.band = null;
    this.host = null;
  }
}

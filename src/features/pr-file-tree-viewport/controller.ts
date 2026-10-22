import {
  diffViewport,
  findTreeRoot,
  findTreeRow,
  findTreeScroller,
  indexTreeLinks,
  readDiffEntries,
  toContentExtent,
  treeRowBox,
  TREE_ROOT_SELECTOR,
  TreeViewportBand,
  viewportExtent,
} from './dom';
import { followScrollTop, intersects, unionExtent, type Extent } from './model';

const FOLLOW_MARGIN = 16;

export class TreeViewportController {
  private readonly band: TreeViewportBand;
  private observer: MutationObserver | null = null;
  private frame: number | undefined;
  private hoveringTree = false;

  constructor(private readonly doc: Document = document) {
    this.band = new TreeViewportBand(doc);
  }

  start(): void {
    const view = this.doc.defaultView;
    view?.addEventListener('scroll', this.queueRefresh, { passive: true });
    view?.addEventListener('resize', this.queueRefresh, { passive: true });
    this.doc.addEventListener('pointerover', this.onPointerOver);
    this.doc.addEventListener('pointerout', this.onPointerOut);

    this.observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => !this.isOwnMutation(mutation))) {
        this.queueRefresh();
      }
    });
    this.observer.observe(this.doc.body, { childList: true, subtree: true });
    this.refresh();
  }

  stop(): void {
    const view = this.doc.defaultView;
    view?.removeEventListener('scroll', this.queueRefresh);
    view?.removeEventListener('resize', this.queueRefresh);
    this.doc.removeEventListener('pointerover', this.onPointerOver);
    this.doc.removeEventListener('pointerout', this.onPointerOut);
    this.observer?.disconnect();
    this.observer = null;
    if (this.frame !== undefined) {
      view?.cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    this.hoveringTree = false;
    this.band.clear();
  }

  refresh(): void {
    const treeRoot = findTreeRoot(this.doc);
    const host = treeRoot && findTreeScroller(treeRoot);
    const extent = treeRoot && host && this.visibleRowsExtent(treeRoot);
    if (!host || !extent) {
      this.band.clear();
      return;
    }

    const band = toContentExtent(host, extent);
    this.band.show(host, band);

    if (!this.hoveringTree && host.scrollHeight > host.clientHeight) {
      const scrollTop = followScrollTop(
        band,
        { scrollTop: host.scrollTop, height: host.clientHeight },
        FOLLOW_MARGIN,
      );
      if (scrollTop !== null) {
        host.scrollTop = scrollTop;
      }
    }
  }

  private visibleRowsExtent(treeRoot: HTMLElement): Extent | null {
    const viewport = diffViewport(this.doc);
    const links = indexTreeLinks(treeRoot);
    const rows = new Set<HTMLElement>();
    for (const entry of readDiffEntries(this.doc)) {
      if (!intersects(viewportExtent(entry.element), viewport)) {
        continue;
      }
      const row = findTreeRow(treeRoot, links, entry);
      if (row) {
        rows.add(row);
      }
    }
    return unionExtent(Array.from(rows, (row) => viewportExtent(treeRowBox(row))));
  }

  private isOwnMutation(mutation: MutationRecord): boolean {
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.length > 0 && nodes.every((node) => this.band.isBand(node));
  }

  private readonly queueRefresh = (): void => {
    const view = this.doc.defaultView;
    if (this.frame !== undefined || !view) {
      return;
    }
    this.frame = view.requestAnimationFrame(() => {
      this.frame = undefined;
      this.refresh();
    });
  };

  private readonly onPointerOver = (event: PointerEvent): void => {
    this.setHoveringTree(
      event.target instanceof Element && event.target.closest(TREE_ROOT_SELECTOR) !== null,
    );
  };

  private readonly onPointerOut = (event: PointerEvent): void => {
    if (!event.relatedTarget) {
      this.setHoveringTree(false);
    }
  };

  private setHoveringTree(hovering: boolean): void {
    if (this.hoveringTree === hovering) {
      return;
    }
    this.hoveringTree = hovering;
    if (!hovering) {
      this.queueRefresh();
    }
  }
}

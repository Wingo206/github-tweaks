import type { PullRequestFilesSnapshot } from '../../shared/types';
import {
  findFolderRows,
  isFolderRow,
  readFolderRow,
  toggleFolder,
  touchesTree,
} from './dom';
import { AutoCollapseState } from './model';

/** How long to wait for GitHub to apply a chevron click before trying again. */
const TOGGLE_TIMEOUT_MS = 1000;

export type SnapshotListener = (snapshot: PullRequestFilesSnapshot | null) => void;

/** Publishes the current files snapshot, or null when no pull request is loaded. */
export interface SnapshotSource {
  subscribe(listener: SnapshotListener): () => void;
}

interface PendingToggle {
  expanded: boolean;
  at: number;
}

export class AutoCollapseController {
  private readonly state = new AutoCollapseState();
  private readonly pending = new Map<string, PendingToggle>();
  private observer: MutationObserver | null = null;
  private unsubscribe: (() => void) | null = null;
  private frame: number | undefined;

  constructor(
    private readonly source: SnapshotSource,
    private readonly doc: Document = document,
  ) {}

  start(): void {
    this.observer = new MutationObserver(this.onMutations);
    this.observer.observe(this.doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded'],
      attributeOldValue: true,
    });
    this.unsubscribe = this.source.subscribe(this.onSnapshot);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.observer?.disconnect();
    this.observer = null;
    if (this.frame !== undefined) {
      this.doc.defaultView?.cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    this.state.clear();
    this.pending.clear();
  }

  reconcile(): void {
    const now = Date.now();
    const found = findFolderRows(this.doc);
    const shown = new Set(found.map((row) => row.id));
    for (const path of this.pending.keys()) {
      // A row that left the tree comes back in GitHub's default state.
      if (!shown.has(path)) {
        this.pending.delete(path);
      }
    }

    const rows = new Map<string, HTMLElement>();
    const states = [];
    for (const row of found) {
      const state = readFolderRow(row);
      const pending = this.pending.get(state.path);
      if (pending) {
        if (pending.expanded !== state.expanded && now - pending.at < TOGGLE_TIMEOUT_MS) {
          continue;
        }
        this.pending.delete(state.path);
      }
      rows.set(state.path, row);
      states.push(state);
    }

    for (const change of this.state.changes(states)) {
      const row = rows.get(change.path);
      if (row && toggleFolder(row)) {
        this.pending.set(change.path, { expanded: change.expanded, at: now });
      }
    }
  }

  private readonly onSnapshot = (snapshot: PullRequestFilesSnapshot | null): void => {
    if (!snapshot) {
      this.state.clear();
      this.pending.clear();
      return;
    }
    this.state.setFiles(snapshot.files);
    this.reconcile();
  };

  private readonly onMutations = (mutations: MutationRecord[]): void => {
    let treeChanged = false;
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        if (!isFolderRow(mutation.target)) {
          continue;
        }
        treeChanged = true;
        if (
          mutation.oldValue === 'false' &&
          mutation.target.getAttribute('aria-expanded') === 'true'
        ) {
          this.state.noteOpened(mutation.target.id);
        }
      } else if (touchesTree(mutation)) {
        treeChanged = true;
      }
    }
    if (treeChanged) {
      this.queueReconcile();
    }
  };

  private queueReconcile(): void {
    const view = this.doc.defaultView;
    if (this.frame !== undefined || !view) {
      return;
    }
    this.frame = view.requestAnimationFrame(() => {
      this.frame = undefined;
      this.reconcile();
    });
  }
}

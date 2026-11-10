import { tracked, trackedObserver } from '../../diagnostics/recorder';
import type { PullRequestFilesSnapshot } from '../../shared/types';
import {
  findFolderRows,
  isFolderRow,
  readFolderRow,
  toggleFolder,
  touchesTree,
} from './dom';
import { AutoCollapseState, type FolderRowState } from './model';

/** How long to wait for GitHub to apply a chevron click before trying again. */
const TOGGLE_TIMEOUT_MS = 1000;
/** Chevron clicks per frame stop once this much time has gone by. */
const FRAME_BUDGET_MS = 16;

/** Whether `path` is under one of `folders`. */
function isInside(path: string, folders: ReadonlySet<string>): boolean {
  for (let end = path.lastIndexOf('/'); end > 0; end = path.lastIndexOf('/', end - 1)) {
    if (folders.has(path.slice(0, end))) {
      return true;
    }
  }
  return false;
}

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
    this.observer = trackedObserver('pr-auto-collapse-viewed', this.onMutations);
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

  /**
   * Only folders that are shown get toggled: rows under a closed (or closing)
   * folder wait until it is opened again. Each chevron click makes GitHub
   * re-render its tree, which is slow on large pull requests, so clicks are
   * spread over frames instead of all landing in one long task.
   */
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
    const states: FolderRowState[] = [];
    const closed = new Set<string>();
    for (const row of found) {
      const state = readFolderRow(row);
      if (isInside(state.path, closed)) {
        continue;
      }
      const pending = this.pending.get(state.path);
      if (pending) {
        if (pending.expanded !== state.expanded && now - pending.at < TOGGLE_TIMEOUT_MS) {
          if (!pending.expanded) {
            closed.add(state.path);
          }
          continue;
        }
        this.pending.delete(state.path);
      }
      if (!state.expanded) {
        closed.add(state.path);
      }
      rows.set(state.path, row);
      states.push(state);
    }

    const started = performance.now();
    let deferred = false;
    for (const change of this.state.changes(states)) {
      if (isInside(change.path, closed)) {
        continue;
      }
      if (deferred || performance.now() - started > FRAME_BUDGET_MS) {
        deferred = true;
        if (change.expanded) {
          this.state.deferReopen(change.path);
        }
        continue;
      }
      const row = rows.get(change.path);
      if (row && toggleFolder(row)) {
        this.pending.set(change.path, { expanded: change.expanded, at: now });
        if (!change.expanded) {
          closed.add(change.path);
        }
      }
    }
    if (deferred) {
      this.queueReconcile();
    }
  }

  private readonly onSnapshot = (snapshot: PullRequestFilesSnapshot | null): void => {
    if (!snapshot) {
      this.state.clear();
      this.pending.clear();
      return;
    }
    this.state.setFiles(snapshot.files);
    this.queueReconcile();
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
    this.frame = view.requestAnimationFrame(() =>
      tracked('pr-auto-collapse-viewed', 'reconcile', () => {
        this.frame = undefined;
        this.reconcile();
      }),
    );
  }
}

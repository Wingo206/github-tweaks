import type { PullRequestFile } from '../../shared/types';
import { isViewed } from '../pr-sidebar-metadata/model';

export interface FolderRowState {
  path: string;
  expanded: boolean;
}

/** Whether every file under each folder in the pull request is viewed. */
export function folderCompletion(
  files: readonly PullRequestFile[],
): Map<string, boolean> {
  const complete = new Map<string, boolean>();
  for (const file of files) {
    const viewed = isViewed(file.viewedState);
    for (
      let end = file.path.lastIndexOf('/');
      end > 0;
      end = file.path.lastIndexOf('/', end - 1)
    ) {
      const folder = file.path.slice(0, end);
      complete.set(folder, (complete.get(folder) ?? true) && viewed);
    }
  }
  return complete;
}

/**
 * Decides which folder rows to open or close. Complete folders close whenever
 * they are shown open, unless they were opened after completing. A folder
 * that stops being complete reopens the next time its row is shown.
 */
export class AutoCollapseState {
  private complete = new Map<string, boolean>();
  /** Complete folders that were opened after they completed. */
  private readonly keptOpen = new Set<string>();
  /** Folders that stopped being complete and have not been shown open since. */
  private readonly reopen = new Set<string>();

  setFiles(files: readonly PullRequestFile[]): void {
    const next = folderCompletion(files);
    for (const [path, complete] of next) {
      const previous = this.complete.get(path);
      if (previous === complete) {
        continue;
      }
      this.keptOpen.delete(path);
      if (previous && !complete) {
        this.reopen.add(path);
      } else {
        this.reopen.delete(path);
      }
    }
    this.complete = next;
  }

  clear(): void {
    this.complete = new Map();
    this.keptOpen.clear();
    this.reopen.clear();
  }

  /** Records a folder opened by the user or by GitHub. */
  noteOpened(path: string): void {
    if (this.complete.get(path)) {
      this.keptOpen.add(path);
    }
  }

  /** The rows whose open state should change, with the state to set. */
  changes(rows: readonly FolderRowState[]): FolderRowState[] {
    const changes: FolderRowState[] = [];
    for (const row of rows) {
      const complete = this.complete.get(row.path);
      if (complete === undefined) {
        continue;
      }
      if (complete) {
        if (row.expanded && !this.keptOpen.has(row.path)) {
          changes.push({ path: row.path, expanded: false });
        }
      } else if (this.reopen.delete(row.path) && !row.expanded) {
        changes.push({ path: row.path, expanded: true });
      }
    }
    return changes;
  }
}

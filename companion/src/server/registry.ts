import type { FolderState, ServerMessage } from '../protocol';
import type { RememberedClone } from './config';

export interface WindowEntry {
  windowId: string;
  version: string;
  folders: FolderState[];
  focused: boolean;
  /** Server time of the last `focused: false → true` transition. */
  focusedAt: number | null;
  /** Windows handle captured at the last focus transition. */
  hwnd: string | null;
  send(message: ServerMessage): void;
}

export class WindowRegistry {
  private readonly windows = new Set<WindowEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  register(windowId: string, version: string, send: (message: ServerMessage) => void): WindowEntry {
    const entry: WindowEntry = {
      windowId,
      version,
      folders: [],
      focused: false,
      focusedAt: null,
      hwnd: null,
      send,
    };
    this.windows.add(entry);
    return entry;
  }

  /** Applies a `state` message; returns true when the window just gained focus. */
  updateState(entry: WindowEntry, folders: FolderState[], focused: boolean): boolean {
    const gainedFocus = focused && !entry.focused;
    entry.folders = folders;
    entry.focused = focused;
    if (gainedFocus) {
      entry.focusedAt = this.now();
    }
    return gainedFocus;
  }

  remove(entry: WindowEntry): void {
    this.windows.delete(entry);
  }

  list(): WindowEntry[] {
    return [...this.windows];
  }

  get size(): number {
    return this.windows.size;
  }
}

/** Every folder ever reported, persisted for the launch fallback. */
export class CloneMemory {
  private readonly clones = new Map<string, RememberedClone>();

  constructor(
    initial: RememberedClone[],
    private readonly persist: (clones: RememberedClone[]) => void,
    private readonly now: () => number = Date.now,
  ) {
    for (const clone of initial) {
      this.clones.set(clone.path, clone);
    }
  }

  upsert(folders: FolderState[]): void {
    if (folders.length === 0) {
      return;
    }
    const lastSeenAt = this.now();
    for (const folder of folders) {
      this.clones.set(folder.path, { path: folder.path, remotes: folder.remotes, lastSeenAt });
    }
    this.persist(this.list());
  }

  list(): RememberedClone[] {
    return [...this.clones.values()];
  }
}

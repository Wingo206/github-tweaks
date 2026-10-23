import * as vscode from 'vscode';
import { normalizeRemote, type FolderState, type WorkingTreeState } from '../protocol';

// Minimal subset of the built-in git extension API (extensions/git/src/api/git.d.ts).
export interface GitRemote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

interface GitBranch {
  readonly name?: string;
  readonly upstream?: { readonly name: string; readonly remote: string };
}

interface GitChange {
  readonly status: number;
}

interface GitRepositoryState {
  readonly HEAD: GitBranch | undefined;
  readonly remotes: GitRemote[];
  readonly indexChanges: GitChange[];
  readonly workingTreeChanges: GitChange[];
  readonly mergeChanges: GitChange[];
  readonly rebaseCommit?: unknown;
  readonly onDidChange: vscode.Event<void>;
}

export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  status(): Promise<void>;
}

interface GitApi {
  readonly state: 'uninitialized' | 'initialized';
  readonly onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
  readonly repositories: GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

const DEBOUNCE_MS = 250;

// `Status.UNTRACKED` and `Status.IGNORED` in the git extension API.
const UNTRACKED_STATUSES = new Set([7, 8]);

/**
 * Tracks this window's git repositories and focus, calling `onChange` with
 * debounced repository changes and immediate focus changes.
 */
export class WindowStateTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repositoryListeners = new Map<GitRepository, vscode.Disposable>();
  private git: GitApi | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly onChange: () => void) {}

  async start(): Promise<void> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    const exports = extension ? (extension.isActive ? extension.exports : await extension.activate()) : null;
    const git = exports?.getAPI(1) ?? null;
    this.git = git;

    this.disposables.push(
      vscode.window.onDidChangeWindowState(() => this.flush()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule()),
    );
    if (!git) {
      return;
    }
    this.disposables.push(
      git.onDidChangeState(() => this.schedule()),
      git.onDidOpenRepository((repository) => {
        this.watch(repository);
        this.schedule();
      }),
      git.onDidCloseRepository((repository) => {
        this.repositoryListeners.get(repository)?.dispose();
        this.repositoryListeners.delete(repository);
        this.schedule();
      }),
    );
    for (const repository of git.repositories) {
      this.watch(repository);
    }
  }

  folders(): FolderState[] {
    return (this.git?.repositories ?? []).map((repository) => {
      const head = repository.state.HEAD;
      const remotes = repository.state.remotes
        .map((remote) => normalizeRemote(remote.fetchUrl ?? remote.pushUrl ?? ''))
        .filter((remote): remote is string => remote !== null);
      return {
        path: repository.rootUri.fsPath,
        remotes: [...new Set(remotes)],
        branch: head?.name ?? null,
        upstreamBranch: head?.upstream?.name ?? null,
        workingTree: workingTreeState(repository),
      };
    });
  }

  repository(path: string): GitRepository | null {
    return this.git?.repositories.find((repository) => repository.rootUri.fsPath === path) ?? null;
  }

  focused(): boolean {
    return vscode.window.state.focused;
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    for (const listener of this.repositoryListeners.values()) {
      listener.dispose();
    }
    this.repositoryListeners.clear();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private watch(repository: GitRepository): void {
    if (!this.repositoryListeners.has(repository)) {
      this.repositoryListeners.set(repository, repository.state.onDidChange(() => this.schedule()));
    }
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.onChange();
  }
}

export function workingTreeState(repository: GitRepository): WorkingTreeState {
  const { state } = repository;
  return {
    staged: state.indexChanges.length,
    modified: state.workingTreeChanges.filter((change) => !UNTRACKED_STATUSES.has(change.status)).length,
    conflicts: state.mergeChanges.length,
    rebasing: state.rebaseCommit !== undefined && state.rebaseCommit !== null,
  };
}

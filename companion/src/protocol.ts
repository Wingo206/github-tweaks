// Message shapes shared by the companion server, the Cursor extension, and the
// browser extension. The browser bundles the runtime helpers too, so keep this
// file free of Node APIs.

export interface FolderState {
  /** Absolute WSL path of the git root. */
  path: string;
  /** Normalized `github.com/owner/repo`, lowercase. */
  remotes: string[];
  /** Checked-out local branch. */
  branch: string | null;
  /** Tracked remote branch name without the remote prefix. */
  upstreamBranch: string | null;
  /** Null when the window runs a companion that predates working-tree reporting. */
  workingTree: WorkingTreeState | null;
}

export interface WorkingTreeState {
  staged: number;
  /** Tracked files with unstaged edits. Untracked files are not counted. */
  modified: number;
  conflicts: number;
  rebasing: boolean;
}

/** Why a clone cannot switch branches right now. */
export type CheckoutBlocker =
  | { kind: 'changes'; staged: number; modified: number; conflicts: number }
  | { kind: 'rebase' }
  | { kind: 'outdated' };

export interface CheckoutCommand {
  /** `owner/repo` of the pull request's base repository. */
  repo: string;
  branch: string;
  pullNumber: number;
  /** Head branch lives in a fork; checked out with `gh pr checkout`. */
  fork: boolean;
}

export type WindowMessage =
  | { type: 'hello'; windowId: string; version: string }
  | { type: 'state'; folders: FolderState[]; focused: boolean }
  | { type: 'opened'; requestId: string; ok: true }
  | { type: 'opened'; requestId: string; ok: false; error: string }
  | { type: 'checkout-started'; requestId: string; ok: true }
  | { type: 'checkout-started'; requestId: string; ok: false; error: string };

export type ServerMessage =
  | { type: 'restart' }
  | { type: 'open'; requestId: string; path: string; line: number; column: number }
  | ({ type: 'checkout'; requestId: string; path: string } & CheckoutCommand);

export type Ref = { kind: 'branch'; name: string } | { kind: 'commit'; sha: string };

export interface OpenRequest {
  /** `owner/repo`. */
  repo: string;
  /** Repo-relative, no leading slash. */
  path: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  ref: Ref | null;
}

export type OpenResponse =
  | { status: 'opened'; folder: string; matchedBranch: boolean; launchUrl: string | null }
  | { status: 'launch'; folder: string; launchUrl: string }
  | { status: 'launching'; folder: string }
  | { status: 'no-clone'; repo: string }
  | { status: 'error'; reason: 'open-failed' | 'timeout'; message: string };

export interface HealthResponse {
  ok: true;
  version: string;
  windows: number;
}

export interface BranchStatusRequest {
  /** `owner/repo`. */
  repo: string;
  branch: string;
}

export interface CloneStatus {
  /** Absolute WSL path of the git root. */
  path: string;
  branch: string | null;
  checkedOut: boolean;
  blocker: CheckoutBlocker | null;
}

export interface BranchStatusResponse {
  /** Clones of the repository open in Cursor windows, most recently focused first. */
  clones: CloneStatus[];
}

export interface CheckoutRequest extends CheckoutCommand {
  folder: string;
}

export type CheckoutResponse =
  /** `launchUrl` is set when the window could not be raised directly. */
  | { status: 'started'; folder: string; launchUrl: string | null }
  | { status: 'checked-out'; folder: string; launchUrl: string | null }
  | { status: 'blocked'; folder: string; blocker: CheckoutBlocker }
  | { status: 'not-open'; folder: string }
  | { status: 'error'; reason: 'checkout-failed' | 'timeout'; message: string };

export interface FocusRequest {
  folder: string;
}

export type FocusResponse =
  | { status: 'focused' }
  | { status: 'launch'; launchUrl: string }
  | { status: 'not-open'; folder: string };

export function checkoutBlocker(folder: FolderState): CheckoutBlocker | null {
  const tree = folder.workingTree;
  if (!tree) {
    return { kind: 'outdated' };
  }
  if (tree.rebasing) {
    return { kind: 'rebase' };
  }
  if (tree.staged > 0 || tree.modified > 0 || tree.conflicts > 0) {
    return { kind: 'changes', staged: tree.staged, modified: tree.modified, conflicts: tree.conflicts };
  }
  return null;
}

export function describeCheckoutBlocker(blocker: CheckoutBlocker): string {
  switch (blocker.kind) {
    case 'outdated':
      return 'Reload this Cursor window to update the companion';
    case 'rebase':
      return 'Rebase in progress';
    case 'changes': {
      const parts = [
        blocker.conflicts ? `${blocker.conflicts} conflicted` : null,
        blocker.staged ? `${blocker.staged} staged` : null,
        blocker.modified ? `${blocker.modified} modified` : null,
      ].filter((part) => part !== null);
      return `Uncommitted changes: ${parts.join(', ')}`;
    }
  }
}

export function isCheckedOut(folder: FolderState, branch: string): boolean {
  return folder.branch === branch || folder.upstreamBranch === branch;
}

/**
 * Accepts branch names that are valid git refs and safe to single-quote in a
 * shell. Stricter than `git check-ref-format`; rejects quotes, spaces, `@`,
 * and other rare characters.
 */
export function isSafeBranchName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    return false;
  }
  if (!/^[A-Za-z0-9._/#+-]+$/.test(value)) {
    return false;
  }
  if (value.startsWith('-') || value.endsWith('.lock') || value.includes('..')) {
    return false;
  }
  return value
    .split('/')
    .every((segment) => segment !== '' && !segment.startsWith('.') && !segment.endsWith('.'));
}

export function encodeMessage(message: WindowMessage | ServerMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/** Splits a newline-delimited JSON stream into parsed values. */
export class LineDecoder {
  private buffer = '';

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const values: unknown[] = [];
    let index: number;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) {
        continue;
      }
      try {
        values.push(JSON.parse(line));
      } catch {
        values.push(undefined);
      }
    }
    return values;
  }
}

export function parseWindowMessage(value: unknown): WindowMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value.type) {
    case 'hello':
      return typeof value.windowId === 'string' && typeof value.version === 'string'
        ? { type: 'hello', windowId: value.windowId, version: value.version }
        : null;
    case 'state': {
      if (!Array.isArray(value.folders) || typeof value.focused !== 'boolean') {
        return null;
      }
      const folders = value.folders.map(parseFolderState);
      if (folders.some((folder) => folder === null)) {
        return null;
      }
      return { type: 'state', folders: folders as FolderState[], focused: value.focused };
    }
    case 'opened':
    case 'checkout-started': {
      const type = value.type === 'opened' ? 'opened' : 'checkout-started';
      if (typeof value.requestId !== 'string') {
        return null;
      }
      if (value.ok === true) {
        return { type, requestId: value.requestId, ok: true };
      }
      if (value.ok === false && typeof value.error === 'string') {
        return { type, requestId: value.requestId, ok: false, error: value.error };
      }
      return null;
    }
    default:
      return null;
  }
}

export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type === 'restart') {
    return { type: 'restart' };
  }
  if (
    value.type === 'open' &&
    typeof value.requestId === 'string' &&
    typeof value.path === 'string' &&
    isPositiveInteger(value.line) &&
    isPositiveInteger(value.column)
  ) {
    return {
      type: 'open',
      requestId: value.requestId,
      path: value.path,
      line: value.line,
      column: value.column,
    };
  }
  if (value.type === 'checkout' && typeof value.requestId === 'string' && isAbsolutePath(value.path)) {
    const command = parseCheckoutCommand(value);
    return command ? { type: 'checkout', requestId: value.requestId, path: value.path, ...command } : null;
  }
  return null;
}

export function parseBranchStatusRequest(value: unknown): BranchStatusRequest | null {
  if (!isRecord(value) || !isRepo(value.repo) || !isSafeBranchName(value.branch)) {
    return null;
  }
  return { repo: value.repo, branch: value.branch };
}

export function parseCheckoutRequest(value: unknown): CheckoutRequest | null {
  if (!isRecord(value) || !isAbsolutePath(value.folder)) {
    return null;
  }
  const command = parseCheckoutCommand(value);
  return command ? { folder: value.folder, ...command } : null;
}

export function parseFocusRequest(value: unknown): FocusRequest | null {
  return isRecord(value) && isAbsolutePath(value.folder) ? { folder: value.folder } : null;
}

function parseCheckoutCommand(value: Record<string, unknown>): CheckoutCommand | null {
  const { repo, branch, pullNumber, fork } = value;
  if (!isRepo(repo) || !isSafeBranchName(branch) || !isPositiveInteger(pullNumber) || typeof fork !== 'boolean') {
    return null;
  }
  return { repo, branch, pullNumber, fork };
}

export function parseOpenRequest(value: unknown): OpenRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const { repo, path, line, column, ref } = value;
  if (!isRepo(repo)) {
    return null;
  }
  if (!isSafeRelativePath(path)) {
    return null;
  }
  if (!isPositiveInteger(line) || !isPositiveInteger(column)) {
    return null;
  }
  const parsedRef = parseRef(ref);
  if (parsedRef === undefined) {
    return null;
  }
  return { repo, path, line, column, ref: parsedRef };
}

function parseRef(value: unknown): Ref | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.kind === 'branch' && typeof value.name === 'string' && value.name.length > 0) {
    return { kind: 'branch', name: value.name };
  }
  if (value.kind === 'commit' && typeof value.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(value.sha)) {
    return { kind: 'commit', sha: value.sha };
  }
  return undefined;
}

function parseFolderState(value: unknown): FolderState | null {
  if (
    !isRecord(value) ||
    typeof value.path !== 'string' ||
    !Array.isArray(value.remotes) ||
    !value.remotes.every((remote) => typeof remote === 'string') ||
    !isNullableString(value.branch) ||
    !isNullableString(value.upstreamBranch)
  ) {
    return null;
  }
  return {
    path: value.path,
    remotes: value.remotes as string[],
    branch: value.branch,
    upstreamBranch: value.upstreamBranch,
    workingTree: parseWorkingTree(value.workingTree),
  };
}

function parseWorkingTree(value: unknown): WorkingTreeState | null {
  if (
    !isRecord(value) ||
    !isCount(value.staged) ||
    !isCount(value.modified) ||
    !isCount(value.conflicts) ||
    typeof value.rebasing !== 'boolean'
  ) {
    return null;
  }
  return {
    staged: value.staged,
    modified: value.modified,
    conflicts: value.conflicts,
    rebasing: value.rebasing,
  };
}

function isRepo(value: unknown): value is string {
  return typeof value === 'string' && /^[\w.-]+\/[\w.-]+$/.test(value);
}

function isAbsolutePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    value.length <= 4096 &&
    !value.includes('\0')
  );
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    return false;
  }
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) {
    return false;
  }
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * Normalizes a git remote URL to `github.com/owner/repo` (lowercase), or null
 * for non-GitHub remotes.
 */
export function normalizeRemote(url: string): string | null {
  const trimmed = url.trim();
  const patterns = [
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/i,
    /^ssh:\/\/git@github\.com(?::\d+)?\/([^/]+)\/(.+?)(?:\.git)?\/?$/i,
    /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1] && match[2] && !match[2].includes('/')) {
      return `github.com/${match[1]}/${match[2]}`.toLowerCase();
    }
  }
  return null;
}

/** Compares dotted numeric versions; returns <0, 0, or >0. */
export function compareVersions(left: string, right: string): number {
  const parse = (version: string): number[] =>
    version
      .split('-')[0]!
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

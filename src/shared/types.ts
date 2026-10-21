import type { Ref } from '../../companion/src/protocol';

export type { Ref };

export type ViewedState = 'VIEWED' | 'UNVIEWED' | 'DISMISSED';

export interface PullRequestRef {
  owner: string;
  repository: string;
  number: number;
}

export type PullRequestChangeSelection =
  | { kind: 'all' }
  | { kind: 'commit'; oid: string }
  | { kind: 'range'; startOid: string; endOid: string };

export interface PullRequestFile {
  path: string;
  additions: number;
  deletions: number;
  viewedState: ViewedState;
}

export interface PullRequestFilesSnapshot {
  ref: PullRequestRef;
  selection: PullRequestChangeSelection;
  pullRequestId: string;
  headOid: string;
  files: PullRequestFile[];
  savedAt: number;
}

export type PageStatus =
  | { state: 'idle' }
  | { state: 'disabled' }
  | { state: 'loading'; ref: PullRequestRef }
  | { state: 'ready'; ref: PullRequestRef; fileCount: number; savedAt: number }
  | { state: 'error'; ref?: PullRequestRef; message: string };

export interface PinnedPerson {
  id: string;
  login: string;
  name: string;
  avatarUrl: string;
}

export interface HandbackContext {
  viewerLogin: string;
  viewerId: string;
  authorLogin: string;
  authorId: string;
  assignableId: string;
  assigneeLogins: string[];
  assigneeIdsByLogin: Record<string, string>;
}

export type OpenTarget =
  | {
      kind: 'pr-line';
      owner: string;
      repository: string;
      number: number;
      path: string;
      line: number;
    }
  | {
      kind: 'pr-comment';
      owner: string;
      repository: string;
      number: number;
      commentId: string;
      fallback: { path: string; line: number } | null;
    }
  | {
      kind: 'blob';
      owner: string;
      repository: string;
      ref: Ref | null;
      path: string;
      line: number;
    };

export type OpenFailureReason =
  | 'not-paired'
  | 'companion-offline'
  | 'no-clone'
  | 'comment-not-found'
  | 'open-failed'
  | 'timeout';

export type OpenResult =
  | { status: 'opened' }
  | { status: 'failed'; reason: OpenFailureReason; message: string };

export type CompanionStatus =
  | { connected: true; version: string; windows: number }
  | { connected: false; reason: 'not-paired' | 'offline' | 'unauthorized' };

export interface CompanionSettingsView {
  port: number;
  paired: boolean;
}

export type BackgroundRequest =
  | { type: 'open-in-cursor'; target: OpenTarget }
  | { type: 'companion-status' }
  | { type: 'companion:get-settings' }
  | { type: 'companion:save-settings'; port?: number; token?: string }
  | { type: 'auth:get' }
  | { type: 'auth:save'; token: string }
  | { type: 'auth:remove' }
  | { type: 'ui:open-popup' }
  | {
      type: 'cache:get';
      ref: PullRequestRef;
      selection: PullRequestChangeSelection;
    }
  | {
      type: 'pull:load';
      ref: PullRequestRef;
      selection: PullRequestChangeSelection;
    }
  | { type: 'pull:handback-context'; ref: PullRequestRef }
  | { type: 'pull:handback-assignee'; ref: PullRequestRef }
  | { type: 'pins:get'; owner: string; repository: string }
  | {
      type: 'pins:save';
      owner: string;
      repository: string;
      people: PinnedPerson[];
    };

export interface BackgroundResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export type ContentRequest =
  | { type: 'page:get-status' }
  | { type: 'page:retry' }
  | { type: 'mermaid:get-logs' }
  | { type: 'mermaid:clear-logs' };

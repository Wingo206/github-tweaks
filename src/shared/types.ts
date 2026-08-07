export type ViewedState = 'VIEWED' | 'UNVIEWED' | 'DISMISSED';

export interface PullRequestRef {
  owner: string;
  repository: string;
  number: number;
}

export interface PullRequestFile {
  path: string;
  additions: number;
  deletions: number;
  viewedState: ViewedState;
}

export interface PullRequestFilesSnapshot {
  ref: PullRequestRef;
  pullRequestId: string;
  headOid: string;
  files: PullRequestFile[];
  savedAt: number;
}

export type PageStatus =
  | { state: 'idle' }
  | { state: 'loading'; ref: PullRequestRef }
  | { state: 'ready'; ref: PullRequestRef; fileCount: number; savedAt: number }
  | { state: 'error'; ref?: PullRequestRef; message: string };

export interface HandbackContext {
  viewerLogin: string;
  viewerId: string;
  authorLogin: string;
  authorId: string;
  assignableId: string;
  assigneeLogins: string[];
  assigneeIdsByLogin: Record<string, string>;
}

export type BackgroundRequest =
  | { type: 'auth:get' }
  | { type: 'auth:save'; token: string }
  | { type: 'auth:remove' }
  | { type: 'ui:open-popup' }
  | { type: 'cache:get'; ref: PullRequestRef }
  | { type: 'pull:load'; ref: PullRequestRef }
  | {
      type: 'pull:set-viewed';
      ref: PullRequestRef;
      pullRequestId: string;
      path: string;
      viewed: boolean;
    }
  | { type: 'pull:handback-context'; ref: PullRequestRef }
  | { type: 'pull:handback-assignee'; ref: PullRequestRef };

export interface BackgroundResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export type ContentRequest =
  | { type: 'page:get-status' }
  | { type: 'page:retry' };

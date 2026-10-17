import type { OpenRequest } from '../../companion/src/protocol';
import type { PullRequestContext } from '../github/pullRequestContext';
import type { OpenResult, OpenTarget, PullRequestRef } from '../shared/types';

export type Resolution =
  | { ok: true; request: OpenRequest }
  | { ok: false; result: OpenResult };

/** Loads PR context, or returns null when it is unavailable (no PAT, network). */
export type ContextLoader = (ref: PullRequestRef) => Promise<PullRequestContext | null>;

export async function resolveOpenTarget(
  target: OpenTarget,
  loadContext: ContextLoader,
): Promise<Resolution> {
  const repo = `${target.owner}/${target.repository}`;
  switch (target.kind) {
    case 'blob':
      return {
        ok: true,
        request: { repo, path: target.path, line: target.line, column: 1, ref: target.ref },
      };
    case 'pr-line': {
      const context = await loadContext(pullRef(target));
      return {
        ok: true,
        request: {
          repo,
          path: target.path,
          line: target.line,
          column: 1,
          ref: context?.headRefName ? { kind: 'branch', name: context.headRefName } : null,
        },
      };
    }
    case 'pr-comment': {
      const context = await loadContext(pullRef(target));
      const thread = context?.threadsByCommentId.get(target.commentId);
      const ref = context?.headRefName ? { kind: 'branch' as const, name: context.headRefName } : null;
      if (thread) {
        // File-level comments have neither line; open the top of the file.
        const line = thread.line ?? thread.originalLine ?? 1;
        return { ok: true, request: { repo, path: thread.path, line, column: 1, ref } };
      }
      if (target.fallback) {
        return {
          ok: true,
          request: { repo, path: target.fallback.path, line: target.fallback.line, column: 1, ref },
        };
      }
      return {
        ok: false,
        result: {
          status: 'failed',
          reason: 'comment-not-found',
          message: context
            ? 'Couldn’t find this comment’s file and line.'
            : 'Couldn’t look up this comment. Check the GitHub token in the popup.',
        },
      };
    }
  }
}

function pullRef(target: { owner: string; repository: string; number: number }): PullRequestRef {
  return { owner: target.owner, repository: target.repository, number: target.number };
}

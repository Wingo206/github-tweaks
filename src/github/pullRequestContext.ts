import type { PullRequestRef } from '../shared/types';
import { GitHubApiError, graphql } from './graphql';

export interface ReviewThreadLocation {
  path: string;
  line: number | null;
  originalLine: number | null;
}

export interface PullRequestContext {
  headRefName: string;
  /** Review thread location by comment `databaseId` (as a string). */
  threadsByCommentId: Map<string, ReviewThreadLocation>;
}

const CONTEXT_TTL_MS = 60_000;
const MAX_PAGES = 20;

const PULL_REQUEST_CONTEXT_QUERY = `
  query PullRequestContext(
    $owner: String!
    $repository: String!
    $number: Int!
    $cursor: String
  ) {
    repository(owner: $owner, name: $repository) {
      pullRequest(number: $number) {
        headRefName
        reviewThreads(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            path
            line
            originalLine
            comments(first: 100) { nodes { databaseId } }
          }
        }
      }
    }
  }
`;

interface PullRequestContextData {
  repository: {
    pullRequest: {
      headRefName: string;
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          path: string;
          line: number | null;
          originalLine: number | null;
          comments: { nodes: Array<{ databaseId: number | null }> };
        }>;
      };
    } | null;
  } | null;
}

const cache = new Map<string, { context: PullRequestContext; savedAt: number }>();

export function clearPullRequestContextCache(): void {
  cache.clear();
}

export async function loadPullRequestContext(
  token: string,
  ref: PullRequestRef,
  now: () => number = Date.now,
): Promise<PullRequestContext> {
  const key = `${ref.owner}/${ref.repository}#${ref.number}`.toLowerCase();
  const cached = cache.get(key);
  if (cached && now() - cached.savedAt < CONTEXT_TTL_MS) {
    return cached.context;
  }

  const threadsByCommentId = new Map<string, ReviewThreadLocation>();
  let headRefName = '';
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data: PullRequestContextData = await graphql<PullRequestContextData>(
      token,
      PULL_REQUEST_CONTEXT_QUERY,
      { owner: ref.owner, repository: ref.repository, number: ref.number, cursor },
    );
    const pullRequest = data.repository?.pullRequest;
    if (!pullRequest) {
      throw new GitHubApiError('Pull request not found.');
    }
    headRefName = pullRequest.headRefName;
    for (const thread of pullRequest.reviewThreads.nodes) {
      const location = { path: thread.path, line: thread.line, originalLine: thread.originalLine };
      for (const comment of thread.comments.nodes) {
        if (comment.databaseId !== null) {
          threadsByCommentId.set(String(comment.databaseId), location);
        }
      }
    }
    const { hasNextPage, endCursor } = pullRequest.reviewThreads.pageInfo;
    if (!hasNextPage || !endCursor) {
      break;
    }
    cursor = endCursor;
  }

  const context = { headRefName, threadsByCommentId };
  cache.set(key, { context, savedAt: now() });
  return context;
}

import type {
  PullRequestFile,
  PullRequestFilesSnapshot,
  PullRequestRef,
  ViewedState,
} from '../shared/types';
import { GitHubApiError, graphql } from './graphql';

const FILES_QUERY = `
  query PullRequestFiles(
    $owner: String!
    $repository: String!
    $number: Int!
    $after: String
  ) {
    repository(owner: $owner, name: $repository) {
      pullRequest(number: $number) {
        id
        headRefOid
        files(first: 100, after: $after) {
          nodes {
            path
            additions
            deletions
            viewerViewedState
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const MARK_VIEWED_MUTATION = `
  mutation MarkFileAsViewed($pullRequestId: ID!, $path: String!) {
    markFileAsViewed(input: {
      pullRequestId: $pullRequestId
      path: $path
    }) {
      pullRequest { id }
    }
  }
`;

const UNMARK_VIEWED_MUTATION = `
  mutation UnmarkFileAsViewed($pullRequestId: ID!, $path: String!) {
    unmarkFileAsViewed(input: {
      pullRequestId: $pullRequestId
      path: $path
    }) {
      pullRequest { id }
    }
  }
`;

interface FilesQueryData {
  repository: {
    pullRequest: {
      id: string;
      headRefOid: string;
      files: {
        nodes: Array<{
          path: string;
          additions: number;
          deletions: number;
          viewerViewedState: ViewedState;
        }>;
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
      };
    } | null;
  } | null;
}

export async function loadPullRequestFiles(
  token: string,
  ref: PullRequestRef,
): Promise<PullRequestFilesSnapshot> {
  const files: PullRequestFile[] = [];
  let after: string | null = null;
  let pullRequestId = '';
  let headOid = '';

  do {
    const data: FilesQueryData = await graphql<FilesQueryData>(
      token,
      FILES_QUERY,
      {
        owner: ref.owner,
        repository: ref.repository,
        number: ref.number,
        after,
      },
    );

    const pullRequest = data.repository?.pullRequest;
    if (!pullRequest) {
      throw new GitHubApiError(
        `Pull request ${ref.owner}/${ref.repository}#${ref.number} was not found or is not accessible.`,
      );
    }

    pullRequestId = pullRequest.id;
    headOid = pullRequest.headRefOid;
    files.push(
      ...pullRequest.files.nodes.map((file) => ({
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
        viewedState: file.viewerViewedState,
      })),
    );

    after = pullRequest.files.pageInfo.hasNextPage
      ? pullRequest.files.pageInfo.endCursor
      : null;

    if (pullRequest.files.pageInfo.hasNextPage && !after) {
      throw new GitHubApiError(
        'GitHub reported another files page without a cursor.',
      );
    }
  } while (after);

  return {
    ref,
    pullRequestId,
    headOid,
    files,
    savedAt: Date.now(),
  };
}

export async function setFileViewed(
  token: string,
  pullRequestId: string,
  path: string,
  viewed: boolean,
): Promise<void> {
  await graphql(
    token,
    viewed ? MARK_VIEWED_MUTATION : UNMARK_VIEWED_MUTATION,
    { pullRequestId, path },
  );
}

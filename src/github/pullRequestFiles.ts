import type {
  PullRequestChangeSelection,
  PullRequestFile,
  PullRequestFilesSnapshot,
  PullRequestRef,
  ViewedState,
} from '../shared/types';
import { GitHubApiError, graphql } from './graphql';
import { githubRest } from './rest';

const REST_FILES_PAGE_SIZE = 100;
const REST_COMPARISON_FILE_LIMIT = 300;

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

interface RestChangedFile {
  filename: string;
  previous_filename?: string;
  additions: number;
  deletions: number;
}

interface RestCommit {
  parents: Array<{ sha: string }>;
  files?: RestChangedFile[];
}

interface RestComparison {
  files?: RestChangedFile[];
}

export async function loadPullRequestFiles(
  token: string,
  ref: PullRequestRef,
  selection: PullRequestChangeSelection = { kind: 'all' },
): Promise<PullRequestFilesSnapshot> {
  const snapshot = await loadWholePullRequestFiles(token, ref);
  if (selection.kind === 'all') {
    return { ...snapshot, selection };
  }

  let changedFiles: RestChangedFile[];
  try {
    changedFiles =
      selection.kind === 'commit'
        ? await loadCommitFiles(token, ref, selection.oid)
        : await loadRangeFiles(
            token,
            ref,
            selection.startOid,
            selection.endOid,
          );
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 403) {
      throw new GitHubApiError(
        'Commit-filtered counts require Contents: read on the GitHub token.',
        error.status,
      );
    }
    throw error;
  }

  const viewedByPath = new Map(
    snapshot.files.map((file) => [file.path, file.viewedState]),
  );
  return {
    ...snapshot,
    selection,
    files: changedFiles.map((file) => ({
      path: file.filename,
      additions: file.additions,
      deletions: file.deletions,
      viewedState:
        viewedByPath.get(file.filename) ??
        (file.previous_filename
          ? viewedByPath.get(file.previous_filename)
          : undefined) ??
        'UNVIEWED',
    })),
  };
}

async function loadWholePullRequestFiles(
  token: string,
  ref: PullRequestRef,
): Promise<Omit<PullRequestFilesSnapshot, 'selection'>> {
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

async function loadCommitFiles(
  token: string,
  ref: PullRequestRef,
  oid: string,
): Promise<RestChangedFile[]> {
  const files: RestChangedFile[] = [];
  let page = 1;
  let hasNextPage = false;

  do {
    const { data, headers } = await githubRest<RestCommit>(
      token,
      `${repositoryPath(ref)}/commits/${encodeURIComponent(oid)}` +
        `?per_page=${REST_FILES_PAGE_SIZE}&page=${page}`,
    );
    files.push(...(data.files ?? []));
    hasNextPage = /<[^>]+>;\s*rel="next"/.test(headers.get('link') ?? '');
    page += 1;
  } while (hasNextPage);

  return files;
}

async function loadRangeFiles(
  token: string,
  ref: PullRequestRef,
  startOid: string,
  endOid: string,
): Promise<RestChangedFile[]> {
  const { data: startCommit } = await githubRest<RestCommit>(
    token,
    `${repositoryPath(ref)}/commits/${encodeURIComponent(startOid)}?per_page=1`,
  );
  const parentOid = startCommit.parents[0]?.sha;
  if (!parentOid) {
    throw new GitHubApiError(
      'The first selected commit has no parent, so its range cannot be compared.',
    );
  }

  // GitHub's range picker is inclusive. The compare API excludes its base,
  // so compare from the first selected commit's parent through the range end.
  const { data } = await githubRest<RestComparison>(
    token,
    `${repositoryPath(ref)}/compare/` +
      `${encodeURIComponent(parentOid)}...${encodeURIComponent(endOid)}`,
  );
  const files = data.files ?? [];
  if (files.length >= REST_COMPARISON_FILE_LIMIT) {
    throw new GitHubApiError(
      'This commit range has at least 300 changed files, which exceeds GitHub’s comparison API limit.',
    );
  }
  return files;
}

function repositoryPath(ref: PullRequestRef): string {
  return `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repository)}`;
}

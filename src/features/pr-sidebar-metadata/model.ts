import type {
  PullRequestFile,
  PullRequestFilesSnapshot,
  ViewedState,
} from '../../shared/types';

export interface FolderAggregate {
  additions: number;
  deletions: number;
  viewed: number;
  total: number;
}

export function isViewed(state: ViewedState): boolean {
  return state === 'VIEWED';
}

export function aggregateFolder(
  folderPath: string,
  files: PullRequestFile[],
): FolderAggregate {
  const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
  const descendants = files.filter((file) => file.path.startsWith(prefix));

  return descendants.reduce<FolderAggregate>(
    (aggregate, file) => ({
      additions:
        aggregate.additions +
        (isViewed(file.viewedState) ? 0 : file.additions),
      deletions:
        aggregate.deletions +
        (isViewed(file.viewedState) ? 0 : file.deletions),
      viewed: aggregate.viewed + (isViewed(file.viewedState) ? 1 : 0),
      total: aggregate.total + 1,
    }),
    { additions: 0, deletions: 0, viewed: 0, total: 0 },
  );
}

export function updateFileViewedState(
  snapshot: PullRequestFilesSnapshot,
  path: string,
  viewed: boolean,
): PullRequestFilesSnapshot {
  return {
    ...snapshot,
    files: snapshot.files.map((file) =>
      file.path === path
        ? {
            ...file,
            viewedState: viewed ? 'VIEWED' : 'UNVIEWED',
          }
        : file,
    ),
  };
}

export function parsePullRequestUrl(url: URL) {
  const match = url.pathname.match(
    /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:files|changes)(?:\/|$)/,
  );
  if (!match) {
    return null;
  }

  const [, owner, repository, number] = match;
  if (!owner || !repository || !number) {
    return null;
  }

  return {
    owner: decodeURIComponent(owner),
    repository: decodeURIComponent(repository),
    number: Number(number),
  };
}

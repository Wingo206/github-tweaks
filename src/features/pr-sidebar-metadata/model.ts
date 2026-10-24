import type {
  PullRequestChangeSelection,
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

export interface LineViewProgress {
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

export function aggregateLineViewProgress(
  files: PullRequestFile[],
): LineViewProgress {
  return files.reduce<LineViewProgress>(
    (aggregate, file) => {
      const lines = file.additions + file.deletions;
      return {
        viewed: aggregate.viewed + (isViewed(file.viewedState) ? lines : 0),
        total: aggregate.total + lines,
      };
    },
    { viewed: 0, total: 0 },
  );
}

export function lineViewProgressRatio(
  progress: LineViewProgress | null,
): number | null {
  if (!progress) {
    return null;
  }
  if (progress.total === 0) {
    return 1;
  }
  return progress.viewed / progress.total;
}

export function formatLineViewProgressLabel(
  progress: LineViewProgress | null,
  formatNumber: (value: number) => string = String,
): string {
  if (!progress) {
    return '… / … changes';
  }

  return `${formatNumber(progress.viewed)} / ${formatNumber(progress.total)} changes`;
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

export function applyViewedOverrides(
  snapshot: PullRequestFilesSnapshot,
  overrides: ReadonlyMap<string, boolean>,
): PullRequestFilesSnapshot {
  if (overrides.size === 0) {
    return snapshot;
  }
  return {
    ...snapshot,
    files: snapshot.files.map((file) => {
      const viewed = overrides.get(file.path);
      return viewed === undefined
        ? file
        : { ...file, viewedState: viewed ? 'VIEWED' : 'UNVIEWED' };
    }),
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

export function parseChangeSelection(url: URL): PullRequestChangeSelection {
  const match = url.pathname.match(
    /^\/[^/]+\/[^/]+\/pull\/\d+\/(?:files|changes)(?:\/([^/]+))?\/?$/,
  );
  const value = match?.[1];
  if (!value) {
    return { kind: 'all' };
  }

  const range = value.match(/^([0-9a-f]{7,64})\.\.([0-9a-f]{7,64})$/i);
  if (range?.[1] && range[2]) {
    return {
      kind: 'range',
      startOid: range[1],
      endOid: range[2],
    };
  }

  return /^[0-9a-f]{7,64}$/i.test(value)
    ? { kind: 'commit', oid: value }
    : { kind: 'all' };
}

export function sameChangeSelection(
  left: PullRequestChangeSelection,
  right: PullRequestChangeSelection,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'commit' && right.kind === 'commit') {
    return left.oid === right.oid;
  }
  if (left.kind === 'range' && right.kind === 'range') {
    return (
      left.startOid === right.startOid && left.endOid === right.endOid
    );
  }
  return left.kind === 'all' && right.kind === 'all';
}

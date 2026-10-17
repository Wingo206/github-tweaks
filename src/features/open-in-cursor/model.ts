import type { OpenResult, PullRequestRef, Ref } from '../../shared/types';

export type OpenInCursorRoute =
  | { kind: 'pull'; ref: PullRequestRef }
  | { kind: 'blob'; owner: string; repository: string };

export function parseRoute(url: URL): OpenInCursorRoute | null {
  if (url.hostname !== 'github.com') {
    return null;
  }
  const pull = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
  if (pull?.[1] && pull[2] && pull[3]) {
    return {
      kind: 'pull',
      ref: {
        owner: decodeURIComponent(pull[1]),
        repository: decodeURIComponent(pull[2]),
        number: Number(pull[3]),
      },
    };
  }
  const blob = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/./);
  if (blob?.[1] && blob[2]) {
    return {
      kind: 'blob',
      owner: decodeURIComponent(blob[1]),
      repository: decodeURIComponent(blob[2]),
    };
  }
  return null;
}

export function sameRoute(
  left: OpenInCursorRoute,
  right: OpenInCursorRoute | null | undefined,
): boolean {
  if (!right || left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'pull' && right.kind === 'pull') {
    return (
      left.ref.owner === right.ref.owner &&
      left.ref.repository === right.ref.repository &&
      left.ref.number === right.ref.number
    );
  }
  return (
    left.kind === 'blob' &&
    right.kind === 'blob' &&
    left.owner === right.owner &&
    left.repository === right.repository
  );
}

/** `#L9` or `#L9-L15` → 9; anything else → 1. */
export function parseLineHash(hash: string): number {
  const match = hash.match(/^#L(\d+)(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/);
  const line = match?.[1] ? Number(match[1]) : 1;
  return line >= 1 ? line : 1;
}

/** Ref and path information embedded in GitHub's code view payload. */
export interface EmbeddedBlobInfo {
  refName: string;
  refType: string | null;
  currentOid: string | null;
  path: string;
}

export interface BlobLocation {
  owner: string;
  repository: string;
  ref: Ref | null;
  path: string;
  line: number;
}

/**
 * Resolves `/owner/repo/blob/<ref>/<path>`. A 40-hex first segment is a
 * commit; otherwise the embedded route data decides where the ref ends when
 * it agrees with the URL; otherwise the first segment is taken as a branch.
 */
export function parseBlobLocation(
  url: URL,
  embedded: EmbeddedBlobInfo | null,
): BlobLocation | null {
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  const owner = decodeURIComponent(match[1]);
  const repository = decodeURIComponent(match[2]);
  const rest = match[3]
    .split('/')
    .map((segment) => safeDecode(segment))
    .join('/')
    .replace(/\/+$/, '');
  const line = parseLineHash(url.hash);

  const [first, ...remaining] = rest.split('/');
  if (!first || remaining.length === 0) {
    return null;
  }
  if (/^[0-9a-f]{40}$/i.test(first)) {
    return { owner, repository, ref: { kind: 'commit', sha: first }, path: remaining.join('/'), line };
  }

  if (embedded && rest === `${embedded.refName}/${embedded.path}`) {
    const ref: Ref | null =
      embedded.refType === 'branch'
        ? { kind: 'branch', name: embedded.refName }
        : embedded.currentOid && /^[0-9a-f]{40}$/i.test(embedded.currentOid)
          ? { kind: 'commit', sha: embedded.currentOid }
          : null;
    return { owner, repository, ref, path: embedded.path, line };
  }

  return { owner, repository, ref: { kind: 'branch', name: first }, path: remaining.join('/'), line };
}

export function readEmbeddedBlobInfo(value: unknown): EmbeddedBlobInfo | null {
  const route = (value as { payload?: Record<string, unknown> } | null)?.payload?.[
    'codeViewBlobLayoutRoute'
  ] as { refInfo?: Record<string, unknown>; path?: unknown } | undefined;
  const refInfo = route?.refInfo;
  if (!refInfo || typeof refInfo.name !== 'string' || typeof route.path !== 'string') {
    return null;
  }
  return {
    refName: refInfo.name,
    refType: typeof refInfo.refType === 'string' ? refInfo.refType : null,
    currentOid: typeof refInfo.currentOid === 'string' ? refInfo.currentOid : null,
    path: route.path,
  };
}

/** "Add comment on line R32" → { side: 'right', line: 32 }. */
export function parseMenuLineLabel(
  text: string,
): { side: 'left' | 'right'; line: number } | null {
  const match = text.trim().match(/^Add comment on line ([LR])(\d+)$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { side: match[1] === 'L' ? 'left' : 'right', line: Number(match[2]) };
}

/** "Comment on lines R107 to R108" → 108; "Comment on line L4" → 4. */
export function parseThreadHeadingLine(text: string): number | null {
  const matches = [...text.matchAll(/\b[LR](\d+)\b/g)];
  const last = matches.at(-1)?.[1];
  return last ? Number(last) : null;
}

/** `r123` or `discussion_r123` → `123`. */
export function parseCommentElementId(id: string): string | null {
  return id.match(/^(?:discussion_)?r(\d+)$/)?.[1] ?? null;
}

export function describeFailure(result: Extract<OpenResult, { status: 'failed' }>): string {
  switch (result.reason) {
    case 'not-paired':
      return result.message || 'Pair the Cursor companion in the GitHub Tweaks popup.';
    case 'companion-offline':
      return 'Companion offline. Open a Cursor window.';
    case 'no-clone':
      return 'No local clone of this repository is known.';
    case 'comment-not-found':
      return result.message || 'Couldn’t find this comment’s file and line.';
    case 'open-failed':
      return result.message ? `Couldn’t open: ${result.message}` : 'Cursor couldn’t open the file.';
    case 'timeout':
      return 'Cursor didn’t respond in time.';
  }
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

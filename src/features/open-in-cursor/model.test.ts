import { describe, expect, it } from 'vitest';
import {
  parseBlobLocation,
  parseCommentElementId,
  parseLineHash,
  parseMenuLineLabel,
  parseRoute,
  parseThreadHeadingLine,
  readEmbeddedBlobInfo,
  sameRoute,
} from './model';

const sha = 'b9d2bd8f0fc13e83ddd3fbb042971a4722eaf967';

describe('parseRoute', () => {
  it('matches pull request and blob routes', () => {
    expect(parseRoute(new URL('https://github.com/acme/widgets/pull/42/changes'))).toEqual({
      kind: 'pull',
      ref: { owner: 'acme', repository: 'widgets', number: 42 },
    });
    expect(parseRoute(new URL('https://github.com/acme/widgets/blob/main/a.ts'))).toEqual({
      kind: 'blob',
      owner: 'acme',
      repository: 'widgets',
    });
    expect(parseRoute(new URL('https://github.com/acme/widgets/issues/1'))).toBeNull();
  });

  it('compares routes', () => {
    const pull = parseRoute(new URL('https://github.com/acme/widgets/pull/42'))!;
    expect(sameRoute(pull, parseRoute(new URL('https://github.com/acme/widgets/pull/42/files')))).toBe(true);
    expect(sameRoute(pull, parseRoute(new URL('https://github.com/acme/widgets/pull/43')))).toBe(false);
  });
});

describe('parseLineHash', () => {
  it.each([
    ['#L9', 9],
    ['#L9-L15', 9],
    ['#L9C3-L15C2', 9],
    ['', 1],
    ['#diff-abc', 1],
  ])('%s → %d', (hash, line) => {
    expect(parseLineHash(hash)).toBe(line);
  });
});

describe('parseBlobLocation', () => {
  it('treats a 40-hex first segment as a commit', () => {
    expect(
      parseBlobLocation(new URL(`https://github.com/acme/widgets/blob/${sha}/src/a.ts#L9`), null),
    ).toEqual({
      owner: 'acme',
      repository: 'widgets',
      ref: { kind: 'commit', sha },
      path: 'src/a.ts',
      line: 9,
    });
  });

  it('uses embedded route data for branches with slashes when it matches the URL', () => {
    const url = new URL('https://github.com/acme/widgets/blob/feature/nested/src/a.ts');
    const embedded = { refName: 'feature/nested', refType: 'branch', currentOid: sha, path: 'src/a.ts' };
    expect(parseBlobLocation(url, embedded)).toMatchObject({
      ref: { kind: 'branch', name: 'feature/nested' },
      path: 'src/a.ts',
      line: 1,
    });
  });

  it('maps tags to the current commit', () => {
    const url = new URL('https://github.com/acme/widgets/blob/v1.0/src/a.ts');
    const embedded = { refName: 'v1.0', refType: 'tag', currentOid: sha, path: 'src/a.ts' };
    expect(parseBlobLocation(url, embedded)?.ref).toEqual({ kind: 'commit', sha });
  });

  it('ignores stale embedded data and guesses the first segment', () => {
    const url = new URL('https://github.com/acme/widgets/blob/feature/nested/src/a.ts');
    const stale = { refName: 'main', refType: 'branch', currentOid: sha, path: 'other.ts' };
    expect(parseBlobLocation(url, stale)).toMatchObject({
      ref: { kind: 'branch', name: 'feature' },
      path: 'nested/src/a.ts',
    });
  });

  it('decodes path segments', () => {
    const url = new URL('https://github.com/acme/widgets/blob/main/docs/My%20File.md');
    expect(parseBlobLocation(url, null)?.path).toBe('docs/My File.md');
  });
});

describe('readEmbeddedBlobInfo', () => {
  it('reads codeViewBlobLayoutRoute', () => {
    expect(
      readEmbeddedBlobInfo({
        payload: {
          codeViewBlobLayoutRoute: {
            path: 'README.md',
            refInfo: { name: 'release/1.90', refType: 'branch', currentOid: sha },
          },
        },
      }),
    ).toEqual({ refName: 'release/1.90', refType: 'branch', currentOid: sha, path: 'README.md' });
    expect(readEmbeddedBlobInfo({ payload: {} })).toBeNull();
    expect(readEmbeddedBlobInfo(null)).toBeNull();
  });
});

describe('label parsing', () => {
  it('parses diff menu labels', () => {
    expect(parseMenuLineLabel('Add comment on line R32')).toEqual({ side: 'right', line: 32 });
    expect(parseMenuLineLabel('Add comment on line L7')).toEqual({ side: 'left', line: 7 });
    expect(parseMenuLineLabel('Suggest change on line R32')).toBeNull();
  });

  it('parses thread headings', () => {
    expect(parseThreadHeadingLine('Comment on lines R107 to R108')).toBe(108);
    expect(parseThreadHeadingLine('Comment on line L4')).toBe(4);
    expect(parseThreadHeadingLine('Comment on file')).toBeNull();
  });

  it('parses comment element ids', () => {
    expect(parseCommentElementId('r4300563210')).toBe('4300563210');
    expect(parseCommentElementId('discussion_r42')).toBe('42');
    expect(parseCommentElementId('react-issue-comment-composer')).toBeNull();
  });
});

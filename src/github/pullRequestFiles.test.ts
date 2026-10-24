import { describe, expect, it, vi } from 'vitest';
import { loadPullRequestFiles, setFileViewed } from './pullRequestFiles';

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data }),
  } as Response;
}

function restResponse(data: unknown, link?: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(link ? { link } : {}),
    json: async () => data,
  } as Response;
}

describe('GitHub pull request files API', () => {
  it('paginates through every changed file', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          repository: {
            pullRequest: {
              id: 'PR_1',
              headRefOid: 'head',
              files: {
                nodes: [
                  {
                    path: 'src/a.ts',
                    additions: 2,
                    deletions: 1,
                    viewerViewedState: 'UNVIEWED',
                  },
                ],
                pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          repository: {
            pullRequest: {
              id: 'PR_1',
              headRefOid: 'head',
              files: {
                nodes: [
                  {
                    path: 'src/b.ts',
                    additions: 3,
                    deletions: 0,
                    viewerViewedState: 'VIEWED',
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const snapshot = await loadPullRequestFiles('token', {
      owner: 'acme',
      repository: 'widgets',
      number: 42,
    });

    expect(snapshot.files).toHaveLength(2);
    expect(snapshot.selection).toEqual({ kind: 'all' });
    expect(snapshot.files[1]?.viewedState).toBe('VIEWED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    ) as { variables: { after: string } };
    expect(secondBody.variables.after).toBe('cursor-1');
  });

  it('uses commit-specific counts with PR-wide Viewed state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          repository: {
            pullRequest: {
              id: 'PR_1',
              headRefOid: 'head',
              files: {
                nodes: [
                  {
                    path: 'src/a.ts',
                    additions: 20,
                    deletions: 10,
                    viewerViewedState: 'VIEWED',
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        restResponse({
          parents: [{ sha: 'parent' }],
          files: [
            {
              filename: 'src/a.ts',
              additions: 2,
              deletions: 1,
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const snapshot = await loadPullRequestFiles(
      'token',
      { owner: 'acme', repository: 'widgets', number: 42 },
      { kind: 'commit', oid: 'abcdef1' },
    );

    expect(snapshot.files).toEqual([
      {
        path: 'src/a.ts',
        additions: 2,
        deletions: 1,
        viewedState: 'VIEWED',
      },
    ]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      '/commits/abcdef1?per_page=100&page=1',
    );
  });

  it('compares from the first selected commit parent for an inclusive range', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          repository: {
            pullRequest: {
              id: 'PR_1',
              headRefOid: 'head',
              files: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        restResponse({
          parents: [{ sha: 'parent-of-start' }],
          files: [],
        }),
      )
      .mockResolvedValueOnce(
        restResponse({
          files: [
            {
              filename: 'docs/readme.md',
              additions: 8,
              deletions: 3,
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const snapshot = await loadPullRequestFiles(
      'token',
      { owner: 'acme', repository: 'widgets', number: 42 },
      {
        kind: 'range',
        startOid: 'abcdef1',
        endOid: '1234567',
      },
    );

    expect(snapshot.files[0]).toMatchObject({
      path: 'docs/readme.md',
      additions: 8,
      deletions: 3,
      viewedState: 'UNVIEWED',
    });
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      '/compare/parent-of-start...1234567',
    );
  });

  it('marks and unmarks a file as viewed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ pullRequest: { id: 'PR_1' } }));
    vi.stubGlobal('fetch', fetchMock);

    await setFileViewed('token', 'PR_1', 'src/a.ts', true);
    await setFileViewed('token', 'PR_1', 'src/a.ts', false);

    const bodies = fetchMock.mock.calls.map(
      ([, init]) =>
        JSON.parse(String((init as RequestInit).body)) as {
          query: string;
          variables: Record<string, unknown>;
        },
    );
    expect(bodies[0]?.query).toContain('markFileAsViewed');
    expect(bodies[1]?.query).toContain('unmarkFileAsViewed');
    expect(bodies[0]?.variables).toEqual({ pullRequestId: 'PR_1', path: 'src/a.ts' });
  });
});

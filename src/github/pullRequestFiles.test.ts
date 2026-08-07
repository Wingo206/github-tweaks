import { describe, expect, it, vi } from 'vitest';
import {
  loadPullRequestFiles,
  setFileViewed,
} from './pullRequestFiles';

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data }),
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
    expect(snapshot.files[1]?.viewedState).toBe('VIEWED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    ) as { variables: { after: string } };
    expect(secondBody.variables.after).toBe('cursor-1');
  });

  it('uses the matching viewed-state mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        markFileAsViewed: { pullRequest: { id: 'PR_1' } },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await setFileViewed('token', 'PR_1', 'src/a.ts', true);

    const requestBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as { query: string; variables: Record<string, string> };
    expect(requestBody.query).toContain('markFileAsViewed');
    expect(requestBody.variables).toEqual({
      pullRequestId: 'PR_1',
      path: 'src/a.ts',
    });
  });
});

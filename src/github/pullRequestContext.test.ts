import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPullRequestContextCache, loadPullRequestContext } from './pullRequestContext';

vi.mock('./graphql', async () => {
  const actual = await vi.importActual<typeof import('./graphql')>('./graphql');
  return { ...actual, graphql: vi.fn() };
});

import { graphql } from './graphql';

const graphqlMock = vi.mocked(graphql);
const ref = { owner: 'acme', repository: 'widgets', number: 42 };

function page(
  threads: Array<{ path: string; line: number | null; originalLine: number | null; ids: number[] }>,
  endCursor: string | null,
) {
  return {
    repository: {
      pullRequest: {
        headRefName: 'feature/x',
        reviewThreads: {
          pageInfo: { hasNextPage: endCursor !== null, endCursor },
          nodes: threads.map(({ ids, ...thread }) => ({
            ...thread,
            comments: { nodes: ids.map((databaseId) => ({ databaseId })) },
          })),
        },
      },
    },
  };
}

afterEach(() => {
  graphqlMock.mockReset();
  clearPullRequestContextCache();
});

describe('loadPullRequestContext', () => {
  it('paginates threads and indexes every comment id', async () => {
    graphqlMock
      .mockResolvedValueOnce(page([{ path: 'a.ts', line: 3, originalLine: 2, ids: [1, 2] }], 'c1'))
      .mockResolvedValueOnce(page([{ path: 'b.ts', line: null, originalLine: 9, ids: [3] }], null));

    const context = await loadPullRequestContext('token', ref);
    expect(context.headRefName).toBe('feature/x');
    expect(context.threadsByCommentId.get('2')).toEqual({ path: 'a.ts', line: 3, originalLine: 2 });
    expect(context.threadsByCommentId.get('3')).toEqual({ path: 'b.ts', line: null, originalLine: 9 });
    expect(graphqlMock.mock.calls[1]?.[2]).toMatchObject({ cursor: 'c1' });
  });

  it('caches per pull request for 60 seconds', async () => {
    graphqlMock.mockResolvedValue(page([], null));
    let now = 0;
    await loadPullRequestContext('token', ref, () => now);
    now = 59_000;
    await loadPullRequestContext('token', ref, () => now);
    expect(graphqlMock).toHaveBeenCalledTimes(1);
    now = 61_000;
    await loadPullRequestContext('token', ref, () => now);
    expect(graphqlMock).toHaveBeenCalledTimes(2);
  });

  it('rejects missing pull requests', async () => {
    graphqlMock.mockResolvedValueOnce({ repository: { pullRequest: null } });
    await expect(loadPullRequestContext('token', ref)).rejects.toThrow('Pull request not found.');
  });
});

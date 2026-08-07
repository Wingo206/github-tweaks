import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubApiError } from './graphql';
import {
  handbackAssignee,
  loadHandbackContext,
} from './pullRequestAssignees';

const ref = { owner: 'acme', repository: 'widgets', number: 42 };

vi.mock('./graphql', async () => {
  const actual = await vi.importActual<typeof import('./graphql')>('./graphql');
  return {
    ...actual,
    graphql: vi.fn(),
  };
});

import { graphql } from './graphql';

const graphqlMock = vi.mocked(graphql);

afterEach(() => {
  graphqlMock.mockReset();
});

describe('pullRequestAssignees', () => {
  it('loads handback context for a user author', async () => {
    graphqlMock.mockResolvedValueOnce({
      viewer: { login: 'reviewer', id: 'USER_reviewer' },
      repository: {
        pullRequest: {
          id: 'PR_1',
          author: {
            __typename: 'User',
            login: 'author',
            id: 'USER_author',
          },
          assignees: {
            nodes: [
              { login: 'reviewer', id: 'USER_reviewer' },
              { login: 'teammate', id: 'USER_teammate' },
            ],
          },
        },
      },
    });

    await expect(loadHandbackContext('token', ref)).resolves.toMatchObject({
      viewerLogin: 'reviewer',
      authorLogin: 'author',
      assignableId: 'PR_1',
      assigneeLogins: ['reviewer', 'teammate'],
    });
  });

  it('removes the viewer and adds the author when needed', async () => {
    graphqlMock
      .mockResolvedValueOnce({
        viewer: { login: 'reviewer', id: 'USER_reviewer' },
        repository: {
          pullRequest: {
            id: 'PR_1',
            author: {
              __typename: 'User',
              login: 'author',
              id: 'USER_author',
            },
            assignees: {
              nodes: [{ login: 'reviewer', id: 'USER_reviewer' }],
            },
          },
        },
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        viewer: { login: 'reviewer', id: 'USER_reviewer' },
        repository: {
          pullRequest: {
            id: 'PR_1',
            author: {
              __typename: 'User',
              login: 'author',
              id: 'USER_author',
            },
            assignees: {
              nodes: [{ login: 'author', id: 'USER_author' }],
            },
          },
        },
      });

    await handbackAssignee('token', ref);

    expect(graphqlMock).toHaveBeenCalledTimes(4);
    expect(graphqlMock.mock.calls[1]?.[1]).toContain(
      'removeAssigneesFromAssignable',
    );
    expect(graphqlMock.mock.calls[1]?.[2]).toEqual({
      assignableId: 'PR_1',
      assigneeIds: ['USER_reviewer'],
    });
    expect(graphqlMock.mock.calls[2]?.[1]).toContain(
      'addAssigneesToAssignable',
    );
    expect(graphqlMock.mock.calls[2]?.[2]).toEqual({
      assignableId: 'PR_1',
      assigneeIds: ['USER_author'],
    });
  });

  it('skips adding the author when already assigned', async () => {
    graphqlMock
      .mockResolvedValueOnce({
        viewer: { login: 'reviewer', id: 'USER_reviewer' },
        repository: {
          pullRequest: {
            id: 'PR_1',
            author: {
              __typename: 'User',
              login: 'author',
              id: 'USER_author',
            },
            assignees: {
              nodes: [
                { login: 'reviewer', id: 'USER_reviewer' },
                { login: 'author', id: 'USER_author' },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        viewer: { login: 'reviewer', id: 'USER_reviewer' },
        repository: {
          pullRequest: {
            id: 'PR_1',
            author: {
              __typename: 'User',
              login: 'author',
              id: 'USER_author',
            },
            assignees: {
              nodes: [{ login: 'author', id: 'USER_author' }],
            },
          },
        },
      });

    await handbackAssignee('token', ref);

    expect(graphqlMock).toHaveBeenCalledTimes(3);
    expect(
      graphqlMock.mock.calls.some(([ , query ]) =>
        String(query).includes('addAssigneesToAssignable'),
      ),
    ).toBe(false);
  });

  it('rejects when the viewer is not assigned', async () => {
    graphqlMock.mockResolvedValueOnce({
      viewer: { login: 'reviewer', id: 'USER_reviewer' },
      repository: {
        pullRequest: {
          id: 'PR_1',
          author: {
            __typename: 'User',
            login: 'author',
            id: 'USER_author',
          },
          assignees: {
            nodes: [{ login: 'author', id: 'USER_author' }],
          },
        },
      },
    });

    await expect(handbackAssignee('token', ref)).rejects.toBeInstanceOf(
      GitHubApiError,
    );
  });
});

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

  it('swaps the viewer for the author in one change, keeping other assignees', async () => {
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
                { login: 'teammate', id: 'USER_teammate' },
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
    expect(graphqlMock.mock.calls[1]?.[1]).toContain('updatePullRequest');
    expect(graphqlMock.mock.calls[1]?.[2]).toEqual({
      pullRequestId: 'PR_1',
      assigneeIds: ['USER_author', 'USER_teammate'],
    });
  });

  it('keeps the author once when they are already assigned', async () => {
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
    expect(graphqlMock.mock.calls[1]?.[2]).toEqual({
      pullRequestId: 'PR_1',
      assigneeIds: ['USER_author'],
    });
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

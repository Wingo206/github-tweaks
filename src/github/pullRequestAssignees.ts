import type { HandbackContext, PullRequestRef } from '../shared/types';
import { GitHubApiError, graphql } from './graphql';

export type { HandbackContext };

const HANDBACK_CONTEXT_QUERY = `
  query HandbackContext(
    $owner: String!
    $repository: String!
    $number: Int!
  ) {
    viewer {
      login
      id
    }
    repository(owner: $owner, name: $repository) {
      pullRequest(number: $number) {
        id
        author {
          __typename
          login
          ... on User {
            id
          }
        }
        assignees(first: 10) {
          nodes {
            login
            id
          }
        }
      }
    }
  }
`;

/**
 * Sets the whole assignee list in one change. GitHub's Overview sidebar
 * refetches once per burst of live updates, so a separate remove and add
 * leaves it showing only the removal until the page is reloaded.
 */
const SET_ASSIGNEES_MUTATION = `
  mutation SetAssignees($pullRequestId: ID!, $assigneeIds: [ID!]!) {
    updatePullRequest(input: {
      pullRequestId: $pullRequestId
      assigneeIds: $assigneeIds
    }) {
      pullRequest {
        id
      }
    }
  }
`;

interface HandbackContextData {
  viewer: {
    login: string;
    id: string;
  };
  repository: {
    pullRequest: {
      id: string;
      author: {
        __typename: string;
        login: string;
        id?: string;
      } | null;
      assignees: {
        nodes: Array<{
          login: string;
          id: string;
        }>;
      };
    } | null;
  } | null;
}

export async function loadHandbackContext(
  token: string,
  ref: PullRequestRef,
): Promise<HandbackContext> {
  const data = await graphql<HandbackContextData>(
    token,
    HANDBACK_CONTEXT_QUERY,
    {
      owner: ref.owner,
      repository: ref.repository,
      number: ref.number,
    },
  );

  const pullRequest = data.repository?.pullRequest;
  if (!pullRequest) {
    throw new GitHubApiError('Pull request not found.');
  }

  const author = pullRequest.author;
  if (!author?.login || author.__typename !== 'User' || !author.id) {
    throw new GitHubApiError(
      'Pull request author is not an assignable user.',
    );
  }

  const assigneeIdsByLogin: Record<string, string> = {};
  const assigneeLogins: string[] = [];
  for (const assignee of pullRequest.assignees.nodes) {
    const login = assignee.login.toLowerCase();
    assigneeLogins.push(assignee.login);
    assigneeIdsByLogin[login] = assignee.id;
  }

  return {
    viewerLogin: data.viewer.login,
    viewerId: data.viewer.id,
    authorLogin: author.login,
    authorId: author.id,
    assignableId: pullRequest.id,
    assigneeLogins,
    assigneeIdsByLogin,
  };
}

export async function handbackAssignee(
  token: string,
  ref: PullRequestRef,
): Promise<HandbackContext> {
  const context = await loadHandbackContext(token, ref);
  const viewerKey = context.viewerLogin.toLowerCase();
  const authorKey = context.authorLogin.toLowerCase();

  if (viewerKey === authorKey) {
    throw new GitHubApiError('You are the pull request author.');
  }

  const viewerAssigneeId = context.assigneeIdsByLogin[viewerKey];
  if (!viewerAssigneeId) {
    throw new GitHubApiError('You are not assigned to this pull request.');
  }

  const others = Object.entries(context.assigneeIdsByLogin)
    .filter(([login]) => login !== viewerKey && login !== authorKey)
    .map(([, id]) => id);
  await graphql(token, SET_ASSIGNEES_MUTATION, {
    pullRequestId: context.assignableId,
    assigneeIds: [context.authorId, ...others],
  });

  return loadHandbackContext(token, ref);
}

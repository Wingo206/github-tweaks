const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

interface GraphQLErrorItem {
  message: string;
  type?: string;
}

interface GraphQLPayload<T> {
  data?: T;
  errors?: GraphQLErrorItem[];
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ query, variables }),
  });

  let payload: GraphQLPayload<T>;
  try {
    payload = (await response.json()) as GraphQLPayload<T>;
  } catch {
    throw new GitHubApiError(
      `GitHub returned an unreadable response (${response.status}).`,
      response.status,
    );
  }

  if (!response.ok || payload.errors?.length) {
    const details = payload.errors?.map((error) => error.message).join('; ');
    throw new GitHubApiError(
      details || `GitHub request failed (${response.status}).`,
      response.status,
    );
  }

  if (!payload.data) {
    throw new GitHubApiError('GitHub returned no data.');
  }

  return payload.data;
}

export async function validateToken(token: string): Promise<string> {
  const data = await graphql<{ viewer: { login: string } }>(
    token,
    'query ValidateToken { viewer { login } }',
  );
  return data.viewer.login;
}

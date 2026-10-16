import { GitHubApiError } from './graphql';

const REST_ENDPOINT = 'https://api.github.com';

interface GitHubRestError {
  message?: string;
}

export interface GitHubRestResponse<T> {
  data: T;
  headers: Headers;
}

export async function githubRest<T>(
  token: string,
  path: string,
): Promise<GitHubRestResponse<T>> {
  const response = await fetch(`${REST_ENDPOINT}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  let payload: T | GitHubRestError;
  try {
    payload = (await response.json()) as T | GitHubRestError;
  } catch {
    throw new GitHubApiError(
      `GitHub returned an unreadable response (${response.status}).`,
      response.status,
    );
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : `GitHub request failed (${response.status}).`;
    throw new GitHubApiError(message, response.status);
  }

  return { data: payload as T, headers: response.headers };
}

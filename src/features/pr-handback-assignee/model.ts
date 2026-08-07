import type { PullRequestRef } from '../../shared/types';

export interface HandbackVisibilityInput {
  viewerLogin: string | null;
  authorLogin: string | null;
  assigneeLogins: string[];
}

export function parsePullRequestUrl(url: URL): PullRequestRef | null {
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
  if (!match) {
    return null;
  }

  const [, owner, repository, number] = match;
  if (!owner || !repository || !number) {
    return null;
  }

  return {
    owner: decodeURIComponent(owner),
    repository: decodeURIComponent(repository),
    number: Number(number),
  };
}

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

export function shouldShowHandbackButton({
  viewerLogin,
  authorLogin,
  assigneeLogins,
}: HandbackVisibilityInput): boolean {
  if (!viewerLogin || !authorLogin) {
    return false;
  }

  const viewer = normalizeLogin(viewerLogin);
  const author = normalizeLogin(authorLogin);
  if (!viewer || !author || viewer === author) {
    return false;
  }

  return assigneeLogins.some((login) => normalizeLogin(login) === viewer);
}

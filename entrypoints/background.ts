import {
  cachePullRequest,
  getCachedPullRequest,
  getToken,
  removeToken,
  saveToken,
} from '../src/github/storage';
import { validateToken } from '../src/github/graphql';
import {
  handbackAssignee,
  loadHandbackContext,
} from '../src/github/pullRequestAssignees';
import {
  loadPullRequestFiles,
  setFileViewed,
} from '../src/github/pullRequestFiles';
import type {
  BackgroundRequest,
  BackgroundResponse,
  PullRequestFilesSnapshot,
} from '../src/shared/types';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (
      request: BackgroundRequest,
      _sender,
      sendResponse: (response: BackgroundResponse) => void,
    ) => {
      void handleRequest(request)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'An unexpected extension error occurred.',
          }),
        );

      return true;
    },
  );
});

async function handleRequest(request: BackgroundRequest): Promise<unknown> {
  switch (request.type) {
    case 'auth:get': {
      const token = await getToken();
      return { configured: token !== null };
    }
    case 'auth:save': {
      const token = request.token.trim();
      if (!token) {
        throw new Error('Enter a GitHub personal access token.');
      }

      const login = await validateToken(token);
      await saveToken(token);
      return { login };
    }
    case 'auth:remove':
      await removeToken();
      return undefined;
    case 'ui:open-popup':
      await browser.action.openPopup();
      return undefined;
    case 'cache:get':
      return getCachedPullRequest(request.ref);
    case 'pull:load': {
      const token = await requireToken();
      const snapshot = await loadPullRequestFiles(token, request.ref);
      await cachePullRequest(snapshot);
      return snapshot;
    }
    case 'pull:set-viewed': {
      const token = await requireToken();
      await setFileViewed(
        token,
        request.pullRequestId,
        request.path,
        request.viewed,
      );
      await updateCachedViewedState(request);
      return undefined;
    }
    case 'pull:handback-context': {
      const token = await requireToken();
      return loadHandbackContext(token, request.ref);
    }
    case 'pull:handback-assignee': {
      const token = await requireToken();
      return handbackAssignee(token, request.ref);
    }
  }
}

async function requireToken(): Promise<string> {
  const token = await getToken();
  if (!token) {
    throw new Error(
      'GitHub token not configured. Open the GitHub Tweaks toolbar popup.',
    );
  }
  return token;
}

async function updateCachedViewedState(
  request: Extract<BackgroundRequest, { type: 'pull:set-viewed' }>,
): Promise<void> {
  const cached = await getCachedPullRequest(request.ref);
  if (!cached || cached.pullRequestId !== request.pullRequestId) {
    return;
  }

  const snapshot: PullRequestFilesSnapshot = {
    ...cached,
    files: cached.files.map((file) =>
      file.path === request.path
        ? {
            ...file,
            viewedState: request.viewed ? 'VIEWED' : 'UNVIEWED',
          }
        : file,
    ),
    savedAt: Date.now(),
  };
  await cachePullRequest(snapshot);
}

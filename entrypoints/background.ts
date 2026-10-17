import {
  cachePullRequest,
  getCachedPullRequest,
  getPeoplePins,
  getToken,
  removeToken,
  savePeoplePins,
  saveToken,
} from '../src/github/storage';
import { validateToken } from '../src/github/graphql';
import {
  handbackAssignee,
  loadHandbackContext,
} from '../src/github/pullRequestAssignees';
import { loadPullRequestFiles } from '../src/github/pullRequestFiles';
import { loadPullRequestContext } from '../src/github/pullRequestContext';
import {
  getCompanionSettingsView,
  getCompanionStatus,
  openInCursor,
  saveCompanionSettings,
} from '../src/companion/client';
import { resolveOpenTarget } from '../src/companion/resolveTarget';
import type { BackgroundRequest, BackgroundResponse } from '../src/shared/types';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (
      request: BackgroundRequest,
      sender: Browser.runtime.MessageSender,
      sendResponse: (response: BackgroundResponse) => void,
    ) => {
      void handleRequest(request, sender)
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

async function handleRequest(
  request: BackgroundRequest,
  sender: Browser.runtime.MessageSender,
): Promise<unknown> {
  switch (request.type) {
    case 'open-in-cursor': {
      const resolution = await resolveOpenTarget(request.target, async (ref) => {
        const token = await getToken();
        if (!token) {
          return null;
        }
        try {
          return await loadPullRequestContext(token, ref);
        } catch (error) {
          console.warn('[ght-open-in-cursor] PR context failed', error);
          return null;
        }
      });
      if (!resolution.ok) {
        return resolution.result;
      }
      const tabId = sender.tab?.id;
      return openInCursor(resolution.request, {
        openUrl: async (url) => {
          if (tabId !== undefined) {
            await browser.tabs.update(tabId, { url });
          }
        },
      });
    }
    case 'companion-status':
      return getCompanionStatus();
    case 'companion:get-settings':
      return getCompanionSettingsView();
    case 'companion:save-settings': {
      const update: { port?: number; token?: string } = {};
      if (request.port !== undefined) {
        update.port = request.port;
      }
      if (request.token !== undefined) {
        update.token = request.token;
      }
      return saveCompanionSettings(update);
    }
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
      return getCachedPullRequest(request.ref, request.selection);
    case 'pull:load': {
      const token = await requireToken();
      const snapshot = await loadPullRequestFiles(
        token,
        request.ref,
        request.selection,
      );
      await cachePullRequest(snapshot);
      return snapshot;
    }
    case 'pull:handback-context': {
      const token = await requireToken();
      return loadHandbackContext(token, request.ref);
    }
    case 'pull:handback-assignee': {
      const token = await requireToken();
      return handbackAssignee(token, request.ref);
    }
    case 'pins:get':
      return getPeoplePins(request.owner, request.repository);
    case 'pins:save':
      return savePeoplePins(
        request.owner,
        request.repository,
        request.people,
      );
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


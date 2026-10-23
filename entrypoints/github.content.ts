import { getFeatureFlags } from '../src/features/flags';
import { FeatureRunner } from '../src/features/runner';
import { MermaidFullscreenFeature } from '../src/features/mermaid-fullscreen';
import {
  clearMermaidLogs,
  collectMermaidLogs,
  type MermaidLogExport,
} from '../src/features/mermaid-fullscreen/diagnostics';
import { OpenInCursorFeature } from '../src/features/open-in-cursor';
import { PrCheckoutBranchFeature } from '../src/features/pr-checkout-branch';
import { PrFileTreeViewportFeature } from '../src/features/pr-file-tree-viewport';
import { PrHandbackAssigneeFeature } from '../src/features/pr-handback-assignee';
import { PrPeoplePinsFeature } from '../src/features/pr-people-pins';
import { PrSidebarMetadataFeature } from '../src/features/pr-sidebar-metadata';
import { PrTabFaviconFeature } from '../src/features/pr-tab-favicon';
import { FEATURES, type FeatureId } from '../src/features/registry';
import type { Feature } from '../src/features/types';
import type {
  ContentRequest,
  PageStatus,
} from '../src/shared/types';

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  async main() {
    const flags = await getFeatureFlags();
    const sidebarFeature = new PrSidebarMetadataFeature();
    const features: Record<FeatureId, Feature> = {
      'pr-sidebar-metadata': sidebarFeature,
      'pr-file-tree-viewport': new PrFileTreeViewportFeature(),
      'mermaid-fullscreen': new MermaidFullscreenFeature(),
      'pr-handback-assignee': new PrHandbackAssigneeFeature(),
      'pr-people-pins': new PrPeoplePinsFeature(),
      'open-in-cursor': new OpenInCursorFeature(),
      'pr-checkout-branch': new PrCheckoutBranchFeature(),
      'pr-tab-favicon': new PrTabFaviconFeature(),
    };
    const runner = new FeatureRunner(
      FEATURES.filter(({ id }) => flags[id]).map(({ id }) => features[id]),
    );
    let lastUrl = window.location.href;
    let syncQueued = false;

    const sync = (): void => {
      if (syncQueued) {
        return;
      }
      syncQueued = true;
      queueMicrotask(() => {
        syncQueued = false;
        void runner.sync();
      });
    };

    void runner.sync();

    const navigationObserver = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        sync();
      }
    });
    navigationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    for (const eventName of ['popstate', 'turbo:load', 'pjax:end']) {
      window.addEventListener(eventName, sync);
    }

    browser.runtime.onMessage.addListener(
      (
        request: ContentRequest,
        _sender,
        sendResponse: (response: PageStatus | MermaidLogExport) => void,
      ) => {
        if (request.type === 'mermaid:get-logs') {
          sendResponse(collectMermaidLogs());
          return;
        }
        if (request.type === 'mermaid:clear-logs') {
          clearMermaidLogs();
          sendResponse(collectMermaidLogs());
          return;
        }
        if (!flags['pr-sidebar-metadata']) {
          sendResponse({ state: 'disabled' });
          return;
        }
        if (request.type === 'page:get-status') {
          sendResponse(sidebarFeature.getStatus());
          return;
        }
        if (request.type === 'page:retry') {
          void sidebarFeature.retry().then(() => {
            sendResponse(sidebarFeature.getStatus());
          });
          return true;
        }
      },
    );
  },
});

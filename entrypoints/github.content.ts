import { FeatureRunner } from '../src/features/runner';
import { PrSidebarMetadataFeature } from '../src/features/pr-sidebar-metadata';
import type {
  ContentRequest,
  PageStatus,
} from '../src/shared/types';
import '../src/styles/github.css';

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  main() {
    const sidebarFeature = new PrSidebarMetadataFeature();
    const runner = new FeatureRunner([sidebarFeature]);
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
        sendResponse: (status: PageStatus) => void,
      ) => {
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

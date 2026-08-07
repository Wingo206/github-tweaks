import { FeatureRunner } from '../src/features/runner';
import { MermaidFullscreenFeature } from '../src/features/mermaid-fullscreen';
import { PrSidebarMetadataFeature } from '../src/features/pr-sidebar-metadata';
import type {
  ContentRequest,
  PageStatus,
} from '../src/shared/types';

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  main() {
    const sidebarFeature = new PrSidebarMetadataFeature();
    const mermaidFeature = new MermaidFullscreenFeature();
    const runner = new FeatureRunner([sidebarFeature, mermaidFeature]);
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

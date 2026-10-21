import {
  isSvgRequest,
  postRenderedSvgResponse,
} from '../src/features/mermaid-fullscreen/bridge';
import { describeMissingDiagram } from '../src/features/mermaid-fullscreen/errors';
import { getFeatureFlags } from '../src/features/flags';

const GITHUB_ORIGIN = 'https://github.com';
const SVG_SELECTOR = 'svg#diagram';

function waitForDiagramSvg(timeoutMs = 1500): Promise<SVGSVGElement | null> {
  const existing = document.querySelector<SVGSVGElement>(SVG_SELECTOR);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    const finish = (svg: SVGSVGElement | null): void => {
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(svg);
    };
    const observer = new MutationObserver(() => {
      const svg = document.querySelector<SVGSVGElement>(SVG_SELECTOR);
      if (svg) {
        finish(svg);
      }
    });
    const timeout = window.setTimeout(() => finish(null), timeoutMs);

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}

export default defineContentScript({
  matches: ['https://viewscreen.githubusercontent.com/markdown/mermaid*'],
  allFrames: true,
  runAt: 'document_idle',
  async main() {
    const flags = await getFeatureFlags();
    if (!flags['mermaid-fullscreen']) {
      return;
    }

    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (
        event.origin !== GITHUB_ORIGIN ||
        event.source !== window.parent ||
        !isSvgRequest(event.data)
      ) {
        return;
      }

      const { requestId } = event.data;
      const startedAt = performance.now();
      void waitForDiagramSvg().then((svg) => {
        console.debug('[ght-mermaid] viewscreen svg request', {
          found: svg !== null,
          waitedMs: Math.round(performance.now() - startedAt),
          svgLength: svg?.outerHTML.length ?? 0,
        });
        if (!svg) {
          const detail = describeMissingDiagram(document);
          console.error(
            '[ght-mermaid] diagram SVG missing in viewscreen',
            detail,
          );
          postRenderedSvgResponse(
            window.parent,
            GITHUB_ORIGIN,
            requestId,
            null,
            detail,
          );
          return;
        }
        postRenderedSvgResponse(
          window.parent,
          GITHUB_ORIGIN,
          requestId,
          svg.outerHTML,
        );
      });
    });
  },
});

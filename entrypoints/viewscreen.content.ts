import {
  isSvgRequest,
  postRenderedSvgResponse,
} from '../src/features/mermaid-fullscreen/bridge';

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
  main() {
    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (
        event.origin !== GITHUB_ORIGIN ||
        event.source !== window.parent ||
        !isSvgRequest(event.data)
      ) {
        return;
      }

      const { requestId } = event.data;
      void waitForDiagramSvg().then((svg) => {
        postRenderedSvgResponse(
          window.parent,
          GITHUB_ORIGIN,
          requestId,
          svg?.outerHTML ?? null,
        );
      });
    });
  },
});

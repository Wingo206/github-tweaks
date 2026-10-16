import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SVG_REQUEST_TYPE,
  SVG_RESPONSE_TYPE,
  VIEWSCREEN_ORIGIN,
  findInlineMermaidFrame,
  isSvgRequest,
  isSvgResponse,
  requestRenderedSvg,
} from './bridge';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Mermaid SVG bridge', () => {
  it('finds only the inline Mermaid rendering frame', () => {
    document.body.innerHTML = `
      <section data-type="mermaid">
        <div class="js-render-enrichment-target">
          <details><iframe class="render-viewer" data-dialog></iframe></details>
          <div class="js-render-target" data-type="mermaid">
            <iframe class="render-viewer" data-inline></iframe>
          </div>
        </div>
      </section>
    `;

    const embed = document.querySelector<HTMLElement>('section')!;
    expect(findInlineMermaidFrame(embed)?.hasAttribute('data-inline')).toBe(true);
  });

  it('validates request and response message shapes', () => {
    expect(
      isSvgRequest({ type: SVG_REQUEST_TYPE, requestId: 'request-1' }),
    ).toBe(true);
    expect(
      isSvgResponse({
        type: SVG_RESPONSE_TYPE,
        requestId: 'request-1',
        svg: '<svg></svg>',
      }),
    ).toBe(true);
    expect(
      isSvgResponse({
        type: SVG_RESPONSE_TYPE,
        requestId: 'request-1',
        svg: null,
        error: 'diagram missing',
      }),
    ).toBe(true);
    expect(
      isSvgResponse({
        type: SVG_RESPONSE_TYPE,
        requestId: 'request-1',
        svg: 42,
      }),
    ).toBe(false);
  });

  it('reports a missing inline frame', async () => {
    document.body.innerHTML = '<section data-type="mermaid"></section>';
    const embed = document.querySelector<HTMLElement>('section')!;

    await expect(requestRenderedSvg(embed)).resolves.toEqual({
      ok: false,
      reason: 'missing-frame',
      detail: 'Inline Mermaid frame was not found.',
    });
  });

  it('returns the viewscreen error when the frame sends an empty SVG', async () => {
    document.body.innerHTML = `
      <section data-type="mermaid">
        <div class="js-render-enrichment-target">
          <div class="js-render-target" data-type="mermaid">
            <iframe class="render-viewer"></iframe>
          </div>
        </div>
      </section>
    `;
    const embed = document.querySelector<HTMLElement>('section')!;
    const frameWindow = findInlineMermaidFrame(embed)?.contentWindow;
    if (!frameWindow) {
      throw new Error('Expected the inline frame to have a content window.');
    }

    vi.spyOn(frameWindow, 'postMessage').mockImplementation((data) => {
      const request = data as { requestId?: string };
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: VIEWSCREEN_ORIGIN,
          source: frameWindow,
          data: {
            type: SVG_RESPONSE_TYPE,
            requestId: request.requestId,
            svg: null,
            error: 'diagram missing',
          },
        }),
      );
    });

    await expect(requestRenderedSvg(embed)).resolves.toEqual({
      ok: false,
      reason: 'empty-svg',
      detail: 'diagram missing',
    });
  });
});

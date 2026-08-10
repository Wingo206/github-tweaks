import { afterEach, describe, expect, it } from 'vitest';
import {
  SVG_REQUEST_TYPE,
  SVG_RESPONSE_TYPE,
  findInlineMermaidFrame,
  isSvgRequest,
  isSvgResponse,
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
        svg: 42,
      }),
    ).toBe(false);
  });
});

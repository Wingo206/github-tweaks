export const VIEWSCREEN_ORIGIN = 'https://viewscreen.githubusercontent.com';
export const SVG_REQUEST_TYPE = 'ght:mermaid-svg-request';
export const SVG_RESPONSE_TYPE = 'ght:mermaid-svg-response';

interface SvgRequest {
  type: typeof SVG_REQUEST_TYPE;
  requestId: string;
}

interface SvgResponse {
  type: typeof SVG_RESPONSE_TYPE;
  requestId: string;
  svg: string | null;
  error?: string;
}

export type RenderedSvgResult =
  | { ok: true; svg: string }
  | {
      ok: false;
      reason: 'missing-frame' | 'request-timeout' | 'empty-svg';
      detail: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isSvgRequest(value: unknown): value is SvgRequest {
  return (
    isRecord(value) &&
    value.type === SVG_REQUEST_TYPE &&
    typeof value.requestId === 'string'
  );
}

export function isSvgResponse(value: unknown): value is SvgResponse {
  return (
    isRecord(value) &&
    value.type === SVG_RESPONSE_TYPE &&
    typeof value.requestId === 'string' &&
    (typeof value.svg === 'string' || value.svg === null) &&
    (value.error === undefined || typeof value.error === 'string')
  );
}

export function findInlineMermaidFrame(
  embed: HTMLElement,
): HTMLIFrameElement | null {
  return embed.querySelector<HTMLIFrameElement>(
    ':scope > .js-render-enrichment-target > .js-render-target[data-type="mermaid"] iframe.render-viewer',
  );
}

export function requestRenderedSvg(
  embed: HTMLElement,
  timeoutMs = 2500,
): Promise<RenderedSvgResult> {
  const frame = findInlineMermaidFrame(embed);
  const frameWindow = frame?.contentWindow;
  if (!frame || !frameWindow) {
    return Promise.resolve({
      ok: false,
      reason: 'missing-frame',
      detail: frame
        ? 'Inline Mermaid frame has no content window.'
        : 'Inline Mermaid frame was not found.',
    });
  }

  const requestId = crypto.randomUUID();

  return new Promise((resolve) => {
    const finish = (result: RenderedSvgResult): void => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (
        event.origin !== VIEWSCREEN_ORIGIN ||
        event.source !== frameWindow ||
        !isSvgResponse(event.data) ||
        event.data.requestId !== requestId
      ) {
        return;
      }
      if (event.data.svg) {
        finish({ ok: true, svg: event.data.svg });
        return;
      }
      finish({
        ok: false,
        reason: 'empty-svg',
        detail: event.data.error || 'Viewscreen returned no SVG.',
      });
    };
    const timeout = window.setTimeout(
      () =>
        finish({
          ok: false,
          reason: 'request-timeout',
          detail: `No SVG response within ${timeoutMs}ms.`,
        }),
      timeoutMs,
    );

    window.addEventListener('message', onMessage);
    frameWindow.postMessage(
      { type: SVG_REQUEST_TYPE, requestId } satisfies SvgRequest,
      VIEWSCREEN_ORIGIN,
    );
  });
}

export function postRenderedSvgResponse(
  target: Window,
  targetOrigin: string,
  requestId: string,
  svg: string | null,
  error?: string,
): void {
  const payload: SvgResponse = { type: SVG_RESPONSE_TYPE, requestId, svg };
  if (error) {
    payload.error = error;
  }
  target.postMessage(payload, targetOrigin);
}

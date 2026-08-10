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
}

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
    (typeof value.svg === 'string' || value.svg === null)
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
): Promise<string | null> {
  const frame = findInlineMermaidFrame(embed);
  const frameWindow = frame?.contentWindow;
  if (!frame || !frameWindow) {
    return Promise.resolve(null);
  }

  const requestId = crypto.randomUUID();

  return new Promise((resolve) => {
    const finish = (svg: string | null): void => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve(svg);
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
      finish(event.data.svg);
    };
    const timeout = window.setTimeout(() => finish(null), timeoutMs);

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
): void {
  target.postMessage(
    { type: SVG_RESPONSE_TYPE, requestId, svg } satisfies SvgResponse,
    targetOrigin,
  );
}

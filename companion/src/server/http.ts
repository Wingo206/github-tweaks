import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  parseBranchStatusRequest,
  parseCheckoutRequest,
  parseFocusRequest,
  parseOpenRequest,
  type BranchStatusRequest,
  type BranchStatusResponse,
  type CheckoutRequest,
  type CheckoutResponse,
  type FocusRequest,
  type FocusResponse,
  type HealthResponse,
  type OpenRequest,
  type OpenResponse,
} from '../protocol';

const MAX_BODY_BYTES = 64 * 1024;

export interface HttpDependencies {
  token: string;
  version: string;
  windowCount(): number;
  open(request: OpenRequest): Promise<OpenResponse>;
  branchStatus(request: BranchStatusRequest): Promise<BranchStatusResponse>;
  checkout(request: CheckoutRequest): Promise<CheckoutResponse>;
  focus(request: FocusRequest): Promise<FocusResponse>;
  log(message: string): void;
}

interface PostRoute {
  parse(body: unknown): unknown;
  handle(request: unknown): Promise<unknown>;
}

function route<T>(parse: (body: unknown) => T | null, handle: (request: T) => Promise<unknown>): PostRoute {
  return { parse, handle: (request) => handle(request as T) };
}

export function createHttpHandler(deps: HttpDependencies) {
  const expected = Buffer.from(`Bearer ${deps.token}`);
  const postRoutes: Record<string, PostRoute> = {
    '/open': route(parseOpenRequest, deps.open),
    '/branch-status': route(parseBranchStatusRequest, deps.branchStatus),
    '/checkout': route(parseCheckoutRequest, deps.checkout),
    '/focus': route(parseFocusRequest, deps.focus),
  };

  const rejection = (request: IncomingMessage): string | null => {
    // Chrome omits Origin on extension GETs. Web pages cannot send Authorization
    // cross-origin without a preflight that carries Origin, so absence is safe.
    const origin = request.headers.origin;
    if (origin !== undefined && !origin.startsWith('chrome-extension://')) {
      return `origin ${JSON.stringify(origin)}`;
    }
    const header = Buffer.from(request.headers.authorization ?? '');
    if (header.length !== expected.length || !timingSafeEqual(header, expected)) {
      return request.headers.authorization === undefined ? 'token missing' : 'token mismatch';
    }
    return null;
  };

  return (request: IncomingMessage, response: ServerResponse): void => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const reason = rejection(request);
    if (reason) {
      deps.log(`http: rejected ${request.method} ${url.pathname}: ${reason}`);
      sendJson(response, 401, { error: 'unauthorized' });
      request.resume();
      return;
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      const body: HealthResponse = { ok: true, version: deps.version, windows: deps.windowCount() };
      sendJson(response, 200, body);
      return;
    }

    const postRoute = request.method === 'POST' ? postRoutes[url.pathname] : undefined;
    if (postRoute) {
      void readJson(request)
        .then(async (body) => {
          const parsed = postRoute.parse(body);
          if (!parsed) {
            sendJson(response, 400, { error: 'malformed request' });
            return;
          }
          sendJson(response, 200, await postRoute.handle(parsed));
        })
        .catch((error: unknown) => {
          deps.log(`http: ${String(error)}`);
          if (!response.headersSent) {
            sendJson(response, 400, { error: 'malformed request' });
          }
        });
      return;
    }

    sendJson(response, 404, { error: 'not found' });
    request.resume();
  };
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

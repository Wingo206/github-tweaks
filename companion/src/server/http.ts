import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  parseOpenRequest,
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
  log(message: string): void;
}

export function createHttpHandler(deps: HttpDependencies) {
  const expected = Buffer.from(`Bearer ${deps.token}`);

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

    if (request.method === 'POST' && url.pathname === '/open') {
      void readJson(request)
        .then(async (body) => {
          const openRequest = parseOpenRequest(body);
          if (!openRequest) {
            sendJson(response, 400, { error: 'malformed request' });
            return;
          }
          sendJson(response, 200, await deps.open(openRequest));
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

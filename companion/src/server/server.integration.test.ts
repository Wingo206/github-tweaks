import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  encodeMessage,
  LineDecoder,
  parseServerMessage,
  type FolderState,
  type OpenResponse,
  type ServerMessage,
  type WindowMessage,
} from '../protocol';

const ORIGIN = 'chrome-extension://test-extension';
const remote = 'github.com/acme/widgets';

let root: string;
let serverBundle: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ght-companion-'));
  serverBundle = join(root, 'server.js');
  await build({
    entryPoints: [resolve(__dirname, 'main.ts')],
    outfile: serverBundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface ServerProcess {
  child: ChildProcess;
  port: number;
  socketPath: string;
  configDir: string;
  exited: Promise<number | null>;
  token(): string;
  stderr(): string;
}

async function freePort(): Promise<number> {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => done(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function startServer(
  name: string,
  extra: string[] = [],
  shared?: Pick<ServerProcess, 'port' | 'socketPath' | 'configDir'>,
): Promise<ServerProcess> {
  const port = shared?.port ?? (await freePort());
  const socketPath = shared?.socketPath ?? join(root, `${name}.sock`);
  const configDir = shared?.configDir ?? join(root, `${name}-config`);
  const child = spawn(
    process.execPath,
    [
      serverBundle,
      '--port', String(port),
      '--version', '0.2.0',
      '--distro', 'Ubuntu',
      '--socket', socketPath,
      '--config-dir', configDir,
      '--no-focus',
      '--open-timeout-ms', '300',
      ...extra,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => (stderr += chunk));
  const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
  const server: ServerProcess = {
    child,
    port,
    socketPath,
    configDir,
    exited,
    token: () => readFileSync(join(configDir, 'token'), 'utf8').trim(),
    stderr: () => stderr,
  };
  await waitFor(() => stderr.includes('listening') || child.exitCode !== null);
  return server;
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting');
    }
    await new Promise((done) => setTimeout(done, 20));
  }
}

class FakeWindow {
  readonly received: ServerMessage[] = [];
  private readonly socket: Socket;
  closed = false;

  constructor(
    socketPath: string,
    private readonly reply: (message: ServerMessage) => WindowMessage | null,
  ) {
    this.socket = createConnection(socketPath);
    const decoder = new LineDecoder();
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => {
      for (const value of decoder.push(chunk)) {
        const message = parseServerMessage(value);
        if (message) {
          this.received.push(message);
          const response = this.reply(message);
          if (response) {
            this.send(response);
          }
        }
      }
    });
    this.socket.on('close', () => (this.closed = true));
    this.socket.on('error', () => undefined);
  }

  send(message: WindowMessage): void {
    this.socket.write(encodeMessage(message));
  }

  hello(windowId: string, version = '0.2.0'): this {
    this.send({ type: 'hello', windowId, version });
    return this;
  }

  state(folders: FolderState[], focused: boolean): this {
    this.send({ type: 'state', folders, focused });
    return this;
  }

  close(): void {
    this.socket.destroy();
  }
}

const accept = (message: ServerMessage): WindowMessage | null =>
  message.type === 'open' ? { type: 'opened', requestId: message.requestId, ok: true } : null;

function clone(name: string, branch: string): FolderState {
  const path = join(root, 'clones', name);
  mkdirSync(join(path, 'src'), { recursive: true });
  writeFileSync(join(path, 'src', 'a.ts'), 'x\n');
  return { path, remotes: [remote], branch, upstreamBranch: branch };
}

async function post(
  server: ServerProcess,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${server.port}/open`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${server.token()}`,
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function openRequest(overrides: Record<string, unknown> = {}) {
  return { repo: 'acme/widgets', path: 'src/a.ts', line: 4, column: 1, ref: null, ...overrides };
}

describe('companion server', () => {
  let server: ServerProcess;
  const windows: FakeWindow[] = [];

  beforeAll(async () => {
    server = await startServer('main');
  });

  afterAll(async () => {
    for (const window of windows) {
      window.close();
    }
    server.child.kill();
    await server.exited;
  });

  it('rejects requests without the token or with a non-extension origin', async () => {
    expect((await post(server, openRequest(), { Authorization: 'Bearer nope' })).status).toBe(401);
    expect((await post(server, openRequest(), { Origin: 'https://github.com' })).status).toBe(401);
    const health = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: { Authorization: `Bearer ${server.token()}`, Origin: ORIGIN },
    });
    expect(await health.json()).toEqual({ ok: true, version: '0.2.0', windows: 0 });
    // Chrome sends no Origin on extension GETs.
    const noOrigin = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: { Authorization: `Bearer ${server.token()}` },
    });
    expect(noOrigin.status).toBe(200);
    const noToken = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(noToken.status).toBe(401);
    expect((await post(server, { repo: 'acme' })).status).toBe(400);
  });

  it('routes to the branch-matching window and reports the folder', async () => {
    const main = clone('main', 'main');
    const feature = clone('feature', 'feature');
    const mainWindow = new FakeWindow(server.socketPath, accept).hello('w-main').state([main], true);
    const featureWindow = new FakeWindow(server.socketPath, accept)
      .hello('w-feature')
      .state([feature], false);
    windows.push(mainWindow, featureWindow);
    await new Promise((done) => setTimeout(done, 100));

    const response = await post(server, openRequest({ ref: { kind: 'branch', name: 'feature' } }));
    expect(response.body).toEqual({
      status: 'opened',
      folder: feature.path,
      matchedBranch: true,
      launchUrl: `cursor://vscode-remote/wsl+ubuntu${feature.path}`,
    } satisfies OpenResponse);
    expect(featureWindow.received).toContainEqual(
      expect.objectContaining({ type: 'open', path: join(feature.path, 'src/a.ts'), line: 4 }),
    );
    expect(mainWindow.received).toEqual([]);

    const fallback = await post(server, openRequest({ ref: { kind: 'branch', name: 'other' } }));
    expect(fallback.body).toMatchObject({ status: 'opened', folder: main.path, matchedBranch: false });
  });

  it('reports open failures and timeouts', async () => {
    const failing = clone('failing', 'failing');
    const silent = clone('silent', 'silent');
    windows.push(
      new FakeWindow(server.socketPath, (message) =>
        message.type === 'open'
          ? { type: 'opened', requestId: message.requestId, ok: false, error: 'file not found' }
          : null,
      )
        .hello('w-failing')
        .state([failing], false),
      new FakeWindow(server.socketPath, () => null).hello('w-silent').state([silent], false),
    );
    await new Promise((done) => setTimeout(done, 100));

    expect((await post(server, openRequest({ ref: { kind: 'branch', name: 'failing' } }))).body).toEqual({
      status: 'error',
      reason: 'open-failed',
      message: 'file not found',
    });
    expect((await post(server, openRequest({ ref: { kind: 'branch', name: 'silent' } }))).body).toMatchObject({
      status: 'error',
      reason: 'timeout',
    });
  });

  it('returns no-clone for unknown repositories', async () => {
    expect((await post(server, openRequest({ repo: 'acme/unknown' }))).body).toEqual({
      status: 'no-clone',
      repo: 'acme/unknown',
    });
  });

  it('launches remembered clones once and delivers the queued request', async () => {
    const remembered: FolderState = {
      ...clone('remembered', 'main'),
      remotes: ['github.com/acme/remembered'],
    };
    const first = new FakeWindow(server.socketPath, accept).hello('w-remembered').state([remembered], false);
    await new Promise((done) => setTimeout(done, 100));
    first.close();
    await new Promise((done) => setTimeout(done, 100));

    const launch = await post(server, openRequest({ repo: 'acme/remembered', line: 1 }));
    expect(launch.body).toEqual({
      status: 'launch',
      folder: remembered.path,
      launchUrl: `cursor://vscode-remote/wsl+ubuntu${remembered.path}`,
    });
    expect((await post(server, openRequest({ repo: 'acme/remembered', line: 9 }))).body).toEqual({
      status: 'launching',
      folder: remembered.path,
    });

    const launched = new FakeWindow(server.socketPath, accept).hello('w-launched').state([remembered], true);
    windows.push(launched);
    await waitFor(() => launched.received.length > 0);
    expect(launched.received).toEqual([
      expect.objectContaining({ type: 'open', path: join(remembered.path, 'src/a.ts'), line: 9 }),
    ]);
  });

  it('exits when another server already owns the socket', async () => {
    const second = await startServer('second', [], server);
    expect(await second.exited).toBe(0);
    expect(second.stderr()).toContain('already running');
  });

  it('exits with an error when only the port is taken', async () => {
    const second = await startServer('port-clash', [], { ...server, socketPath: join(root, 'other.sock') });
    expect(await second.exited).toBe(1);
    expect(second.stderr()).toContain('in use');
  });
});

describe('companion server lifecycle', () => {
  it('restarts when a newer window says hello', async () => {
    const server = await startServer('restart');
    const window = new FakeWindow(server.socketPath, () => null).hello('w-new', '0.3.0');
    expect(await server.exited).toBe(0);
    await waitFor(() => window.closed);
    expect(window.received).toEqual([{ type: 'restart' }]);
  });

  it('keeps running for older windows', async () => {
    const server = await startServer('older', ['--idle-ms', '200']);
    const window = new FakeWindow(server.socketPath, () => null).hello('w-old', '0.1.0');
    await new Promise((done) => setTimeout(done, 400));
    expect(server.child.exitCode).toBeNull();
    window.close();
    expect(await server.exited).toBe(0);
    expect(server.stderr()).toContain('shutting down: idle');
  });

  it('shuts down after the idle timeout with no windows', async () => {
    const server = await startServer('idle', ['--idle-ms', '200']);
    expect(await server.exited).toBe(0);
  });
});

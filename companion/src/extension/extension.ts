import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, statSync, truncateSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  checkoutBlocker,
  describeCheckoutBlocker,
  encodeMessage,
  LineDecoder,
  parseServerMessage,
  type HealthResponse,
  type ServerMessage,
  type WindowMessage,
} from '../protocol';
import { defaultConfigDir, defaultSocketPath, readToken } from '../server/config';
import { CheckoutRunner } from './checkout';
import { openFile } from './openFile';
import { WindowStateTracker } from './windowState';

const CONNECT_BUDGET_MS = 10_000;
const RETRY_CYCLE_MS = 60_000;
const MAX_LOG_BYTES = 1024 * 1024;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('GitHub Tweaks Companion');
  const version = String(context.extension.packageJSON.version);
  const log = (message: string): void => output.appendLine(`${new Date().toISOString()} ${message}`);

  const connection = new CompanionConnection({
    windowId: `${process.pid}-${randomBytes(4).toString('hex')}`,
    version,
    serverPath: context.asAbsolutePath(join('out', 'server.js')),
    socketPath: defaultSocketPath(),
    configDir: defaultConfigDir(),
    log,
  });
  const tracker = new WindowStateTracker(() => connection.sendState());
  const checkout = new CheckoutRunner(tracker, log);
  connection.tracker = tracker;
  connection.checkout = checkout;

  context.subscriptions.push(
    output,
    tracker,
    checkout,
    connection,
    vscode.commands.registerCommand('githubTweaksCompanion.copyPairingToken', async () => {
      const token = readToken(defaultConfigDir());
      if (!token) {
        void vscode.window.showErrorMessage(
          'GitHub Tweaks: no pairing token yet. It is created when the companion server first starts; check "GitHub Tweaks: Show companion status".',
        );
        return;
      }
      await vscode.env.clipboard.writeText(token);
      void vscode.window.showInformationMessage(
        'GitHub Tweaks: pairing token copied. Paste it into the GitHub Tweaks browser popup.',
      );
    }),
    vscode.commands.registerCommand('githubTweaksCompanion.showStatus', async () => {
      output.show(true);
      output.appendLine('');
      output.appendLine('GitHub Tweaks Companion status');
      output.appendLine(`  extension version: ${version}`);
      output.appendLine(`  window socket: ${connection.connected ? 'connected' : 'disconnected'}`);
      const health = await fetchHealth(port(), readToken(defaultConfigDir()));
      output.appendLine(
        health
          ? `  server: v${health.version}, ${health.windows} connected window(s), port ${port()}`
          : `  server: not reachable on port ${port()}`,
      );
      const folders = tracker.folders();
      output.appendLine(folders.length ? '  folders:' : '  folders: none');
      for (const folder of folders) {
        output.appendLine(`    ${folder.path}`);
        output.appendLine(`      branch: ${folder.branch ?? '(detached)'}, upstream: ${folder.upstreamBranch ?? '(none)'}`);
        const blocker = checkoutBlocker(folder);
        output.appendLine(`      checkout: ${blocker ? describeCheckoutBlocker(blocker) : 'clean'}`);
        output.appendLine(`      remotes: ${folder.remotes.join(', ') || '(no GitHub remotes)'}`);
      }
    }),
  );

  void tracker.start().then(
    () => connection.start(),
    (error: unknown) => {
      log(`git state unavailable: ${String(error)}`);
      connection.start();
    },
  );
}

export function deactivate(): void {}

function port(): number {
  return vscode.workspace.getConfiguration('githubTweaksCompanion').get<number>('port', 17380);
}

interface ConnectionOptions {
  windowId: string;
  version: string;
  serverPath: string;
  socketPath: string;
  configDir: string;
  log(message: string): void;
}

class CompanionConnection implements vscode.Disposable {
  tracker: WindowStateTracker | null = null;
  checkout: CheckoutRunner | null = null;
  private socket: Socket | null = null;
  private connecting = false;
  private disposed = false;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: ConnectionOptions) {}

  get connected(): boolean {
    return this.socket !== null;
  }

  start(): void {
    void this.connect(true);
  }

  sendState(): void {
    if (!this.tracker) {
      return;
    }
    this.send({ type: 'state', folders: this.tracker.folders(), focused: this.tracker.focused() });
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.socket?.destroy();
    this.socket = null;
  }

  private send(message: WindowMessage): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(encodeMessage(message));
    }
  }

  /**
   * Connects to the server, spawning it when nothing answers. Windows that
   * lost their server unexpectedly wait briefly first so the window that
   * received `restart` (with the newest server) usually wins the spawn race.
   */
  private async connect(spawnImmediately: boolean): Promise<void> {
    if (this.connecting || this.disposed) {
      return;
    }
    this.connecting = true;
    try {
      let socket = await tryConnect(this.options.socketPath);
      if (!socket && !spawnImmediately) {
        await sleep(500 + Math.random() * 500);
        socket = await tryConnect(this.options.socketPath);
      }
      if (!socket) {
        this.spawnServer();
        const deadline = Date.now() + CONNECT_BUDGET_MS;
        let delay = 100;
        while (!socket && !this.disposed && Date.now() < deadline) {
          await sleep(delay);
          delay = Math.min(delay * 2, 2_000);
          socket = await tryConnect(this.options.socketPath);
        }
      }
      if (this.disposed) {
        socket?.destroy();
        return;
      }
      if (!socket) {
        this.options.log(`companion server unreachable; retrying in ${RETRY_CYCLE_MS / 1000}s`);
        this.retryTimer = setTimeout(() => void this.connect(true), RETRY_CYCLE_MS);
        return;
      }
      this.attach(socket);
    } finally {
      this.connecting = false;
    }
  }

  private attach(socket: Socket): void {
    this.socket = socket;
    let restart = false;
    const decoder = new LineDecoder();
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      for (const value of decoder.push(chunk)) {
        const message = parseServerMessage(value);
        if (message?.type === 'restart') {
          restart = true;
        } else if (message) {
          void this.handle(message);
        }
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      if (!this.disposed) {
        this.options.log(restart ? 'server requested restart' : 'disconnected from companion server');
        void this.connect(restart);
      }
    });
    this.options.log('connected to companion server');
    this.send({ type: 'hello', windowId: this.options.windowId, version: this.options.version });
    this.sendState();
  }

  private async handle(message: Exclude<ServerMessage, { type: 'restart' }>): Promise<void> {
    const reply = message.type === 'open' ? 'opened' : 'checkout-started';
    try {
      if (message.type === 'open') {
        await openFile(message.path, message.line, message.column);
      } else {
        if (!this.checkout) {
          throw new Error('Checkout is unavailable in this window.');
        }
        const { requestId: _requestId, type: _type, path, ...command } = message;
        await this.checkout.run(path, command);
      }
      this.send({ type: reply, requestId: message.requestId, ok: true });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.options.log(`${message.type} ${message.path} failed: ${text}`);
      this.send({ type: reply, requestId: message.requestId, ok: false, error: text });
    }
  }

  private spawnServer(): void {
    const args = [this.options.serverPath, '--port', String(port()), '--version', this.options.version];
    const distro = process.env.WSL_DISTRO_NAME;
    if (distro) {
      args.push('--distro', distro);
    }
    let logFd: number | 'ignore' = 'ignore';
    try {
      mkdirSync(this.options.configDir, { recursive: true, mode: 0o700 });
      const logPath = join(this.options.configDir, 'server.log');
      try {
        if (statSync(logPath).size > MAX_LOG_BYTES) {
          truncateSync(logPath, 0);
        }
      } catch {
        // No log yet.
      }
      logFd = openSync(logPath, 'a');
    } catch {
      logFd = 'ignore';
    }
    try {
      const child = spawn(process.execPath, args, {
        detached: true,
        stdio: ['ignore', 'ignore', logFd],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      child.unref();
      this.options.log(`spawned companion server (pid ${child.pid ?? '?'})`);
    } catch (error) {
      this.options.log(`failed to spawn companion server: ${String(error)}`);
    } finally {
      if (typeof logFd === 'number') {
        closeSync(logFd);
      }
    }
  }
}

function tryConnect(socketPath: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, 1_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.removeAllListeners('error');
      resolve(socket);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(null);
    });
  });
}

function fetchHealth(portNumber: number, token: string | null): Promise<HealthResponse | null> {
  if (!token) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: portNumber,
        path: '/health',
        headers: { Authorization: `Bearer ${token}`, Origin: 'chrome-extension://github-tweaks-companion' },
        timeout: 2_000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => {
          try {
            resolve(response.statusCode === 200 ? (JSON.parse(body) as HealthResponse) : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    request.on('error', () => resolve(null));
    request.on('timeout', () => request.destroy());
    request.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

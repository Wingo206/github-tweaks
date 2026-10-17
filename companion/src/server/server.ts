import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createConnection, createServer as createSocketServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import {
  compareVersions,
  encodeMessage,
  LineDecoder,
  parseWindowMessage,
  type FolderState,
  type OpenRequest,
  type OpenResponse,
  type WindowMessage,
} from '../protocol';
import { loadClones, loadOrCreateToken, saveClones } from './config';
import type { FocusHelper } from './focus';
import { createHttpHandler } from './http';
import { LaunchQueue } from './launches';
import { cloneCandidates, rankTargets, windowCandidates } from './ranking';
import { CloneMemory, WindowRegistry, type WindowEntry } from './registry';

export interface ServerOptions {
  port: number;
  version: string;
  distro: string | null;
  socketPath: string;
  configDir: string;
  idleMs: number;
  openTimeoutMs: number;
  focus: FocusHelper;
  log(message: string): void;
}

export interface RunningServer {
  /** Resolves when the server has shut down. */
  closed: Promise<void>;
  shutdown(reason: string): void;
}

export class PortInUseError extends Error {}

type OpenResult = { ok: true } | { ok: false; error: string } | null;

interface PendingOpen {
  entry: WindowEntry;
  resolve(result: OpenResult): void;
}

/** Returns true when a live companion server is listening on `socketPath`. */
export function probeSocket(socketPath: string, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => finish(false), timeoutMs);
    function finish(alive: boolean): void {
      clearTimeout(timer);
      socket.destroy();
      resolve(alive);
    }
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function startServer(options: ServerOptions): Promise<RunningServer | 'already-running'> {
  if (await probeSocket(options.socketPath)) {
    return 'already-running';
  }

  const { log } = options;
  const token = loadOrCreateToken(options.configDir);
  const registry = new WindowRegistry();
  const clones = new CloneMemory(loadClones(options.configDir), (list) => {
    try {
      saveClones(options.configDir, list);
    } catch (error) {
      log(`clones: save failed: ${String(error)}`);
    }
  });
  const launches = new LaunchQueue();
  const pending = new Map<string, PendingOpen>();
  const sockets = new Set<Socket>();
  let idleTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const launchUrl = (folder: string): string | null =>
    options.distro
      ? `cursor://vscode-remote/wsl+${encodeURIComponent(options.distro.toLowerCase())}${folder
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`
      : null;

  const deliver = async (
    entry: WindowEntry,
    folder: FolderState,
    request: OpenRequest,
    matchedBranch: boolean,
  ): Promise<OpenResponse> => {
    const requestId = randomUUID();
    const path = join(folder.path, request.path);
    const result = await new Promise<OpenResult>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve(null);
      }, options.openTimeoutMs);
      pending.set(requestId, {
        entry,
        resolve: (value) => {
          clearTimeout(timer);
          pending.delete(requestId);
          resolve(value);
        },
      });
      entry.send({ type: 'open', requestId, path, line: request.line, column: request.column });
    });

    if (result === null) {
      log(`open ${path}: timed out in ${entry.windowId}`);
      return { status: 'error', reason: 'timeout', message: 'Cursor did not confirm the open in time.' };
    }
    if (!result.ok) {
      log(`open ${path}: failed in ${entry.windowId}: ${result.error}`);
      return { status: 'error', reason: 'open-failed', message: result.error };
    }
    if (entry.hwnd) {
      const raised = await options.focus.raise(entry.hwnd);
      if (!raised.ok) {
        log(`raise ${entry.hwnd} (${entry.windowId}) failed: ${raised.reason}`);
      }
    }
    log(`open ${path}:${request.line}: opened in ${entry.windowId}`);
    return { status: 'opened', folder: folder.path, matchedBranch, launchUrl: launchUrl(folder.path) };
  };

  const open = async (request: OpenRequest): Promise<OpenResponse> => {
    const target = rankTargets(request, windowCandidates(registry.list()), existsSync);
    if (target) {
      return deliver(target.item, target.folder, request, target.matchedBranch);
    }
    const clone = rankTargets(request, cloneCandidates(clones.list()), existsSync);
    const url = clone ? launchUrl(clone.folder.path) : null;
    if (!clone || !url) {
      return { status: 'no-clone', repo: request.repo };
    }
    const folder = clone.folder.path;
    if (launches.enqueue(folder, request) === 'launching') {
      log(`open ${request.repo}/${request.path}: waiting for ${folder}`);
      return { status: 'launching', folder };
    }
    log(`open ${request.repo}/${request.path}: launching ${folder}`);
    return { status: 'launch', folder, launchUrl: url };
  };

  const deliverQueued = (entry: WindowEntry): void => {
    for (const folder of entry.folders) {
      const request = launches.take(folder.path);
      if (!request) {
        continue;
      }
      const ref = request.ref;
      const matchedBranch =
        ref?.kind === 'branch' && (folder.branch === ref.name || folder.upstreamBranch === ref.name);
      void deliver(entry, folder, request, matchedBranch).then((response) => {
        log(`queued open for ${folder.path}: ${response.status}`);
      });
    }
  };

  const scheduleIdle = (): void => {
    if (idleTimer || stopping || registry.size > 0) {
      return;
    }
    idleTimer = setTimeout(() => shutdown('idle'), options.idleMs);
  };

  const cancelIdle = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const handleMessage = (
    socket: Socket,
    current: WindowEntry | null,
    message: WindowMessage,
  ): WindowEntry | null => {
    switch (message.type) {
      case 'hello': {
        if (current) {
          return current;
        }
        if (compareVersions(message.version, options.version) > 0) {
          log(`window ${message.windowId} has newer version ${message.version}; restarting`);
          shutdown('restart', socket);
          return null;
        }
        cancelIdle();
        log(`window ${message.windowId} connected (v${message.version})`);
        return registry.register(message.windowId, message.version, (outgoing) => {
          if (!socket.destroyed) {
            socket.write(encodeMessage(outgoing));
          }
        });
      }
      case 'state': {
        if (!current) {
          return current;
        }
        const gainedFocus = registry.updateState(current, message.folders, message.focused);
        clones.upsert(message.folders);
        if (gainedFocus) {
          const entry = current;
          void options.focus
            .foreground()
            .then((hwnd) => {
              if (hwnd) {
                entry.hwnd = hwnd;
              }
              log(`window ${entry.windowId} focused (hwnd ${hwnd ?? 'unknown'})`);
            })
            .finally(() => deliverQueued(entry));
        } else {
          deliverQueued(current);
        }
        return current;
      }
      case 'opened': {
        const waiting = pending.get(message.requestId);
        if (waiting && waiting.entry === current) {
          waiting.resolve(message.ok ? { ok: true } : { ok: false, error: message.error });
        }
        return current;
      }
    }
  };

  const socketServer: Server = createSocketServer((socket) => {
    sockets.add(socket);
    let entry: WindowEntry | null = null;
    const decoder = new LineDecoder();
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      for (const value of decoder.push(chunk)) {
        const message = parseWindowMessage(value);
        if (message) {
          entry = handleMessage(socket, entry, message);
        }
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      sockets.delete(socket);
      if (!entry) {
        return;
      }
      registry.remove(entry);
      log(`window ${entry.windowId} disconnected`);
      for (const waiting of pending.values()) {
        if (waiting.entry === entry) {
          waiting.resolve({ ok: false, error: 'The Cursor window disconnected.' });
        }
      }
      scheduleIdle();
    });
  });

  const httpServer: HttpServer = createHttpServer(
    createHttpHandler({
      token,
      version: options.version,
      windowCount: () => registry.size,
      open,
      log,
    }),
  );

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE' ? new PortInUseError(`port ${options.port} is in use`) : error);
    });
    httpServer.listen(options.port, '127.0.0.1', () => resolve());
  });

  try {
    unlinkSync(options.socketPath);
  } catch {
    // No stale socket.
  }
  await new Promise<void>((resolve, reject) => {
    socketServer.once('error', reject);
    socketServer.listen(options.socketPath, () => resolve());
  });
  chmodSync(options.socketPath, 0o600);

  function shutdown(reason: string, restartSocket?: Socket): void {
    if (stopping) {
      return;
    }
    stopping = true;
    cancelIdle();
    log(`shutting down: ${reason}`);
    httpServer.close();
    httpServer.closeAllConnections();
    socketServer.close();
    try {
      unlinkSync(options.socketPath);
    } catch {
      // Already gone.
    }
    options.focus.dispose();
    for (const waiting of pending.values()) {
      waiting.resolve(null);
    }
    const finish = (): void => {
      for (const socket of sockets) {
        socket.destroy();
      }
      resolveClosed();
    };
    if (restartSocket && !restartSocket.destroyed) {
      restartSocket.end(encodeMessage({ type: 'restart' }), finish);
    } else {
      finish();
    }
  }

  log(`listening on 127.0.0.1:${options.port} and ${options.socketPath} (v${options.version})`);
  scheduleIdle();
  return { closed, shutdown: (reason) => shutdown(reason) };
}

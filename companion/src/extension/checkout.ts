import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import {
  checkoutBlocker,
  describeCheckoutBlocker,
  isCheckedOut,
  type CheckoutCommand,
} from '../protocol';
import { checkoutShellCommand, findRemote } from './checkoutCommand';
import type { WindowStateTracker } from './windowState';

const SHELL_INTEGRATION_TIMEOUT_MS = 5_000;

/**
 * Runs checkouts in an editor-area terminal so git hooks get a TTY and can
 * prompt without opening or closing the terminal panel. The tab closes once
 * the checkout (hooks included) exits 0, and stays open on failure or when
 * shell integration cannot report the exit code. Reuses one terminal per clone.
 */
export class CheckoutRunner implements vscode.Disposable {
  private readonly terminals = new Map<string, vscode.Terminal>();
  private readonly closeListener: vscode.Disposable;

  constructor(
    private readonly tracker: WindowStateTracker,
    private readonly log: (message: string) => void,
  ) {
    this.closeListener = vscode.window.onDidCloseTerminal((terminal) => {
      for (const [path, candidate] of this.terminals) {
        if (candidate === terminal) {
          this.terminals.delete(path);
        }
      }
    });
  }

  /** Starts the checkout; throws with a user-facing message when it cannot. */
  async run(path: string, command: CheckoutCommand): Promise<void> {
    const name = basename(path);
    const repository = this.tracker.repository(path);
    if (!repository) {
      throw new Error(`${name} is not open in this Cursor window.`);
    }
    await repository.status().catch(() => undefined);
    const folder = this.tracker.folders().find((candidate) => candidate.path === path);
    if (!folder) {
      throw new Error(`${name} is not open in this Cursor window.`);
    }
    if (isCheckedOut(folder, command.branch)) {
      this.log(`checkout ${command.branch} in ${path}: already checked out`);
      return;
    }
    const blocker = checkoutBlocker(folder);
    if (blocker) {
      throw new Error(`${name}: ${describeCheckoutBlocker(blocker)}.`);
    }

    const text = checkoutShellCommand(command, {
      remote: command.fork ? null : findRemote(repository.state.remotes, command.repo),
      branchExists: command.fork ? false : await localBranchExists(path, command.branch),
    });
    const terminal = this.terminal(path, name);
    terminal.show(false);
    this.log(`checkout in ${path}: ${text}`);
    void this.execute(terminal, path, text);
  }

  dispose(): void {
    this.closeListener.dispose();
    this.terminals.clear();
  }

  private terminal(path: string, name: string): vscode.Terminal {
    const existing = this.terminals.get(path);
    if (existing && existing.exitStatus === undefined) {
      return existing;
    }
    const terminal = vscode.window.createTerminal({
      name: `Checkout · ${name}`,
      cwd: path,
      location: { viewColumn: vscode.ViewColumn.Active },
    });
    this.terminals.set(path, terminal);
    return terminal;
  }

  private async execute(terminal: vscode.Terminal, path: string, text: string): Promise<void> {
    const shell = await waitForShellIntegration(terminal, SHELL_INTEGRATION_TIMEOUT_MS);
    if (terminal.exitStatus !== undefined) {
      return;
    }
    if (!shell) {
      terminal.sendText(text, true);
      this.log(`checkout in ${path}: no shell integration, leaving the terminal open`);
      return;
    }
    const exitCode = await waitForExit(terminal, shell.executeCommand(text));
    if (exitCode === 0) {
      this.log(`checkout in ${path}: finished, closing the terminal`);
      terminal.dispose();
    } else {
      this.log(`checkout in ${path}: exited ${exitCode ?? 'with unknown status'}, leaving the terminal open`);
    }
  }
}

function waitForShellIntegration(
  terminal: vscode.Terminal,
  timeoutMs: number,
): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration) {
    return Promise.resolve(terminal.shellIntegration);
  }
  return new Promise((resolve) => {
    const listeners = [
      vscode.window.onDidChangeTerminalShellIntegration((event) => {
        if (event.terminal === terminal) {
          finish(event.shellIntegration);
        }
      }),
      vscode.window.onDidCloseTerminal((closed) => {
        if (closed === terminal) {
          finish(undefined);
        }
      }),
    ];
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    function finish(value: vscode.TerminalShellIntegration | undefined): void {
      clearTimeout(timer);
      for (const listener of listeners) {
        listener.dispose();
      }
      resolve(value);
    }
  });
}

function waitForExit(
  terminal: vscode.Terminal,
  execution: vscode.TerminalShellExecution,
): Promise<number | undefined> {
  return new Promise((resolve) => {
    const listeners = [
      vscode.window.onDidEndTerminalShellExecution((event) => {
        if (event.execution === execution) {
          finish(event.exitCode);
        }
      }),
      vscode.window.onDidCloseTerminal((closed) => {
        if (closed === terminal) {
          finish(undefined);
        }
      }),
    ];
    function finish(exitCode: number | undefined): void {
      for (const listener of listeners) {
        listener.dispose();
      }
      resolve(exitCode);
    }
  });
}

function localBranchExists(cwd: string, branch: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd }, (error) =>
      resolve(error === null),
    );
  });
}

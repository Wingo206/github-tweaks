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

/**
 * Runs checkouts in an integrated terminal so git hooks get a TTY and can
 * prompt. Reuses one terminal per clone.
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
    terminal.sendText(text, true);
    this.log(`checkout in ${path}: ${text}`);
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
    const terminal = vscode.window.createTerminal({ name: `Checkout · ${name}`, cwd: path });
    this.terminals.set(path, terminal);
    return terminal;
  }
}

function localBranchExists(cwd: string, branch: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd }, (error) =>
      resolve(error === null),
    );
  });
}

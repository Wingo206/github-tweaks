import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type RaiseResult = { ok: true } | { ok: false; reason: string };

export interface FocusHelper {
  /** Decimal handle of the current Windows foreground window. */
  foreground(): Promise<string | null>;
  raise(hwnd: string): Promise<RaiseResult>;
  dispose(): void;
}

const COMMAND_TIMEOUT_MS = 2_000;

const HELPER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GhtFocus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  public static string Raise(long value) {
    IntPtr h = new IntPtr(value);
    if (!IsWindow(h)) return "failed not-a-window";
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    return SetForegroundWindow(h) ? "ok" : "failed set-foreground";
  }
}
'@
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Trim().Split(' ')
  try {
    switch ($parts[0]) {
      'foreground' { [Console]::Out.WriteLine([GhtFocus]::GetForegroundWindow().ToInt64()) }
      'raise' { [Console]::Out.WriteLine([GhtFocus]::Raise([long]$parts[1])) }
      default { [Console]::Out.WriteLine('failed unknown-command') }
    }
  } catch {
    [Console]::Out.WriteLine('failed ' + $_.Exception.Message.Replace("${'`'}n", ' '))
  }
}
`;

interface Pending {
  resolve(line: string | null): void;
}

/**
 * Long-lived `powershell.exe` process that answers one command per line.
 * Started lazily, restarted after it exits or a command times out.
 */
export class PowerShellFocusHelper implements FocusHelper {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<boolean> | null = null;
  private buffer = '';
  private pending: Pending[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly log: (message: string) => void,
    private readonly executable = 'powershell.exe',
  ) {}

  async foreground(): Promise<string | null> {
    const line = await this.command('foreground');
    return line && /^[1-9][0-9]*$/.test(line) ? line : null;
  }

  async raise(hwnd: string): Promise<RaiseResult> {
    if (!/^[1-9][0-9]*$/.test(hwnd)) {
      return { ok: false, reason: 'invalid-handle' };
    }
    const line = await this.command(`raise ${hwnd}`);
    if (line === 'ok') {
      return { ok: true };
    }
    return { ok: false, reason: line?.replace(/^failed\s*/, '') || 'no-response' };
  }

  dispose(): void {
    this.child?.kill();
    this.child = null;
    this.ready = null;
  }

  private command(text: string): Promise<string | null> {
    const run = this.queue.then(() => this.execute(text));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async execute(text: string): Promise<string | null> {
    if (!(await this.ensureStarted())) {
      return null;
    }
    const child = this.child;
    if (!child) {
      return null;
    }
    const line = await this.nextLine(() => child.stdin.write(`${text}\n`));
    if (line === null) {
      this.log(`focus helper: "${text}" timed out; restarting`);
      this.dispose();
    }
    return line;
  }

  private ensureStarted(): Promise<boolean> {
    if (this.ready) {
      return this.ready;
    }
    this.buffer = '';
    const encoded = Buffer.from(HELPER_SCRIPT, 'utf16le').toString('base64');
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.log(`focus helper: spawn failed: ${String(error)}`);
      return Promise.resolve(false);
    }
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
    // PowerShell writes CLIXML progress records to stderr; drain and ignore.
    child.stderr.resume();
    child.on('error', (error) => {
      this.log(`focus helper: ${error.message}`);
      this.onExit(child);
    });
    child.on('exit', () => this.onExit(child));
    child.stdin.on('error', () => undefined);

    this.ready = this.nextLine(() => undefined, 15_000).then((line) => {
      if (line === 'ready') {
        return true;
      }
      this.log(`focus helper: failed to start (${line ?? 'timeout'})`);
      this.dispose();
      return false;
    });
    return this.ready;
  }

  private nextLine(write: () => void, timeoutMs = COMMAND_TIMEOUT_MS): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const pending: Pending = {
        resolve: (line) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(line);
        },
      };
      const timer = setTimeout(() => {
        this.pending = this.pending.filter((entry) => entry !== pending);
        pending.resolve(null);
      }, timeoutMs);
      this.pending.push(pending);
      write();
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) {
        this.pending.shift()?.resolve(line);
      }
    }
  }

  private onExit(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) {
      return;
    }
    this.child = null;
    this.ready = null;
    for (const pending of this.pending.splice(0)) {
      pending.resolve(null);
    }
  }
}

/** Used when Windows focus is unavailable (tests, non-WSL hosts). */
export class NoopFocusHelper implements FocusHelper {
  constructor(private readonly log: (message: string) => void = () => undefined) {}

  async foreground(): Promise<string | null> {
    this.log('focus: foreground');
    return null;
  }

  async raise(hwnd: string): Promise<RaiseResult> {
    this.log(`focus: raise ${hwnd}`);
    return { ok: false, reason: 'disabled' };
  }

  dispose(): void {}
}

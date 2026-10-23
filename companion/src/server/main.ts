import { parseArgs } from 'node:util';
import { defaultConfigDir, defaultSocketPath } from './config';
import { NoopFocusHelper, PowerShellFocusHelper } from './focus';
import { PortInUseError, startServer } from './server';

const IDLE_MS = 10 * 60_000;
const OPEN_TIMEOUT_MS = 5_000;
// Stays under the browser's 10-second request timeout.
const CHECKOUT_TIMEOUT_MS = 8_000;

function log(message: string): void {
  process.stderr.write(`${new Date().toISOString()} ${message}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '17380' },
      version: { type: 'string', default: '0.0.0' },
      distro: { type: 'string' },
      socket: { type: 'string' },
      'config-dir': { type: 'string' },
      'idle-ms': { type: 'string' },
      'open-timeout-ms': { type: 'string' },
      'checkout-timeout-ms': { type: 'string' },
      'no-focus': { type: 'boolean', default: false },
    },
  });

  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    log(`invalid port: ${values.port}`);
    process.exit(1);
  }

  const distro = values.distro ?? process.env.WSL_DISTRO_NAME ?? null;
  let server;
  try {
    server = await startServer({
      port,
      version: values.version,
      distro,
      socketPath: values.socket ?? defaultSocketPath(),
      configDir: values['config-dir'] ?? defaultConfigDir(),
      idleMs: values['idle-ms'] ? Number(values['idle-ms']) : IDLE_MS,
      openTimeoutMs: values['open-timeout-ms'] ? Number(values['open-timeout-ms']) : OPEN_TIMEOUT_MS,
      checkoutTimeoutMs: values['checkout-timeout-ms']
        ? Number(values['checkout-timeout-ms'])
        : CHECKOUT_TIMEOUT_MS,
      focus: values['no-focus'] ? new NoopFocusHelper(log) : new PowerShellFocusHelper(log),
      log,
    });
  } catch (error) {
    log(error instanceof PortInUseError ? error.message : `startup failed: ${String(error)}`);
    process.exit(1);
  }

  if (server === 'already-running') {
    log('a companion server is already running');
    process.exit(0);
  }

  const running = server;
  process.on('SIGTERM', () => running.shutdown('SIGTERM'));
  process.on('SIGINT', () => running.shutdown('SIGINT'));
  await running.closed;
  process.exit(0);
}

void main();

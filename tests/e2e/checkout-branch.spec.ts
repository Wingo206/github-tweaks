import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

interface ReceivedRequest {
  path: string;
  body: unknown;
}

test('checks out the head branch in a chosen clone through the companion', async () => {
  const extensionPath = resolve(process.cwd(), '.output/chrome-mv3');
  const header = readFileSync(
    resolve(process.cwd(), 'tests/fixtures/pr-checkout-branch/head-branch.html'),
    'utf8',
  );

  let checkedOut = false;
  const received: ReceivedRequest[] = [];
  const companion = createServer((request: IncomingMessage, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    request.on('end', () => {
      received.push({ path: request.url ?? '', body: body ? JSON.parse(body) : null });
      const reply =
        request.url === '/checkout'
          ? ((checkedOut = true), { status: 'started', folder: '/home/me/widgets', launchUrl: null })
          : {
              clones: [
                {
                  path: '/home/me/widgets',
                  branch: checkedOut ? 'feature/x' : 'main',
                  checkedOut,
                  blocker: null,
                },
                {
                  path: '/home/me/widgets-2',
                  branch: 'main',
                  checkedOut: false,
                  blocker: { kind: 'changes', staged: 0, modified: 2, conflicts: 0 },
                },
              ],
            };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((done) => companion.listen(0, '127.0.0.1', done));
  const port = (companion.address() as AddressInfo).port;

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  await context.route('https://github.com/acme/widgets/pull/42', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>${header}</body></html>`,
    });
  });

  try {
    const worker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(
      async ({ port }) => {
        await browser.storage.local.set({
          'companion-token': 'pairing-secret',
          'companion-port': port,
        });
      },
      { port },
    );

    const page = await context.newPage();
    await page.goto('https://github.com/acme/widgets/pull/42');
    await page.getByRole('button', { name: 'Check out branch locally' }).click();

    const menu = page.getByRole('dialog', { name: 'Check out branch locally' });
    await expect(menu.getByRole('button', { name: /widgets-2.*Uncommitted changes: 2 modified/ })).toBeVisible();
    await menu.getByRole('button', { name: /^widgets\s*Check out/ }).click();

    await expect(page.getByRole('button', { name: 'Checked out in widgets' })).toBeVisible();
    expect(received.find((request) => request.path === '/checkout')?.body).toEqual({
      repo: 'acme/widgets',
      folder: '/home/me/widgets',
      branch: 'feature/x',
      pullNumber: 42,
      fork: false,
    });
    expect(received[0]).toEqual({
      path: '/branch-status',
      body: { repo: 'acme/widgets', branch: 'feature/x' },
    });
  } finally {
    await context.close();
    companion.close();
  }
});

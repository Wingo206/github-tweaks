import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

interface ReceivedRequest {
  path: string;
  origin: string | undefined;
  authorization: string | undefined;
  body: unknown;
}

test('opens a review thread through the companion server', async () => {
  const extensionPath = resolve(process.cwd(), '.output/chrome-mv3');
  const threads = readFileSync(
    resolve(process.cwd(), 'tests/fixtures/open-in-cursor/conversation-review-threads.html'),
    'utf8',
  );

  const received: ReceivedRequest[] = [];
  const companion = createServer((request: IncomingMessage, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    request.on('end', () => {
      received.push({
        path: request.url ?? '',
        origin: request.headers.origin,
        authorization: request.headers.authorization,
        body: body ? JSON.parse(body) : null,
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          status: 'opened',
          folder: '/home/me/widgets',
          matchedBranch: true,
          launchUrl: 'cursor://vscode-remote/wsl+ubuntu/home/me/widgets',
        }),
      );
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
      body: `<!doctype html><html><body>${threads}</body></html>`,
    });
  });
  await context.route('https://api.github.com/graphql', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              headRefName: 'feature/x',
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    path: 'src/widgets/panel.ts',
                    line: 12,
                    originalLine: 10,
                    comments: { nodes: [{ databaseId: 4001 }, { databaseId: 4002 }] },
                  },
                ],
              },
            },
          },
        },
      }),
    });
  });

  try {
    const worker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(
      async ({ port }) => {
        await browser.storage.local.set({
          'github-token': 'test-token',
          'companion-token': 'pairing-secret',
          'companion-port': port,
        });
      },
      { port },
    );

    const page = await context.newPage();
    await page.goto('https://github.com/acme/widgets/pull/42');
    const button = page.getByRole('button', { name: 'Open in Cursor' }).first();
    await button.click();

    await expect(button).toHaveAttribute('data-ght-oic-state', 'opened');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      path: '/open',
      authorization: 'Bearer pairing-secret',
      body: {
        repo: 'acme/widgets',
        path: 'src/widgets/panel.ts',
        line: 12,
        column: 1,
        ref: { kind: 'branch', name: 'feature/x' },
      },
    });
    expect(received[0]!.origin).toMatch(/^chrome-extension:\/\//);
  } finally {
    await context.close();
    companion.close();
  }
});

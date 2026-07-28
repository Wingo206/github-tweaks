import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

test('renders metadata and toggles Viewed through GraphQL', async () => {
  const extensionPath = resolve(process.cwd(), '.output/chrome-mv3');
  const sidebar = readFileSync(
    resolve(process.cwd(), 'tests/fixtures/sidebar.html'),
    'utf8',
  );
  const diffs = readFileSync(
    resolve(process.cwd(), 'tests/fixtures/file-diff.html'),
    'utf8',
  );
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let viewedMutationCount = 0;
  await context.route('https://api.github.com/graphql', async (route) => {
    const request = route.request();
    const payload = request.postDataJSON() as {
      query: string;
      variables: Record<string, unknown>;
    };

    if (payload.query.includes('PullRequestFiles')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                id: 'PR_1',
                headRefOid: 'head',
                files: {
                  nodes: [
                    {
                      path: 'src/index.ts',
                      additions: 5,
                      deletions: 2,
                      viewerViewedState: 'UNVIEWED',
                    },
                    {
                      path: 'src/empty.png',
                      additions: 0,
                      deletions: 0,
                      viewerViewedState: 'VIEWED',
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        }),
      });
      return;
    }

    if (payload.query.includes('markFileAsViewed')) {
      viewedMutationCount += 1;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            markFileAsViewed: { pullRequest: { id: 'PR_1' } },
          },
        }),
      });
      return;
    }

    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { viewer: { login: 'test-user' } } }),
    });
  });

  await context.route(
    'https://github.com/acme/widgets/pull/42/changes',
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body>${sidebar}${diffs}</body></html>`,
      });
    },
  );

  try {
    const page = await context.newPage();
    await page.goto('https://github.com/acme/widgets/pull/42/changes');

    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await worker.evaluate(async () => {
      await browser.storage.local.set({ 'github-token': 'test-token' });
    });

    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    const indexRow = page.locator('[id="src/index.ts"]');
    await expect(indexRow.locator('.ght-pr-metadata__counts')).toHaveText(
      '+5-2',
    );
    await expect(
      page.locator('[id="src"] .ght-pr-metadata__progress'),
    ).toHaveText('1/2');

    const checkbox = indexRow.locator('input[type="checkbox"]');
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await expect.poll(() => viewedMutationCount).toBe(1);
  } finally {
    await context.close();
  }
});

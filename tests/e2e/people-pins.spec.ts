import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

test('shows repository pins in the reviewers picker and saves a new pin', async () => {
  const extensionPath = resolve(process.cwd(), '.output/chrome-mv3');
  const panel = readFileSync(
    resolve(process.cwd(), 'tests/fixtures/pr-people-pins/reviewers-panel.html'),
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

  await context.route('https://github.com/acme/widgets/pull/42', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>${panel}</body></html>`,
    });
  });
  await context.route('https://api.github.com/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { viewer: { login: 'ada' } } }),
    });
  });

  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await worker.evaluate(async () => {
      await browser.storage.local.set({
        'people-pins:acme/widgets': [
          {
            id: '33',
            login: 'ada',
            name: 'Ada Lovelace',
            avatarUrl: 'https://avatars.githubusercontent.com/u/33?s=40&v=4',
          },
        ],
      });
    });

    const page = await context.newPage();
    await page.goto('https://github.com/acme/widgets/pull/42');
    const pinned = page.getByRole('group', { name: 'Pinned' });
    await expect(pinned.locator('.ght-pp__login')).toHaveText('ada');

    await page.locator('#rev-dana').getByRole('button', { name: 'Pin dana' }).click();
    await expect
      .poll(() =>
        worker.evaluate(async () => {
          const stored = await browser.storage.local.get('people-pins:acme/widgets');
          const people = stored['people-pins:acme/widgets'] as Array<{ login: string }>;
          return people.map((person) => person.login);
        }),
      )
      .toEqual(['ada', 'dana']);
    await expect(pinned.locator('.ght-pp__login')).toHaveText(['ada', 'dana']);
    await expect(page.locator('#rev-dana')).toHaveAttribute('aria-selected', 'false');
  } finally {
    await context.close();
  }
});

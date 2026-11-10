import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

interface Entry {
  kind: string;
  tabId: number | null;
  build?: string;
  work?: Array<{ key: string; calls: number }>;
}

test('records a page load into extension storage while the performance log is on', async () => {
  const extensionPath = resolve(process.cwd(), '.output/chrome-mv3');
  const header = readFileSync(resolve(process.cwd(), 'tests/fixtures/pr-sticky-tabs/overview.html'), 'utf8');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  await context.route('https://github.com/acme/widgets/pull/42', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>${header}</body></html>` });
  });

  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(async () => {
      await browser.storage.local.set({ 'feature-flags': { 'perf-log': true } });
    });
    const stored = (): Promise<Entry[]> =>
      worker.evaluate(async () => ((await browser.storage.local.get('perf-log'))['perf-log'] ?? []) as Entry[]);

    const page = await context.newPage();
    await page.goto('https://github.com/acme/widgets/pull/42');
    await expect(page.locator('[data-ght-sticky-tabs="nav"]')).toHaveCount(1);
    // GitHub updating a tab count makes the sticky tabs sync, which the log times.
    await page.evaluate(() => {
      document.querySelector('#prs-commits-anchor-tab [data-component="CounterLabel"]')!.textContent = '3';
    });

    await expect
      .poll(
        async () =>
          (await stored())
            .filter((entry) => entry.kind === 'sample')
            .flatMap((entry) => entry.work ?? [])
            .map((stat) => stat.key),
        { timeout: 12_000 },
      )
      .toEqual(expect.arrayContaining(['pr-sticky-tabs observer', 'pr-sticky-tabs sync']));

    const entries = await stored();
    expect(entries.find((entry) => entry.kind === 'start')?.build).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof entries.find((entry) => entry.kind === 'sample')?.tabId).toBe('number');
  } finally {
    await context.close();
  }
});

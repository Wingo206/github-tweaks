import { resolve } from 'node:path';
import { chromium, expect, test, type Worker } from '@playwright/test';

const PR = 'https://github.com/acme/widgets/pull/42';
const REPO = 'https://github.com/acme/widgets';

interface TabState {
  url: string;
  grouped: boolean;
}

/** Opens a tab in the test window from the worker and waits for it to load. */
async function openTab(worker: Worker, url: string, active = false): Promise<number> {
  return worker.evaluate(
    async ({ url, active }) => {
      const [anchor] = await browser.tabs.query({ index: 0 });
      const tab = await browser.tabs.create({ windowId: anchor!.windowId, url, active });
      for (;;) {
        if ((await browser.tabs.get(tab.id!)).status === 'complete') {
          return tab.id!;
        }
        await new Promise((done) => setTimeout(done, 50));
      }
    },
    { url, active },
  );
}

async function tabStrip(worker: Worker): Promise<TabState[]> {
  return worker.evaluate(async () => {
    const [anchor] = await browser.tabs.query({ index: 0 });
    const tabs = await browser.tabs.query({ windowId: anchor!.windowId });
    return tabs.map((tab) => ({
      url: (tab.url ?? '').replace('https://github.com/acme/widgets', ''),
      grouped: tab.groupId !== -1,
    }));
  });
}

test('joins pull request tabs to their existing tab group, with Undo and Organize', async () => {
  const extensionPath = resolve(process.cwd(), '.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  await context.route(`${REPO}/**`, async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body><main>${new URL(route.request().url()).pathname}</main></body></html>`,
    });
  });
  await context.route(REPO, async (route) => {
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
  });

  try {
    const worker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    if (context.pages().length === 0) {
      await context.newPage();
    }

    const pr = await openTab(worker, PR);
    await openTab(worker, REPO);
    const groupId = await worker.evaluate(async (pr) => {
      const id = await browser.tabs.group({ tabIds: [pr] });
      await browser.tabGroups.update(id, { title: 'Reviews' });
      return id;
    }, pr);

    const filesPage = context.waitForEvent('page', (page) => page.url().endsWith('/files'));
    const files = await openTab(worker, `${PR}/files`, true);
    const groupOf = (tabId: number): Promise<number> =>
      worker.evaluate(async (tabId) => (await browser.tabs.get(tabId)).groupId, tabId);

    await expect.poll(() => groupOf(files)).toBe(groupId);
    expect(await tabStrip(worker)).toEqual([
      { url: '', grouped: false },
      { url: '/pull/42', grouped: true },
      { url: '/pull/42/files', grouped: true },
      { url: '', grouped: false },
    ]);

    const toast = (await filesPage).locator('[data-ght-tab-groups="toast"]');
    await expect(toast).toContainText('Added to the “Reviews” tab group');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(toast).toHaveText('Removed from the tab group');
    expect(await tabStrip(worker)).toEqual([
      { url: '', grouped: false },
      { url: '/pull/42', grouped: true },
      { url: '', grouped: false },
      { url: '/pull/42/files', grouped: false },
    ]);

    await worker.evaluate(async () => {
      await browser.storage.local.set({ 'feature-flags': { 'pr-tab-groups': false } });
    });
    await openTab(worker, `${PR}/checks`);
    const popupUrl = await worker.evaluate(() => browser.runtime.getURL('/popup.html'));
    const popupPage = context.waitForEvent('page', (page) => page.url() === popupUrl);
    await openTab(worker, popupUrl, true);
    const popup = await popupPage;

    expect((await tabStrip(worker)).filter((tab) => tab.grouped)).toHaveLength(1);
    await popup.getByRole('button', { name: 'Organize this window' }).click();
    await expect(popup.locator('#organize-status')).toHaveText('Moved 2 tabs into 1 group.');
    expect(await tabStrip(worker)).toEqual([
      { url: '', grouped: false },
      { url: '/pull/42', grouped: true },
      { url: '/pull/42/files', grouped: true },
      { url: '/pull/42/checks', grouped: true },
      { url: '', grouped: false },
      { url: '', grouped: false },
    ]);
  } finally {
    await context.close();
  }
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PrSidebarController } from './controller';
import type {
  BackgroundRequest,
  PullRequestFilesSnapshot,
} from '../../shared/types';

const pageFixture = [
  readFileSync(resolve(process.cwd(), 'tests/fixtures/sidebar.html'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'tests/fixtures/file-diff.html'), 'utf8'),
].join('');

const snapshot: PullRequestFilesSnapshot = {
  ref: { owner: 'acme', repository: 'widgets', number: 42 },
  pullRequestId: 'PR_1',
  headOid: 'head',
  savedAt: 1,
  files: [
    {
      path: 'src/index.ts',
      additions: 5,
      deletions: 2,
      viewedState: 'UNVIEWED',
    },
    {
      path: 'src/empty.png',
      additions: 0,
      deletions: 0,
      viewedState: 'VIEWED',
    },
  ],
};

describe('PR sidebar controller', () => {
  it('rolls back an optimistic Viewed update when GitHub rejects it', async () => {
    document.body.innerHTML = pageFixture;
    const sendMessage = vi.mocked(browser.runtime.sendMessage);
    sendMessage.mockImplementation(async (request: unknown) => {
      const typedRequest = request as BackgroundRequest;
      if (typedRequest.type === 'cache:get') {
        return { ok: true, data: snapshot };
      }
      if (typedRequest.type === 'pull:load') {
        return { ok: true, data: snapshot };
      }
      if (typedRequest.type === 'pull:set-viewed') {
        return { ok: false, error: 'Mutation denied.' };
      }
      return { ok: true };
    });

    const controller = new PrSidebarController(snapshot.ref);
    await controller.start();
    const checkbox = document
      .getElementById('src/index.ts')!
      .querySelector<HTMLInputElement>('input')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(checkbox.checked).toBe(false);
    expect(
      document
        .getElementById('src/index.ts')!
        .querySelector('.ght-pr-metadata')
        ?.classList.contains('ght-pr-metadata--error'),
    ).toBe(true);
    controller.stop();
  });

  it('mirrors native Viewed changes without issuing a duplicate mutation', async () => {
    document.body.innerHTML = pageFixture;
    const sendMessage = vi.mocked(browser.runtime.sendMessage);
    sendMessage.mockImplementation(async (request: unknown) => {
      const typedRequest = request as BackgroundRequest;
      if (typedRequest.type === 'cache:get') {
        return { ok: true, data: snapshot };
      }
      if (typedRequest.type === 'pull:load') {
        return { ok: true, data: snapshot };
      }
      return { ok: true };
    });

    const controller = new PrSidebarController(snapshot.ref);
    await controller.start();
    const nativeButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Not Viewed"]',
    )!;
    nativeButton.setAttribute('aria-pressed', 'true');
    nativeButton.setAttribute('aria-label', 'Viewed');
    nativeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(
      document
        .getElementById('src/index.ts')!
        .querySelector<HTMLInputElement>('input')?.checked,
    ).toBe(true);
    expect(
      sendMessage.mock.calls.some(
        ([request]) =>
          (request as unknown as BackgroundRequest).type ===
          'pull:set-viewed',
      ),
    ).toBe(false);
    controller.stop();
  });
});

async function settle(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 10));
  await Promise.resolve();
}

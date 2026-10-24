import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrSidebarController } from './controller';
import type {
  BackgroundRequest,
  PullRequestFilesSnapshot,
} from '../../shared/types';

function fixture(name: string): string {
  return readFileSync(resolve(process.cwd(), `tests/fixtures/${name}`), 'utf8');
}

const sidebarFixture = fixture('sidebar.html');
const diffFixture = fixture('file-diff.html');
const loadingDiffFixture = fixture('file-diff-loading.html');

const snapshot: PullRequestFilesSnapshot = {
  ref: { owner: 'acme', repository: 'widgets', number: 42 },
  selection: { kind: 'all' },
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

type SetViewedRequest = Extract<BackgroundRequest, { type: 'pull:set-viewed' }>;

type BackgroundResult = { ok: boolean; error?: string };

function mockBackground(
  setViewed: (
    request: SetViewedRequest,
  ) => BackgroundResult | Promise<BackgroundResult> = () => ({ ok: true }),
) {
  const sendMessage = vi.mocked(browser.runtime.sendMessage);
  sendMessage.mockImplementation(async (request: unknown) => {
    const typedRequest = request as BackgroundRequest;
    if (typedRequest.type === 'cache:get' || typedRequest.type === 'pull:load') {
      return { ok: true, data: snapshot };
    }
    if (typedRequest.type === 'pull:set-viewed') {
      return setViewed(typedRequest);
    }
    return { ok: true };
  });
  return () =>
    sendMessage.mock.calls
      .map(([request]) => request as unknown as BackgroundRequest)
      .filter((request): request is SetViewedRequest => request.type === 'pull:set-viewed');
}

/** Stands in for GitHub's React toggle on fixture Viewed buttons. */
function wireNativeButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-diff-header-wrapper] button[aria-pressed]',
  )) {
    button.addEventListener('click', () => {
      const viewed = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(viewed));
      button.setAttribute('aria-label', viewed ? 'Viewed' : 'Not Viewed');
    });
  }
}

function sidebarCheckbox(path: string): HTMLInputElement {
  return document
    .getElementById(path)!
    .querySelector<HTMLInputElement>('.ght-pr-metadata__viewed input')!;
}

function nativeButton(diffId: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    `#${diffId} [data-diff-header-wrapper] button[aria-pressed]`,
  );
}

const controllers: PrSidebarController[] = [];

function createController(): PrSidebarController {
  const controller = new PrSidebarController(snapshot.ref);
  controllers.push(controller);
  return controller;
}

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.stop());
});

describe('PR sidebar controller', () => {
  it('mirrors native Viewed changes in the sidebar checkbox', async () => {
    document.body.innerHTML = sidebarFixture + diffFixture;
    const setViewedCalls = mockBackground();

    const controller = createController();
    await controller.start();
    const button = nativeButton('diff-file-one')!;
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('aria-label', 'Viewed');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(sidebarCheckbox('src/index.ts').checked).toBe(true);
    expect(setViewedCalls()).toHaveLength(0);
  });

  it('clicks GitHub’s button for a loaded file instead of calling the API', async () => {
    document.body.innerHTML = sidebarFixture + diffFixture;
    wireNativeButtons();
    const setViewedCalls = mockBackground();

    const controller = createController();
    await controller.start();
    sidebarCheckbox('src/index.ts').click();
    await settle();

    expect(nativeButton('diff-file-one')?.getAttribute('aria-pressed')).toBe('true');
    expect(sidebarCheckbox('src/index.ts').checked).toBe(true);
    expect(setViewedCalls()).toHaveLength(0);
  });

  it('keeps a loaded file’s page state when the follow-up fetch is stale', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = sidebarFixture + diffFixture;
      wireNativeButtons();
      // pull:load keeps answering UNVIEWED, as the API does for ~1.5 s.
      mockBackground();

      const controller = createController();
      await controller.start();
      sidebarCheckbox('src/index.ts').click();
      await vi.advanceTimersByTimeAsync(2000);

      expect(vi.mocked(browser.runtime.sendMessage)).toHaveBeenCalledTimes(3);
      expect(nativeButton('diff-file-one')?.getAttribute('aria-pressed')).toBe('true');
      expect(sidebarCheckbox('src/index.ts').checked).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets an unloaded file through the API, then fixes GitHub’s stale button when it loads', async () => {
    document.body.innerHTML = sidebarFixture + loadingDiffFixture;
    const setViewedCalls = mockBackground();

    const controller = createController();
    await controller.start();
    expect(nativeButton('diff-file-one')).toBeNull();

    sidebarCheckbox('src/index.ts').click();
    await settle();

    expect(setViewedCalls()).toEqual([
      expect.objectContaining({
        pullRequestId: 'PR_1',
        path: 'src/index.ts',
        viewed: true,
      }),
    ]);
    expect(sidebarCheckbox('src/index.ts').checked).toBe(true);
    expect(
      document.querySelector('[id="src"] .ght-pr-metadata__progress')?.textContent,
    ).toBe('2/2');

    const loaded = new DOMParser()
      .parseFromString(diffFixture, 'text/html')
      .getElementById('diff-file-one')!;
    document.getElementById('diff-file-one')!.replaceWith(loaded);
    wireNativeButtons();
    expect(nativeButton('diff-file-one')?.getAttribute('aria-pressed')).toBe('false');
    await nextFrame();
    await settle();

    expect(nativeButton('diff-file-one')?.getAttribute('aria-pressed')).toBe('true');
    expect(sidebarCheckbox('src/index.ts').checked).toBe(true);
    expect(setViewedCalls()).toHaveLength(1);
  });

  it('uses the latest choice when the checkbox is toggled during a request', async () => {
    document.body.innerHTML = sidebarFixture + loadingDiffFixture;
    let release: () => void = () => {};
    const firstRequest = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setViewedCalls = mockBackground(async () => {
      if (setViewedCalls().length === 1) {
        await firstRequest;
      }
      return { ok: true };
    });

    const controller = createController();
    await controller.start();
    sidebarCheckbox('src/index.ts').click();
    sidebarCheckbox('src/index.ts').click();
    sidebarCheckbox('src/index.ts').click();
    expect(setViewedCalls()).toHaveLength(1);
    release();
    await settle();

    expect(setViewedCalls().map((request) => request.viewed)).toEqual([true, true]);
    expect(sidebarCheckbox('src/index.ts').checked).toBe(true);
  });

  it('rolls back and flags the row when the API call fails', async () => {
    document.body.innerHTML = sidebarFixture + loadingDiffFixture;
    mockBackground(() => ({ ok: false, error: 'Resource not accessible by personal access token' }));

    const controller = createController();
    await controller.start();
    sidebarCheckbox('src/index.ts').click();
    await settle();

    const checkbox = sidebarCheckbox('src/index.ts');
    expect(checkbox.checked).toBe(false);
    expect(checkbox.closest('.ght-pr-metadata')?.classList).toContain(
      'ght-pr-metadata--error',
    );
    expect(checkbox.parentElement?.title).toBe(
      'Resource not accessible by personal access token',
    );
  });

  it('stops retrying when GitHub ignores the click on a loaded button', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = sidebarFixture + diffFixture;
      const setViewedCalls = mockBackground();
      const clicks = vi.fn();
      nativeButton('diff-file-one')!.addEventListener('click', clicks);

      const controller = createController();
      await controller.start();
      sidebarCheckbox('src/index.ts').click();
      await vi.advanceTimersByTimeAsync(5000);

      expect(clicks).toHaveBeenCalledTimes(3);
      expect(setViewedCalls()).toHaveLength(0);
      const checkbox = sidebarCheckbox('src/index.ts');
      expect(checkbox.checked).toBe(false);
      expect(checkbox.parentElement?.title).toBe(
        'GitHub did not apply the Viewed change.',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

async function settle(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 10));
  await Promise.resolve();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

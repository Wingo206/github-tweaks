import { describe, expect, it, vi } from 'vitest';
import type { OpenRequest, OpenResponse } from '../../companion/src/protocol';
import { getCompanionStatus, openInCursor, saveCompanionSettings } from './client';

const request: OpenRequest = {
  repo: 'Acme/Widgets',
  path: 'src/a.ts',
  line: 3,
  column: 1,
  ref: null,
};

const launchUrl = 'cursor://vscode-remote/wsl+ubuntu/home/me/widgets';

type Step = OpenResponse | 'offline' | 401;

function mockServer(steps: Step[]) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const step = steps.length > 1 ? steps.shift()! : steps[0]!;
    if (step === 'offline') {
      throw new TypeError('Failed to fetch');
    }
    if (step === 401) {
      return new Response('{}', { status: 401 });
    }
    return new Response(JSON.stringify(step), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function deps() {
  let now = 0;
  return {
    openUrl: vi.fn(async () => undefined),
    sleep: vi.fn(async (ms: number) => {
      now += ms;
    }),
    now: () => now,
  };
}

async function pair(): Promise<void> {
  await saveCompanionSettings({ token: 'secret', port: 17999 });
}

describe('openInCursor', () => {
  it('requires a pairing token', async () => {
    const fetchMock = mockServer(['offline']);
    expect(await openInCursor(request, deps())).toMatchObject({
      status: 'failed',
      reason: 'not-paired',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the request with the token and maps opened', async () => {
    await pair();
    const fetchMock = mockServer([
      { status: 'opened', folder: '/home/me/widgets', matchedBranch: true, launchUrl },
    ]);
    expect(await openInCursor(request, deps())).toEqual({ status: 'opened' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:17999/open');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' });
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it('opens the launch URL once when the server asks', async () => {
    await pair();
    mockServer([{ status: 'launch', folder: '/home/me/widgets', launchUrl }]);
    const d = deps();
    expect(await openInCursor(request, d)).toEqual({ status: 'opened' });
    expect(d.openUrl).toHaveBeenCalledExactlyOnceWith(launchUrl);
  });

  it('reports offline without a cached launch URL', async () => {
    await pair();
    mockServer(['offline']);
    const d = deps();
    expect(await openInCursor(request, d)).toMatchObject({ reason: 'companion-offline' });
    expect(d.openUrl).not.toHaveBeenCalled();
  });

  it('launches the cached clone once and retries until opened', async () => {
    await pair();
    mockServer([{ status: 'opened', folder: '/home/me/widgets', matchedBranch: false, launchUrl }]);
    await openInCursor(request, deps());

    const fetchMock = mockServer([
      'offline',
      'offline',
      { status: 'launch', folder: '/home/me/widgets', launchUrl },
      { status: 'launching', folder: '/home/me/widgets' },
      { status: 'opened', folder: '/home/me/widgets', matchedBranch: false, launchUrl },
    ]);
    const d = deps();
    expect(await openInCursor(request, d)).toEqual({ status: 'opened' });
    expect(d.openUrl).toHaveBeenCalledExactlyOnceWith(launchUrl);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('ends the retry loop on terminal responses', async () => {
    await pair();
    mockServer([{ status: 'launch', folder: '/home/me/widgets', launchUrl }]);
    await openInCursor(request, deps());

    mockServer(['offline', { status: 'no-clone', repo: 'Acme/Widgets' }]);
    expect(await openInCursor(request, deps())).toMatchObject({ reason: 'no-clone' });

    mockServer(['offline', { status: 'error', reason: 'open-failed', message: 'gone' }]);
    expect(await openInCursor(request, deps())).toEqual({
      status: 'failed',
      reason: 'open-failed',
      message: 'gone',
    });
  });

  it('gives up after the retry budget', async () => {
    await pair();
    mockServer([{ status: 'launch', folder: '/home/me/widgets', launchUrl }]);
    await openInCursor(request, deps());

    const fetchMock = mockServer(['offline']);
    const d = deps();
    expect(await openInCursor(request, d)).toMatchObject({ reason: 'timeout' });
    expect(d.openUrl).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(30);
  });

  it('maps a rejected token to not-paired', async () => {
    await pair();
    mockServer([401]);
    expect(await openInCursor(request, deps())).toMatchObject({ reason: 'not-paired' });
  });
});

describe('getCompanionStatus', () => {
  it('reports each connection state', async () => {
    expect(await getCompanionStatus()).toEqual({ connected: false, reason: 'not-paired' });
    await pair();
    mockServer(['offline']);
    expect(await getCompanionStatus()).toEqual({ connected: false, reason: 'offline' });
    mockServer([401]);
    expect(await getCompanionStatus()).toEqual({ connected: false, reason: 'unauthorized' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true, version: '0.1.0', windows: 3 }))),
    );
    expect(await getCompanionStatus()).toEqual({ connected: true, version: '0.1.0', windows: 3 });
  });
});

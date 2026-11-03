import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKER } from './dom';
import { PrTabGroupsFeature } from './index';

const PR = 'https://github.com/acme/widgets/pull/42';
const sendMessage = vi.mocked(browser.runtime.sendMessage);

function respond(response: unknown): void {
  sendMessage.mockImplementation(async () => response);
}

function context(url: string): { url: URL } {
  return { url: new URL(url) };
}

function toast(): HTMLElement | null {
  return document.querySelector(`[${MARKER}="toast"]`);
}

describe('PrTabGroupsFeature', () => {
  beforeEach(() => sessionStorage.clear());

  it('matches pull request pages only', () => {
    const feature = new PrTabGroupsFeature();
    expect(feature.matches(context(`${PR}/files`))).toBe(true);
    expect(feature.matches(context('https://github.com/acme/widgets/pulls'))).toBe(false);
  });

  it('asks once per pull request and shows the join with Undo', async () => {
    respond({
      ok: true,
      data: { groupId: 7, groupTitle: 'Reviews', originalIndex: 3 },
    });
    const feature = new PrTabGroupsFeature();

    feature.start(context(PR));
    feature.update(context(`${PR}/files`));
    await vi.waitFor(() => expect(toast()).not.toBeNull());

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'tab-groups:auto-join', url: PR });

    respond({ ok: true });
    toast()!.querySelector('button')!.click();
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'tab-groups:undo',
      groupId: 7,
      originalIndex: 3,
    });
    feature.stop();
  });

  it('does not ask again for a pull request this tab already joined', async () => {
    respond({
      ok: true,
      data: { groupId: 7, groupTitle: '', originalIndex: 0 },
    });
    const first = new PrTabGroupsFeature();
    first.start(context(PR));
    await vi.waitFor(() => expect(toast()).not.toBeNull());
    first.stop();

    const reloaded = new PrTabGroupsFeature();
    reloaded.start(context(`${PR}/checks`));
    expect(sendMessage).toHaveBeenCalledOnce();
    reloaded.stop();
  });

  it('asks again for a different pull request', async () => {
    respond({ ok: true, data: null });
    const feature = new PrTabGroupsFeature();

    feature.start(context(PR));
    feature.update(context('https://github.com/acme/widgets/pull/43'));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));

    expect(toast()).toBeNull();
    feature.stop();
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StickyTabsController } from './controller';
import { MARKER } from './dom';

function fixture(path: string): string {
  return readFileSync(resolve(process.cwd(), `tests/fixtures/${path}.html`), 'utf8');
}

function stickyTab(label: string): HTMLAnchorElement {
  return [...document.querySelectorAll<HTMLAnchorElement>(`[${MARKER}="nav"] a`)].find(
    (link) => link.title === label,
  )!;
}

function nativeTab(href: string): HTMLAnchorElement {
  return document.querySelector<HTMLAnchorElement>(`nav[aria-label="Pull request"] a[href="${href}"]`)!;
}

function selectTab(href: string): void {
  document.querySelector('nav[aria-label="Pull request"] a[aria-current]')?.removeAttribute('aria-current');
  nativeTab(href).setAttribute('aria-current', 'page');
}

function click(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
}

async function nextFrame(): Promise<void> {
  await new Promise((done) => window.requestAnimationFrame(() => done(undefined)));
  await new Promise((done) => setTimeout(done, 0));
}

let controller: StickyTabsController | null = null;

afterEach(() => {
  controller?.stop();
  controller = null;
});

function start(html = fixture('pr-sticky-tabs/overview'), current?: string): void {
  document.body.innerHTML = html;
  if (current) {
    selectTab(current);
  }
  controller = new StickyTabsController();
  controller.start();
}

describe('StickyTabsController', () => {
  it('forwards a plain click to GitHub’s own tab link', () => {
    start(undefined, '/acme/widgets/pull/42/changes');
    const native = nativeTab('/acme/widgets/pull/42');
    const nativeClick = vi.fn((event: Event) => event.preventDefault());
    native.addEventListener('click', nativeClick);

    const event = click(stickyTab('Overview').querySelector('svg')!);
    expect(event.defaultPrevented).toBe(true);
    expect(nativeClick).toHaveBeenCalledTimes(1);
  });

  it('leaves modified and middle clicks to the browser', () => {
    start(undefined, '/acme/widgets/pull/42/changes');
    const nativeClick = vi.fn((event: Event) => event.preventDefault());
    nativeTab('/acme/widgets/pull/42').addEventListener('click', nativeClick);
    const leftAlone: boolean[] = [];
    const record = (event: Event): void => {
      leftAlone.push(!event.defaultPrevented);
      event.preventDefault();
    };
    document.addEventListener('click', record);

    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) {
      click(stickyTab('Overview'), init);
    }
    document.removeEventListener('click', record);
    expect(leftAlone).toEqual([true, true, true, true]);
    expect(nativeClick).not.toHaveBeenCalled();
  });

  it('scrolls to the top when the current tab is clicked', () => {
    start(undefined, '/acme/widgets/pull/42/changes');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const nativeClick = vi.fn();
    nativeTab('/acme/widgets/pull/42/changes').addEventListener('click', nativeClick);

    expect(click(stickyTab('Files changed')).defaultPrevented).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(nativeClick).not.toHaveBeenCalled();
  });

  it('follows GitHub when the current tab changes in-page', async () => {
    start();
    expect(stickyTab('Overview').getAttribute('aria-current')).toBe('page');

    selectTab('/acme/widgets/pull/42/changes');
    await nextFrame();

    expect(stickyTab('Overview').hasAttribute('aria-current')).toBe(false);
    expect(stickyTab('Files changed').getAttribute('aria-current')).toBe('page');
    expect(document.querySelectorAll(`[${MARKER}="nav"]`)).toHaveLength(1);
  });

  it('shows the line totals on Overview and follows GitHub’s updates', async () => {
    start();
    const lines = (): string | null =>
      document.querySelector(`[${MARKER}="nav"] .ght-pst-lines`)?.getAttribute('title') ?? null;
    expect(lines()).toBe('1,479 additions and 1 deletion');

    [...document.querySelectorAll('[data-component="PageHeader"] .sr-only')].find((label) =>
      label.textContent?.startsWith('Lines changed'),
    )!.textContent = 'Lines changed: 1500 additions & 1 deletion';
    await nextFrame();
    expect(lines()).toBe('1,500 additions and 1 deletion');
  });

  it('leaves the line totals off Files changed', () => {
    start(undefined, '/acme/widgets/pull/42/changes');
    expect(document.querySelectorAll(`[${MARKER}="nav"]`)).toHaveLength(1);
    expect(document.querySelector('.ght-pst-lines')).toBeNull();
  });

  it('removes its UI on stop and stops watching the page', async () => {
    start();
    controller!.stop();
    controller = null;
    expect(document.querySelectorAll(`[${MARKER}]`)).toHaveLength(0);

    selectTab('/acme/widgets/pull/42/commits');
    await nextFrame();
    expect(document.querySelectorAll(`[${MARKER}]`)).toHaveLength(0);
  });

  // TODO(classic-1): the classic sticky header.
  it('mirrors the classic tab bar into the classic sticky header', () => {
    start(fixture('classic/pr-sticky-tabs/conversation'));
    expect(stickyTab('Conversation').getAttribute('aria-current')).toBe('page');
  });
});

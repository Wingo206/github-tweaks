import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StickyTabsController } from './controller';
import { MARKER } from './dom';

function fixture(name: 'conversation' | 'files-changed'): string {
  return readFileSync(resolve(process.cwd(), `tests/fixtures/pr-sticky-tabs/${name}.html`), 'utf8');
}

function stickyTab(label: string): HTMLAnchorElement {
  return [...document.querySelectorAll<HTMLAnchorElement>(`[${MARKER}="nav"] a`)].find(
    (link) => link.title === label,
  )!;
}

function nativeTab(href: string): HTMLAnchorElement {
  return [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Pull request navigation tabs"] a')].find(
    (link) => link.getAttribute('href') === href,
  )!;
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

function start(name: 'conversation' | 'files-changed'): void {
  document.body.innerHTML = fixture(name);
  controller = new StickyTabsController();
  controller.start();
}

describe('StickyTabsController', () => {
  it('forwards a plain click to GitHub’s own tab link', () => {
    start('files-changed');
    const native = nativeTab('/acme/widgets/pull/42');
    const nativeClick = vi.fn((event: Event) => event.preventDefault());
    native.addEventListener('click', nativeClick);

    const event = click(stickyTab('Conversation').querySelector('svg')!);
    expect(event.defaultPrevented).toBe(true);
    expect(nativeClick).toHaveBeenCalledTimes(1);
  });

  it('leaves modified and middle clicks to the browser', () => {
    start('files-changed');
    const nativeClick = vi.fn((event: Event) => event.preventDefault());
    nativeTab('/acme/widgets/pull/42').addEventListener('click', nativeClick);
    const leftAlone: boolean[] = [];
    const record = (event: Event): void => {
      leftAlone.push(!event.defaultPrevented);
      event.preventDefault();
    };
    document.addEventListener('click', record);

    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) {
      click(stickyTab('Conversation'), init);
    }
    document.removeEventListener('click', record);
    expect(leftAlone).toEqual([true, true, true, true]);
    expect(nativeClick).not.toHaveBeenCalled();
  });

  it('scrolls to the top when the current tab is clicked', () => {
    start('files-changed');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const nativeClick = vi.fn();
    nativeTab('/acme/widgets/pull/42/changes').addEventListener('click', nativeClick);

    expect(click(stickyTab('Files changed')).defaultPrevented).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(nativeClick).not.toHaveBeenCalled();
  });

  it('follows GitHub when the current tab changes in-page', async () => {
    start('conversation');
    expect(stickyTab('Conversation').getAttribute('aria-current')).toBe('page');

    nativeTab('/acme/widgets/pull/42').removeAttribute('aria-current');
    nativeTab('/acme/widgets/pull/42/changes').setAttribute('aria-current', 'page');
    await nextFrame();

    expect(stickyTab('Conversation').hasAttribute('aria-current')).toBe(false);
    expect(stickyTab('Files changed').getAttribute('aria-current')).toBe('page');
    expect(document.querySelectorAll(`[${MARKER}="nav"]`)).toHaveLength(1);
  });

  it('shows the line totals on Conversation and follows GitHub’s updates', async () => {
    start('conversation');
    const lines = (): string | null =>
      document.querySelector(`[${MARKER}="nav"] .ght-pst-lines`)?.getAttribute('title') ?? null;
    expect(lines()).toBe('1,479 additions and 1 deletion');

    document.querySelector('[data-component="PH_Navigation"] .sr-only')!.textContent =
      'Lines changed: 1500 additions & 1 deletion';
    await nextFrame();
    expect(lines()).toBe('1,500 additions and 1 deletion');
  });

  it('leaves the line totals off Files changed', () => {
    start('files-changed');
    expect(document.querySelectorAll(`[${MARKER}="nav"]`)).toHaveLength(1);
    expect(document.querySelector('.ght-pst-lines')).toBeNull();
  });

  it('removes its UI on stop and stops watching the page', async () => {
    start('conversation');
    controller!.stop();
    controller = null;
    expect(document.querySelectorAll(`[${MARKER}]`)).toHaveLength(0);

    nativeTab('/acme/widgets/pull/42/commits').setAttribute('aria-current', 'page');
    await nextFrame();
    expect(document.querySelectorAll(`[${MARKER}]`)).toHaveLength(0);
  });
});

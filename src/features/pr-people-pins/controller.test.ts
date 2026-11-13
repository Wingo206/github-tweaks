import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundRequest, PinnedPerson } from '../../shared/types';
import { PeoplePinsController } from './controller';

const reviewersPanel = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/pr-people-pins/reviewers-panel.html'),
  'utf8',
);

const ref = { owner: 'acme', repository: 'widgets', number: 42 };
const ada: PinnedPerson = {
  id: '33',
  login: 'ada',
  name: 'Ada Lovelace',
  avatarUrl: 'https://avatars.githubusercontent.com/u/33?s=40&v=4',
};
const cara: PinnedPerson = {
  id: '11',
  login: 'cara',
  name: 'Cara Cole',
  avatarUrl: 'https://avatars.githubusercontent.com/u/11?s=40&v=4',
};

let controller: PeoplePinsController | null = null;
let stored: PinnedPerson[] = [];

afterEach(() => {
  controller?.stop();
  controller = null;
  vi.useRealTimers();
});

async function start(pins: PinnedPerson[]): Promise<void> {
  stored = pins;
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (request: unknown) => {
    const typed = request as BackgroundRequest;
    if (typed.type === 'pins:get') {
      return { ok: true, data: stored };
    }
    if (typed.type === 'pins:save') {
      stored = typed.people;
      return { ok: true, data: stored };
    }
    return { ok: false, error: 'unexpected' };
  });
  document.body.innerHTML = reviewersPanel;
  controller = new PeoplePinsController(ref);
  await controller.start();
}

function pinnedRow(login: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('.ght-pp__select')].find(
    (row) => row.querySelector('.ght-pp__login')?.textContent === login,
  )!;
}

function pinnedLogins(): string[] {
  return [...document.querySelectorAll('.ght-pp__login')].map((node) => node.textContent ?? '');
}

function input(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[aria-label="Filter reviewers"]')!;
}

async function settle(): Promise<void> {
  await new Promise((done) => setTimeout(done, 10));
  await new Promise((done) => window.requestAnimationFrame(() => done(undefined)));
}

describe('people pins controller', () => {
  it('shows stored pins in the open picker', async () => {
    await start([cara, ada]);
    expect(pinnedLogins()).toEqual(['ada', 'cara']);
    expect(document.querySelector('#rev-cara [aria-label="Unpin cara"]')).not.toBeNull();
    expect(document.querySelector('#rev-dana [aria-label="Pin dana"]')).not.toBeNull();
  });

  it('pins a person without selecting them, and saves the pin', async () => {
    await start([]);
    const optionClick = vi.fn();
    document.getElementById('rev-dana')!.addEventListener('click', optionClick);

    document.querySelector<HTMLButtonElement>('[aria-label="Pin dana"]')!.click();
    await settle();

    expect(optionClick).not.toHaveBeenCalled();
    expect(stored.map((person) => [person.id, person.login])).toEqual([['55', 'dana']]);
    expect(pinnedLogins()).toEqual(['dana']);
    expect(document.querySelector('#rev-dana [aria-label="Unpin dana"]')).not.toBeNull();
  });

  it('picks a listed pinned person through GitHub’s own option', async () => {
    await start([cara]);
    const optionClick = vi.fn();
    document.getElementById('rev-cara')!.addEventListener('click', optionClick);

    pinnedRow('cara').click();
    expect(optionClick).toHaveBeenCalledTimes(1);
  });

  it('searches for an unlisted pinned person, picks them, then restores the filter', async () => {
    await start([ada]);
    vi.useFakeTimers();
    input().addEventListener('input', () => {
      if (input().value === 'ada' && !document.getElementById('rev-ada')) {
        const option = document.getElementById('rev-dana')!.cloneNode(true) as HTMLElement;
        option.id = 'rev-ada';
        option.querySelector('img')!.setAttribute('src', ada.avatarUrl);
        option.querySelector('[data-component="ActionList.Item.Label"]')!.textContent = 'ada';
        setTimeout(() => document.querySelector('ul[aria-label="Everyone else"]')!.append(option), 300);
      }
    });

    const picked: string[] = [];
    document.querySelector('ul[role="listbox"]')!.addEventListener('click', (event) => {
      picked.push((event.target as Element).closest('li[role="option"]')?.id ?? '');
    });

    pinnedRow('ada').click();
    expect(input().value).toBe('ada');
    // This option never changes its checked state, so the filter comes back after the toggle timeout.
    await vi.advanceTimersByTimeAsync(1_500);

    expect(picked).toEqual(['rev-ada']);
    expect(input().value).toBe('');
  });

  it('keeps showing a searched-for person as picked after GitHub stops listing them', async () => {
    await start([ada, cara]);
    vi.useFakeTimers();
    // GitHub lists someone it doesn't suggest only while the filter finds them.
    input().addEventListener('input', () => {
      if (input().value === 'ada') {
        const option = document.getElementById('rev-dana')!.cloneNode(true) as HTMLElement;
        option.id = 'rev-ada';
        option.setAttribute('aria-selected', String(adaSelected));
        option.querySelector('img')!.setAttribute('src', ada.avatarUrl);
        option.querySelector('[data-component="ActionList.Item.Label"]')!.textContent = 'ada';
        option.addEventListener('click', () => {
          adaSelected = !adaSelected;
          option.setAttribute('aria-selected', String(adaSelected));
        });
        setTimeout(() => document.querySelector('ul[aria-label="Everyone else"]')!.append(option), 300);
      } else {
        document.getElementById('rev-ada')?.remove();
      }
    });
    let adaSelected = false;

    pinnedRow('ada').click();
    await vi.advanceTimersByTimeAsync(100);
    // The Pinned section keeps following what was typed, not the search.
    expect(pinnedLogins()).toEqual(['ada', 'cara']);
    pinnedRow('ada').click();
    await vi.advanceTimersByTimeAsync(600);

    expect(adaSelected).toBe(true);
    expect(document.getElementById('rev-ada')).toBeNull();
    expect(pinnedRow('ada').getAttribute('aria-pressed')).toBe('true');

    pinnedRow('ada').click();
    await vi.advanceTimersByTimeAsync(600);

    expect(adaSelected).toBe(false);
    expect(pinnedRow('ada').getAttribute('aria-pressed')).toBe('false');
  });

  it('filters pinned people with GitHub’s filter box', async () => {
    await start([ada, cara]);
    input().value = 'love';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(pinnedLogins()).toEqual(['ada']);
  });

  it('removes everything it added on stop', async () => {
    await start([ada]);
    controller!.stop();
    controller = null;
    expect(document.querySelectorAll('[data-ght-pp-pinned], [data-ght-pp-pin]')).toHaveLength(0);
  });
});

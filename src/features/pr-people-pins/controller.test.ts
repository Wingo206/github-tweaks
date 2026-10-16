import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PeoplePinsController } from './controller';
import type { BackgroundRequest, PinnedPerson } from '../../shared/types';

const fixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/people-pins.html'),
  'utf8',
);

const ref = { owner: 'Acme', repository: 'Widgets', number: 42 };
const ada: PinnedPerson = {
  id: '33',
  login: 'ada',
  name: 'Ada Lovelace',
  avatarUrl: 'https://avatars.githubusercontent.com/u/33?s=40&v=4',
};

describe('people pins controller', () => {
  it('loads repository pins and saves a newly pinned person', async () => {
    document.body.innerHTML = fixture;
    let people = [ada];
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (request: unknown) => {
      const typed = request as BackgroundRequest;
      if (typed.type === 'pins:get') {
        return { ok: true, data: people };
      }
      if (typed.type === 'pins:save') {
        people = typed.people;
        return { ok: true, data: people };
      }
      return { ok: true };
    });

    const controller = new PeoplePinsController(ref);
    await controller.start();

    expect(pinnedLogins(document.getElementById('reviewers-select-menu')!)).toEqual(['ada']);
    document.querySelector<HTMLButtonElement>('[aria-label="Pin ben"]')!.click();
    await settle();

    expect(people.map((person) => person.login)).toEqual(['ada', 'ben']);
    expect(pinnedLogins(document.getElementById('reviewers-select-menu')!)).toEqual([
      'ada',
      'ben',
    ]);
    expect(nativeInput('ben')?.checked).toBe(false);

    const filter = document.querySelector<HTMLInputElement>('#review-filter-field')!;
    filter.value = 'zzz';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('#reviewers-select-menu [data-ght-pins]')).toBeNull();

    controller.stop();
    expect(document.querySelector('[data-ght-pin-button]')).toBeNull();
  });

  it('still offers pin buttons when stored pins cannot be loaded', async () => {
    document.body.innerHTML = fixture;
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async () => ({
      ok: false,
      error: 'offline',
    }));

    const controller = new PeoplePinsController(ref);
    await controller.start();
    expect(document.querySelector('[aria-label="Pin ben"]')).not.toBeNull();
    controller.stop();
  });
});

function pinnedLogins(menu: ParentNode): string[] {
  return Array.from(
    menu.querySelectorAll('[data-ght-pinned-row] .js-username'),
    (node) => node.textContent ?? '',
  );
}

function nativeInput(login: string): HTMLInputElement | null {
  const label = Array.from(document.querySelectorAll<HTMLElement>('label.select-menu-item')).find(
    (row) =>
      !row.hasAttribute('data-ght-pinned-row') &&
      row.querySelector('.js-username')?.textContent === login,
  );
  return label?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 10));
  await Promise.resolve();
}

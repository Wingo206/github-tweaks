import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearPeoplePins, syncPeoplePins } from './dom';
import type { PinnedPerson } from '../../shared/types';

const fixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/people-pins.html'),
  'utf8',
);

const ada: PinnedPerson = {
  id: '33',
  login: 'ada',
  name: 'Ada Lovelace',
  avatarUrl: 'https://avatars.githubusercontent.com/u/33?s=40&v=4',
};
const ben: PinnedPerson = {
  id: '22',
  login: 'ben',
  name: 'Ben Adey',
  avatarUrl: 'https://avatars.githubusercontent.com/u/22?s=40&v=4',
};
const cara: PinnedPerson = {
  id: '11',
  login: 'cara',
  name: 'Cara Cole',
  avatarUrl: 'https://avatars.githubusercontent.com/u/11?s=40&v=4',
};
const erin: PinnedPerson = {
  id: '44',
  login: 'erin',
  name: 'Erin Ng',
  avatarUrl: '',
};
const pins = [ben, ada, erin, cara];

describe('people pin menu', () => {
  it('shows one alphabetical pinned group and hides the original person row', () => {
    document.body.innerHTML = fixture;
    syncPeoplePins(pins);
    syncPeoplePins(pins);

    const reviewers = document.getElementById('reviewers-select-menu')!;
    expect(reviewers.querySelectorAll('[data-ght-pins]')).toHaveLength(1);
    expect(pinnedLogins(reviewers)).toEqual(['ada', 'ben', 'cara', 'erin']);
    expect(nativeLabel('cara')?.hasAttribute('data-ght-pin-hidden')).toBe(true);
    expect(reviewers.querySelector('[data-ght-pinned-row][data-ght-person-id="11"]')?.getAttribute('aria-checked')).toBe('true');
    expect(pinnedInput('erin', reviewers)?.checked).toBe(true);
    expect(pinnedInput('ada', reviewers)?.name).toBe('reviewer_user_ids[]');
    const pinnedAvatar = reviewers.querySelector<HTMLImageElement>(
      '[data-ght-pinned-row] img.js-avatar',
    );
    expect(pinnedAvatar?.closest('.select-menu-item-gravatar')).not.toBeNull();
    expect(pinnedAvatar?.width).toBe(20);
    expect(pinnedAvatar?.height).toBe(20);
    expect(
      reviewers.querySelector('[data-ght-person-id="33"] .select-menu-item-heading')
        ?.textContent,
    ).toBe('ada Ada Lovelace');

    const assignees = document.getElementById('assignees-select-menu')!;
    expect(pinnedLogins(assignees)).toEqual(['ada', 'ben', 'cara', 'erin']);
    expect(nativeLabel('ada')?.hasAttribute('hidden')).toBe(true);
    expect(nativeLabel('ada')?.hasAttribute('data-ght-pin-hidden')).toBe(false);
    expect(pinnedInput('erin', assignees)?.checked).toBe(false);
    expect(pinnedInput('erin', assignees)?.name).toBe('issue[user_assignee_ids][]');
    expect(pinnedInput('ada', assignees)).toBeNull();

    const team = nativeLabel('acme/platform');
    expect(team?.querySelector('[data-ght-pin-button]')).toBeNull();
  });

  it('adds a pin button on person rows and removes every tweak on cleanup', () => {
    document.body.innerHTML = fixture;
    syncPeoplePins([]);

    const benButton = document.querySelector('[aria-label="Pin ben"]');
    expect(benButton).not.toBeNull();
    expect(nativeLabel('acme/platform')?.querySelector('[data-ght-pin-button]')).toBeNull();
    expect(document.querySelector('[data-ght-pins]')).toBeNull();

    syncPeoplePins([cara]);
    clearPeoplePins();

    expect(document.querySelector('[data-ght-pins]')).toBeNull();
    expect(document.querySelector('[data-ght-pin-button]')).toBeNull();
    expect(nativeLabel('cara')?.hasAttribute('hidden')).toBe(false);
  });

  it('hides pinned rows that do not match the menu filter', () => {
    document.body.innerHTML = fixture;
    syncPeoplePins(pins);
    const filter = document.querySelector<HTMLInputElement>('#review-filter-field')!;
    filter.value = 'cole';
    syncPeoplePins(pins);

    expect(pinnedLogins(document.getElementById('reviewers-select-menu')!)).toEqual(['cara']);
    expect(pinnedLogins(document.getElementById('assignees-select-menu')!)).toEqual([
      'ada',
      'ben',
      'cara',
      'erin',
    ]);

    filter.value = 'zzz';
    syncPeoplePins(pins);
    expect(document.querySelector('#reviewers-select-menu [data-ght-pins]')).toBeNull();
    expect(nativeLabel('cara')?.hasAttribute('hidden')).toBe(true);
    expect(nativeLabel('ben')?.hasAttribute('hidden')).toBe(true);
    expect(nativeLabel('acme/platform')?.hasAttribute('hidden')).toBe(false);
  });

  it('forwards a pinned row click to GitHub’s existing checkbox', () => {
    document.body.innerHTML = fixture;
    syncPeoplePins([cara]);
    const native = nativeLabel('cara')!;
    native.addEventListener('click', () => {
      native.setAttribute('aria-checked', 'false');
      const input = native.querySelector<HTMLInputElement>('input')!;
      input.checked = false;
    });

    const pinned = document.querySelector<HTMLElement>(
      '#reviewers-select-menu [data-ght-pinned-row]',
    )!;
    pinned.click();

    expect(pinned.getAttribute('aria-checked')).toBe('false');
    expect(native.querySelector('input')?.hasAttribute('disabled')).toBe(false);
  });
});

function pinnedLogins(menu: ParentNode): string[] {
  return Array.from(
    menu.querySelectorAll('[data-ght-pinned-row] .js-username'),
    (node) => node.textContent ?? '',
  );
}

function nativeLabel(login: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('label.select-menu-item')).find(
      (label) =>
        !label.hasAttribute('data-ght-pinned-row') &&
        label.querySelector('.js-username')?.textContent === login,
    ) ?? null
  );
}

function pinnedInput(login: string, menu: ParentNode): HTMLInputElement | null {
  const row = Array.from(menu.querySelectorAll<HTMLElement>('[data-ght-pinned-row]')).find(
    (label) => label.querySelector('.js-username')?.textContent === login,
  );
  return row?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
}

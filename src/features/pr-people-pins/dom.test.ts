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
    expect(reviewers.querySelector('[data-ght-pins]')?.parentElement?.hasAttribute('data-filterable-for')).toBe(true);
    expect(pinnedLogins(reviewers)).toEqual(['ada', 'ben', 'cara', 'erin']);
    expect(reviewers.querySelectorAll('input[value="11"]')).toHaveLength(1);
    const caraInput = reviewers.querySelector<HTMLInputElement>('input[value="11"]')!;
    expect(caraInput.closest('[data-ght-pinned-row]')).not.toBeNull();
    expect(caraInput.checked).toBe(true);
    expect(caraInput.disabled).toBe(false);
    expect(caraInput.closest('[data-ght-pinned-row]')?.getAttribute('aria-checked')).toBe('true');
    expect(pinnedInput('erin', reviewers)?.checked).toBe(true);
    expect(pinnedInput('erin', reviewers)?.defaultChecked).toBe(true);
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
    expect(assignees.querySelectorAll('input[value="33"]')).toHaveLength(1);
    const adaRow = assignees.querySelector('input[value="33"]')!.closest('label')!;
    expect(adaRow.hasAttribute('data-ght-pinned-row')).toBe(true);
    expect(adaRow.hasAttribute('hidden')).toBe(false);
    expect(pinnedInput('ada', assignees)?.name).toBe('issue[user_assignee_ids][]');
    expect(pinnedInput('erin', assignees)?.checked).toBe(false);
    expect(pinnedInput('erin', assignees)?.name).toBe('issue[user_assignee_ids][]');

    const team = nativeLabel('acme/platform');
    expect(team?.querySelector('[data-ght-pin-button]')).toBeNull();
  });

  it('leaves rows in place when nothing changed so hover state survives', () => {
    document.body.innerHTML = fixture;
    syncPeoplePins(pins);

    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { childList: true, subtree: true });
    syncPeoplePins(pins);
    const records = observer.takeRecords();
    observer.disconnect();

    expect(records).toHaveLength(0);
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
    expect(labelFor('cara')?.hasAttribute('hidden')).toBe(true);
    expect(labelFor('ben')?.hasAttribute('hidden')).toBe(true);
    expect(nativeLabel('acme/platform')?.hasAttribute('hidden')).toBe(false);
  });

  it('drops a pinned person from the form when their duplicate row stays checked', () => {
    document.body.innerHTML = fixture;
    syncPeoplePins([cara]);
    const reviewers = document.getElementById('reviewers-select-menu')!;
    const filterable = reviewers.querySelector('[data-filterable-for]')!;
    const duplicate = document.createElement('label');
    duplicate.className = 'select-menu-item text-normal';
    duplicate.innerHTML =
      '<input type="checkbox" name="reviewer_user_ids[]" value="11" checked><span class="js-username">cara</span>';
    filterable.append(duplicate);
    syncPeoplePins([cara]);

    const pinned = reviewers.querySelector<HTMLInputElement>('[data-ght-pinned-row] input')!;
    const duplicateInput = duplicate.querySelector<HTMLInputElement>('input')!;
    expect(duplicate.hidden).toBe(true);
    expect(duplicateInput.disabled).toBe(true);
    expect(pinned.disabled).toBe(false);
    expect(pinned.checked).toBe(true);

    pinned.closest('label')!.click();

    expect(pinned.checked).toBe(false);
    const form = pinned.form;
    expect(form).not.toBeNull();
    expect(new FormData(form!).getAll('reviewer_user_ids[]')).not.toContain('11');
  });

  it('toggles the real checkbox when a pinned person is clicked', () => {
    document.body.innerHTML = fixture;
    syncPeoplePins([cara]);
    const reviewers = document.getElementById('reviewers-select-menu')!;
    expect(reviewers.querySelectorAll('input[value="11"]')).toHaveLength(1);

    const pinned = reviewers.querySelector<HTMLElement>('[data-ght-pinned-row]')!;
    const input = pinned.querySelector<HTMLInputElement>('input')!;
    expect(input.checked).toBe(true);
    const changes: boolean[] = [];
    input.addEventListener('change', () => {
      changes.push(input.checked);
    });

    pinned.click();

    expect(input.checked).toBe(false);
    expect(changes).toEqual([false]);
    expect(input.disabled).toBe(false);
  });
});

function pinnedLogins(menu: ParentNode): string[] {
  return Array.from(
    menu.querySelectorAll('[data-ght-pinned-row]:not([hidden]) .js-username'),
    (node) => node.textContent ?? '',
  );
}

function labelFor(login: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('label.select-menu-item')).find(
      (label) => label.querySelector('.js-username')?.textContent === login,
    ) ?? null
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

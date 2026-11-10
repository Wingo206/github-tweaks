import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PinnedPerson } from '../../shared/types';
import {
  clearPeoplePins,
  findOption,
  findPeoplePanels,
  personFromButton,
  PIN_BUTTON_ATTRIBUTE,
  readPersonOptions,
  setFilterQuery,
  syncPinButtons,
  syncPinnedSection,
} from './dom';

function fixture(name: 'reviewers-panel' | 'assignees-panel'): string {
  return readFileSync(resolve(process.cwd(), `tests/fixtures/pr-people-pins/${name}.html`), 'utf8');
}

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

function panel() {
  return findPeoplePanels(document)[0]!;
}

describe('findPeoplePanels', () => {
  it.each(['reviewers-panel', 'assignees-panel'] as const)('finds the open %s by its filter box', (name) => {
    document.body.innerHTML = fixture(name);
    const panels = findPeoplePanels(document);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.root.getAttribute('data-component')).toBe('SelectPanel');
    expect(panels[0]!.header.contains(panels[0]!.input)).toBe(true);
  });

  it('ignores other pickers', () => {
    document.body.innerHTML = fixture('reviewers-panel').replace('Filter reviewers', 'Filter labels');
    expect(findPeoplePanels(document)).toEqual([]);
  });
});

describe('readPersonOptions', () => {
  it('reads reviewer options, with the name from the label, and skips apps', () => {
    document.body.innerHTML = fixture('reviewers-panel');
    expect(readPersonOptions(panel()).map(({ person, selected }) => [person.id, person.login, person.name, selected])).toEqual([
      ['11', 'cara', 'Cara Cole', false],
      ['22', 'ben', 'Ben Adey', true],
      ['55', 'dana', '', false],
    ]);
  });

  it('reads assignee options, with the name from the inline description', () => {
    document.body.innerHTML = fixture('assignees-panel');
    expect(readPersonOptions(panel()).map(({ person, selected }) => [person.id, person.login, person.name, selected])).toEqual([
      ['22', 'ben', '', true],
      ['33', 'ada', 'Ada Lovelace', false],
    ]);
    expect(findOption(panel(), 'ADA')?.id).toBe('asg-ada');
    expect(findOption(panel(), 'erin')).toBeNull();
  });
});

describe('syncPinButtons', () => {
  it('adds one pin toggle to each person option, idempotently', () => {
    document.body.innerHTML = fixture('reviewers-panel');
    syncPinButtons(readPersonOptions(panel()), [ben]);
    syncPinButtons(readPersonOptions(panel()), [ben]);

    const buttons = [...document.querySelectorAll<HTMLButtonElement>(`[${PIN_BUTTON_ATTRIBUTE}]`)];
    expect(buttons.map((button) => [button.parentElement!.id, button.getAttribute('aria-label'), button.getAttribute('aria-pressed')])).toEqual([
      ['rev-cara', 'Pin cara', 'false'],
      ['rev-ben', 'Unpin ben', 'true'],
      ['rev-dana', 'Pin dana', 'false'],
    ]);
    expect(personFromButton(buttons[1]!)).toEqual({
      id: '22',
      login: 'ben',
      name: 'Ben Adey',
      avatarUrl: 'https://avatars.githubusercontent.com/u/22?s=40&v=4',
    });
  });
});

describe('syncPinnedSection', () => {
  it('lists pinned people right after the filter box, with their selected state', () => {
    document.body.innerHTML = fixture('reviewers-panel');
    syncPinnedSection(panel(), [
      { person: ada, selected: false },
      { person: ben, selected: true },
    ]);

    const section = panel().header.nextElementSibling!;
    expect(section.getAttribute('aria-label')).toBe('Pinned');
    const rows = [...section.querySelectorAll('.ght-pp__select')];
    expect(rows.map((row) => [row.querySelector('.ght-pp__login')?.textContent, row.getAttribute('aria-pressed')])).toEqual([
      ['ada', 'false'],
      ['ben', 'true'],
    ]);
    expect(personFromButton(rows[0] as HTMLElement)?.login).toBe('ada');
    expect(section.querySelectorAll(`[${PIN_BUTTON_ATTRIBUTE}][aria-pressed="true"]`)).toHaveLength(2);
  });

  it('keeps the same rows when nothing changed, and removes the section when empty', () => {
    document.body.innerHTML = fixture('reviewers-panel');
    syncPinnedSection(panel(), [{ person: ada, selected: false }]);
    const row = document.querySelector('.ght-pp__row');
    syncPinnedSection(panel(), [{ person: ada, selected: false }]);
    expect(document.querySelector('.ght-pp__row')).toBe(row);

    syncPinnedSection(panel(), [{ person: ada, selected: true }]);
    expect(document.querySelector('.ght-pp__row')).not.toBe(row);

    syncPinnedSection(panel(), []);
    expect(document.querySelector('[data-ght-pp-pinned]')).toBeNull();
  });

  it('cleans up everything it added', () => {
    document.body.innerHTML = fixture('reviewers-panel');
    syncPinButtons(readPersonOptions(panel()), [ada]);
    syncPinnedSection(panel(), [{ person: ada, selected: false }]);
    clearPeoplePins();
    expect(document.querySelectorAll('[data-ght-pp-pinned], [data-ght-pp-pin]')).toHaveLength(0);
  });
});

describe('setFilterQuery', () => {
  it('sets the filter box and tells GitHub it changed', () => {
    document.body.innerHTML = fixture('reviewers-panel');
    const onInput = vi.fn();
    panel().input.addEventListener('input', onInput);
    setFilterQuery(panel().input, 'ada');
    expect(panel().input.value).toBe('ada');
    expect(onInput).toHaveBeenCalledTimes(1);
  });
});

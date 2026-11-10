import type { PinnedPerson } from '../../shared/types';
import { isPinned, loginKey, userIdFromAvatar } from './model';

export const PIN_BUTTON_ATTRIBUTE = 'data-ght-pp-pin';
export const PIN_SELECT_ATTRIBUTE = 'data-ght-pp-select';
const SECTION_ATTRIBUTE = 'data-ght-pp-pinned';
const KEY_ATTRIBUTE = 'data-ght-pp-key';
const SVG_NS = 'http://www.w3.org/2000/svg';
const LOGIN_PATTERN = /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i;

const FILTER_INPUTS = 'input[aria-label="Filter reviewers"], input[aria-label="Filter assignees"]';

/** GitHub's Reviewers or Assignees picker (a Primer SelectPanel) while it is open. */
export interface PeoplePanel {
  root: HTMLElement;
  input: HTMLInputElement;
  /** The filter box's row; the Pinned section goes right after it. */
  header: HTMLElement;
}

export interface PersonOption {
  option: HTMLElement;
  person: PinnedPerson;
  selected: boolean;
}

export interface PinnedRow {
  person: PinnedPerson;
  selected: boolean;
}

export function findPeoplePanels(root: ParentNode = document): PeoplePanel[] {
  return [...root.querySelectorAll<HTMLInputElement>(FILTER_INPUTS)].flatMap((input) => {
    const panel = input.closest<HTMLElement>('[data-component="SelectPanel"]');
    const header = input.closest<HTMLElement>('[data-component="FilteredActionList.Header"]');
    return panel && header ? [{ root: panel, input, header }] : [];
  });
}

export function findPanelFor(element: Element): PeoplePanel | null {
  const root = element.closest('[data-component="SelectPanel"]');
  return findPeoplePanels(document).find((panel) => panel.root === root) ?? null;
}

/** GitHub's own option rows for people, leaving out apps, bots, and teams. */
export function readPersonOptions(panel: PeoplePanel): PersonOption[] {
  return [...panel.root.querySelectorAll<HTMLElement>('li[role="option"]')].flatMap((option) => {
    const person = readOption(option);
    return person ? [{ option, person, selected: option.getAttribute('aria-selected') === 'true' }] : [];
  });
}

/**
 * Reviewer options put the name inside the label after the login; assignee
 * options put it in an inline description.
 */
export function readOption(option: Element): PinnedPerson | null {
  const label = option.querySelector('[data-component="ActionList.Item.Label"]');
  const avatarUrl = option.querySelector('img')?.getAttribute('src') ?? '';
  const id = userIdFromAvatar(avatarUrl);
  if (!label || !id) {
    return null;
  }
  const [login, nameInLabel] = textsOf(label);
  if (!login || !LOGIN_PATTERN.test(login)) {
    return null;
  }
  const inlineName = option
    .querySelector('[data-description-variant="inline"] [data-component="ActionList.Description"]')
    ?.textContent?.trim();
  return { id, login, name: nameInLabel ?? inlineName ?? '', avatarUrl };
}

export function findOption(panel: PeoplePanel, login: string): HTMLElement | null {
  const key = loginKey(login);
  return readPersonOptions(panel).find(({ person }) => loginKey(person.login) === key)?.option ?? null;
}

/** Adds a pin toggle to each person option, or updates the one already there. */
export function syncPinButtons(options: readonly PersonOption[], pins: readonly PinnedPerson[]): void {
  for (const { option, person } of options) {
    let button = option.querySelector<HTMLButtonElement>(`:scope > [${PIN_BUTTON_ATTRIBUTE}]`);
    if (!button) {
      button = createPinButton();
      option.append(button);
    }
    renderPinButton(button, person, isPinned(pins, person.login));
  }
}

/** The Pinned section between the filter box and GitHub's list; removed when empty. */
export function syncPinnedSection(panel: PeoplePanel, rows: readonly PinnedRow[]): void {
  let section = panel.root.querySelector<HTMLElement>(`[${SECTION_ATTRIBUTE}]`);
  if (rows.length === 0) {
    section?.remove();
    return;
  }

  if (!section) {
    section = document.createElement('div');
    section.className = 'ght-pp';
    section.setAttribute(SECTION_ATTRIBUTE, '');
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', 'Pinned');
    const heading = document.createElement('div');
    heading.className = 'ght-pp__heading';
    heading.setAttribute('aria-hidden', 'true');
    heading.textContent = 'Pinned';
    const list = document.createElement('div');
    list.className = 'ght-pp__list';
    section.append(heading, list);
  }
  if (section.previousElementSibling !== panel.header) {
    panel.header.after(section);
  }

  const key = JSON.stringify(rows.map(({ person, selected }) => [person.login, person.name, person.avatarUrl, selected]));
  if (section.getAttribute(KEY_ATTRIBUTE) === key) {
    return;
  }
  section.setAttribute(KEY_ATTRIBUTE, key);
  section.querySelector('.ght-pp__list')!.replaceChildren(...rows.map(createPinnedRow));
}

export function clearPeoplePins(root: ParentNode = document): void {
  root.querySelectorAll(`[${SECTION_ATTRIBUTE}], [${PIN_BUTTON_ATTRIBUTE}]`).forEach((node) => node.remove());
}

/** The person a pin or Pinned-row button stands for. */
export function personFromButton(button: HTMLElement): PinnedPerson | null {
  const { ghtPpPersonId: id, ghtPpPersonLogin: login } = button.dataset;
  if (!id || !login) {
    return null;
  }
  return {
    id,
    login,
    name: button.dataset.ghtPpPersonName ?? '',
    avatarUrl: button.dataset.ghtPpPersonAvatar ?? '',
  };
}

/**
 * Types into GitHub's filter box the way a person would, so its React state
 * and search follow.
 */
export function setFilterQuery(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function createPinnedRow({ person, selected }: PinnedRow): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ght-pp__row';

  const select = document.createElement('button');
  select.type = 'button';
  select.className = 'ght-pp__select';
  select.setAttribute(PIN_SELECT_ATTRIBUTE, '');
  select.setAttribute('aria-pressed', String(selected));
  setPerson(select, person);

  const check = document.createElement('span');
  check.className = 'ght-pp__check';
  check.setAttribute('aria-hidden', 'true');
  check.append(icon('M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z'));
  select.append(check);

  const avatar = document.createElement('img');
  avatar.className = 'ght-pp__avatar';
  avatar.alt = '';
  avatar.width = 16;
  avatar.height = 16;
  if (userIdFromAvatar(person.avatarUrl)) {
    avatar.src = person.avatarUrl;
  }
  const login = document.createElement('span');
  login.className = 'ght-pp__login';
  login.textContent = person.login;
  select.append(avatar, login);
  if (person.name) {
    const name = document.createElement('span');
    name.className = 'ght-pp__name';
    name.textContent = person.name;
    select.append(name);
  }

  const pin = createPinButton();
  renderPinButton(pin, person, true);
  row.append(select, pin);
  return row;
}

function createPinButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ght-pp__button';
  button.tabIndex = -1;
  button.setAttribute(PIN_BUTTON_ATTRIBUTE, '');
  button.append(
    icon(
      'm11.294.984 3.722 3.722a1.75 1.75 0 0 1-.504 2.826l-1.327.613a3.089 3.089 0 0 0-1.707 2.084l-.584 2.454c-.317 1.332-1.972 1.8-2.94.832L5.75 11.311 1.78 15.28a.749.749 0 1 1-1.06-1.06l3.969-3.97-2.204-2.204c-.968-.968-.5-2.623.832-2.94l2.454-.584a3.08 3.08 0 0 0 2.084-1.707l.613-1.327a1.75 1.75 0 0 1 2.826-.504ZM6.283 9.723l2.732 2.731a.25.25 0 0 0 .42-.119l.584-2.454a4.586 4.586 0 0 1 2.537-3.098l1.328-.613a.25.25 0 0 0 .072-.404l-3.722-3.722a.25.25 0 0 0-.404.072l-.613 1.328a4.584 4.584 0 0 1-3.098 2.537l-2.454.584a.25.25 0 0 0-.119.42l2.731 2.732Z',
    ),
  );
  return button;
}

function renderPinButton(button: HTMLButtonElement, person: PinnedPerson, pinned: boolean): void {
  setPerson(button, person);
  setAttributeIfChanged(button, 'aria-pressed', String(pinned));
  setAttributeIfChanged(button, 'aria-label', `${pinned ? 'Unpin' : 'Pin'} ${person.login}`);
}

function setPerson(button: HTMLElement, person: PinnedPerson): void {
  setAttributeIfChanged(button, 'data-ght-pp-person-id', person.id);
  setAttributeIfChanged(button, 'data-ght-pp-person-login', person.login);
  setAttributeIfChanged(button, 'data-ght-pp-person-name', person.name);
  setAttributeIfChanged(button, 'data-ght-pp-person-avatar', person.avatarUrl);
}

function setAttributeIfChanged(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function textsOf(element: Element): string[] {
  const texts: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) {
      texts.push(text);
    }
  }
  return texts;
}

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('class', 'octicon');
  const element = document.createElementNS(SVG_NS, 'path');
  element.setAttribute('d', path);
  svg.append(element);
  return svg;
}

import type { PinnedPerson } from '../../shared/types';
import { isUserCheckboxName, visiblePins } from './model';

const MENU_IDS = ['reviewers-select-menu', 'assignees-select-menu'] as const;
const SVG_NS = 'http://www.w3.org/2000/svg';

export function syncPeoplePins(
  pins: readonly PinnedPerson[],
  root: ParentNode = document,
): void {
  for (const menu of findPeopleMenus(root)) {
    syncMenu(menu, pins);
  }
}

export function clearPeoplePins(root: ParentNode = document): void {
  if (root instanceof HTMLElement) {
    restoreDuplicateCheckboxes(root);
  } else {
    for (const menu of findPeopleMenus(root)) {
      restoreDuplicateCheckboxes(menu);
    }
  }
  for (const label of root.querySelectorAll<HTMLElement>('[data-ght-pinned-row]')) {
    const filterable = label
      .closest('.select-menu-list')
      ?.querySelector<HTMLElement>('[data-filterable-for]');
    releaseLabel(label, filterable ?? null);
  }
  root.querySelectorAll('[data-ght-pins]').forEach((node) => node.remove());
  root.querySelectorAll('[data-ght-pin-button]').forEach((node) => node.remove());
}

export function readPerson(label: HTMLElement): PinnedPerson | null {
  const storedId = label.dataset.ghtPersonId;
  const storedLogin = label.dataset.ghtPersonLogin;
  if (storedId && storedLogin) {
    return {
      id: storedId,
      login: storedLogin,
      name: label.dataset.ghtPersonName ?? '',
      avatarUrl: label.dataset.ghtPersonAvatar ?? '',
    };
  }

  const input = label.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!input || !isUserCheckboxName(input.name) || !input.value) {
    return null;
  }

  const login = label.querySelector('.js-username')?.textContent?.trim() ?? '';
  if (!login) {
    return null;
  }

  return {
    id: input.value,
    login,
    name: label.querySelector('.js-description')?.textContent?.trim() ?? '',
    avatarUrl: avatarFrom(label.querySelector('img')?.getAttribute('src') ?? ''),
  };
}

function findPeopleMenus(root: ParentNode): HTMLElement[] {
  const menus: HTMLElement[] = [];
  for (const id of MENU_IDS) {
    const menu = root.querySelector<HTMLElement>(`#${id}`);
    if (menu) {
      menus.push(menu);
    }
  }
  return menus;
}

function syncMenu(menu: HTMLElement, pins: readonly PinnedPerson[]): void {
  const list = menu.querySelector('.select-menu-list');
  const checkboxName = userCheckboxName(menu);
  if (!list || !checkboxName) {
    return;
  }

  const filterable = list.querySelector<HTMLElement>('[data-filterable-for]');
  restoreDuplicateCheckboxes(menu);
  const pinnedIds = new Set(pins.map((person) => person.id));
  const query =
    menu.querySelector<HTMLInputElement>('input.js-filterable-field')?.value ?? '';
  const showing = new Set(visiblePins(pins, query).map((person) => person.id));
  const labelsById = personLabels(menu);

  for (const label of labelsById.values()) {
    const person = readPerson(label);
    if (!person || pinnedIds.has(person.id)) {
      continue;
    }
    if (isManagedLabel(label)) {
      releaseLabel(label, filterable);
    }
    ensurePinButton(label, person, false);
  }

  const section = showing.size > 0 ? ensurePinSection(list, filterable) : null;
  if (!section) {
    menu.querySelector('[data-ght-pins]')?.remove();
  }

  let previousShown: Element | null = section?.firstElementChild ?? null;
  for (const person of visiblePins(pins, '')) {
    let label = labelsById.get(person.id) ?? null;
    if (!label) {
      label = createPinnedRow(
        person,
        checkboxName,
        selectedLogins(menu).has(person.login.toLowerCase()),
      );
      label.setAttribute('data-ght-pin-created', '');
    } else if (!label.hasAttribute('data-ght-pin-created')) {
      rememberHiddenState(label);
    }

    label.setAttribute('data-ght-pinned-row', '');
    ensurePinButton(label, person, true);
    if (showing.has(person.id) && section) {
      label.removeAttribute('hidden');
      if (label.parentElement !== section || label.previousElementSibling !== previousShown) {
        section.insertBefore(label, previousShown?.nextSibling ?? null);
      }
      previousShown = label;
    } else {
      label.setAttribute('hidden', '');
      if (filterable && label.parentElement !== filterable) {
        filterable.append(label);
      }
    }
  }

  suppressDuplicateCheckboxes(menu, pinnedIds);
}

function ensurePinSection(
  list: Element,
  filterable: HTMLElement | null,
): HTMLElement {
  const parent = filterable ?? list;
  let section = parent.querySelector<HTMLElement>(':scope > [data-ght-pins]');
  if (!section) {
    section = document.createElement('div');
    section.setAttribute('data-ght-pins', '');
    const divider = document.createElement('div');
    divider.className = 'select-menu-divider';
    divider.textContent = 'Pinned';
    section.append(divider);
  }

  const template = parent.querySelector(':scope > template');
  if (template) {
    if (section.nextElementSibling !== template) {
      parent.insertBefore(section, template);
    }
  } else if (section.parentElement !== parent) {
    parent.prepend(section);
  }
  return section;
}

function personLabels(menu: HTMLElement): Map<string, HTMLLabelElement> {
  const labels = new Map<string, HTMLLabelElement>();
  for (const label of menu.querySelectorAll<HTMLLabelElement>('label.select-menu-item')) {
    const person = readPerson(label);
    if (!person || labels.has(person.id)) {
      continue;
    }
    labels.set(person.id, label);
  }
  return labels;
}

function isManagedLabel(label: HTMLElement): boolean {
  return (
    label.hasAttribute('data-ght-pinned-row') ||
    label.hasAttribute('data-ght-pin-moved') ||
    label.hasAttribute('data-ght-pin-created')
  );
}

function rememberHiddenState(label: HTMLElement): void {
  if (label.hasAttribute('data-ght-pin-moved')) {
    return;
  }
  label.setAttribute('data-ght-pin-moved', '');
  if (label.hasAttribute('hidden')) {
    label.setAttribute('data-ght-was-hidden', '');
  }
}

function suppressDuplicateCheckboxes(menu: HTMLElement, pinnedIds: ReadonlySet<string>): void {
  const labels = Array.from(menu.querySelectorAll<HTMLLabelElement>('label.select-menu-item'));
  labels.sort((left, right) => Number(!left.hasAttribute('data-ght-pinned-row')) - Number(!right.hasAttribute('data-ght-pinned-row')));
  const seen = new Set<string>();

  for (const label of labels) {
    const person = readPerson(label);
    if (!person || !pinnedIds.has(person.id)) {
      continue;
    }
    const input = label.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!input || !isUserCheckboxName(input.name)) {
      continue;
    }

    if (!seen.has(person.id)) {
      seen.add(person.id);
      if (label.hasAttribute('data-ght-pinned-row')) {
        input.disabled = false;
        input.removeAttribute('data-ght-pin-disabled');
      }
      continue;
    }

    input.disabled = true;
    input.setAttribute('data-ght-pin-disabled', '');
    if (!label.hasAttribute('data-ght-pinned-row')) {
      label.setAttribute('hidden', '');
      label.setAttribute('data-ght-pin-duplicate', '');
    }
  }
}

function restoreDuplicateCheckboxes(menu: HTMLElement): void {
  for (const input of menu.querySelectorAll<HTMLInputElement>('input[data-ght-pin-disabled]')) {
    input.disabled = false;
    input.removeAttribute('data-ght-pin-disabled');
  }
  for (const label of menu.querySelectorAll<HTMLElement>('[data-ght-pin-duplicate]')) {
    label.removeAttribute('hidden');
    label.removeAttribute('data-ght-pin-duplicate');
  }
}

function releaseLabel(label: HTMLElement, filterable: HTMLElement | null): void {
  label.removeAttribute('data-ght-pinned-row');
  if (label.hasAttribute('data-ght-pin-created')) {
    label.remove();
    return;
  }

  label.removeAttribute('data-ght-pin-moved');
  if (label.hasAttribute('data-ght-was-hidden')) {
    label.setAttribute('hidden', '');
    label.removeAttribute('data-ght-was-hidden');
  } else {
    label.removeAttribute('hidden');
  }
  filterable?.append(label);
}

function createPinnedRow(
  person: PinnedPerson,
  checkboxName: string,
  checked: boolean,
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'select-menu-item text-normal';
  label.setAttribute('role', 'menuitemcheckbox');
  label.setAttribute('aria-checked', checked ? 'true' : 'false');
  label.tabIndex = 0;
  label.dataset.ghtPersonId = person.id;
  label.dataset.ghtPersonLogin = person.login;
  label.dataset.ghtPersonName = person.name;
  label.dataset.ghtPersonAvatar = person.avatarUrl;

  label.append(checkIcon());
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = checkboxName;
  input.value = person.id;
  input.defaultChecked = checked;
  input.checked = checked;
  input.style.display = 'none';
  label.append(input);

  const gravatar = document.createElement('div');
  gravatar.className = 'select-menu-item-gravatar';
  const avatar = document.createElement('img');
  avatar.alt = '';
  avatar.className = 'avatar-small mr-1 js-avatar avatar avatar-user';
  avatar.width = 20;
  avatar.height = 20;
  avatar.setAttribute('size', '20');
  const src = avatarFrom(person.avatarUrl);
  if (src) {
    avatar.src = src;
  }
  gravatar.append(avatar);
  label.append(gravatar);

  const text = document.createElement('span');
  text.className = 'select-menu-item-text lh-condensed';
  const heading = document.createElement('span');
  heading.className = 'select-menu-item-heading';
  const login = document.createElement('span');
  login.className = 'js-username';
  login.textContent = person.login;
  const name = document.createElement('span');
  name.className = 'description js-description';
  name.textContent = person.name;
  heading.append(login);
  if (person.name) {
    heading.append(document.createTextNode(' '), name);
  }
  text.append(heading);
  label.append(text);
  ensurePinButton(label, person, true);
  return label;
}

function ensurePinButton(
  label: HTMLElement,
  person: PinnedPerson,
  pinned: boolean,
): void {
  let button = label.querySelector<HTMLButtonElement>('[data-ght-pin-button]');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'ght-pins__button';
    button.setAttribute('data-ght-pin-button', '');
    button.append(pinIcon());
    label.append(button);
  }

  button.setAttribute('aria-pressed', pinned ? 'true' : 'false');
  button.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${person.login}`);
}

function selectedLogins(menu: HTMLElement): Set<string> {
  const scope = menu.closest('form') ?? menu;
  const logins = new Set<string>();
  for (const node of scope.querySelectorAll<HTMLElement>('[data-assignee-name]')) {
    const login = node.getAttribute('data-assignee-name');
    if (login) {
      logins.add(login.toLowerCase());
    }
  }
  return logins;
}

function userCheckboxName(menu: HTMLElement): string | null {
  const selector =
    'input[name="reviewer_user_ids[]"], input[name="issue[user_assignee_ids][]"]';
  const input = menu.querySelector<HTMLInputElement>(selector);
  if (input) {
    return input.name;
  }

  const templateInput = menu
    .querySelector('template')
    ?.content.querySelector<HTMLInputElement>(selector);
  return templateInput?.name ?? null;
}

function avatarFrom(url: string): string {
  if (url.startsWith('https://')) {
    return url;
  }
  return '';
}

function checkIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('class', 'octicon octicon-check select-menu-item-icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute(
    'd',
    'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z',
  );
  svg.append(path);
  return svg;
}

function pinIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('class', 'octicon octicon-pin');
  svg.setAttribute('fill', 'currentColor');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute(
    'd',
    'm11.294.984 3.722 3.722a1.75 1.75 0 0 1-.504 2.826l-1.327.613a3.089 3.089 0 0 0-1.707 2.084l-.584 2.454c-.317 1.332-1.972 1.8-2.94.832L5.75 11.311 1.78 15.28a.749.749 0 1 1-1.06-1.06l3.969-3.97-2.204-2.204c-.968-.968-.5-2.623.832-2.94l2.454-.584a3.08 3.08 0 0 0 2.084-1.707l.613-1.327a1.75 1.75 0 0 1 2.826-.504ZM6.283 9.723l2.732 2.731a.25.25 0 0 0 .42-.119l.584-2.454a4.586 4.586 0 0 1 2.537-3.098l1.328-.613a.25.25 0 0 0 .072-.404l-3.722-3.722a.25.25 0 0 0-.404.072l-.613 1.328a4.584 4.584 0 0 1-3.098 2.537l-2.454.584a.25.25 0 0 0-.119.42l2.731 2.732Z',
  );
  svg.append(path);
  return svg;
}

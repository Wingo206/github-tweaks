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
  for (const label of root.querySelectorAll<HTMLElement>('[data-ght-pin-hidden]')) {
    label.removeAttribute('hidden');
    label.removeAttribute('data-ght-pin-hidden');
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
  restoreSuppressed(menu);
  menu.querySelector('[data-ght-pins]')?.remove();

  const natives = nativePersonLabels(menu);
  const pinnedIds = new Set(pins.map((person) => person.id));
  for (const label of natives) {
    const person = readPerson(label);
    if (!person) {
      continue;
    }
    ensurePinButton(label, person, pinnedIds.has(person.id));
  }

  for (const label of natives) {
    const person = readPerson(label);
    if (person && pinnedIds.has(person.id)) {
      suppressNative(label);
    }
  }

  const list = menu.querySelector('.select-menu-list');
  const checkboxName = userCheckboxName(menu);
  if (!list || !checkboxName) {
    return;
  }

  const query = menu.querySelector<HTMLInputElement>('input.js-filterable-field')?.value ?? '';
  const showing = visiblePins(pins, query);
  if (showing.length === 0) {
    return;
  }

  const selected = selectedLogins(menu);
  const section = document.createElement('div');
  section.setAttribute('data-ght-pins', '');
  const divider = document.createElement('div');
  divider.className = 'select-menu-divider';
  divider.textContent = 'Pinned';
  section.append(divider);

  for (const person of showing) {
    const native = natives.find((label) => readPerson(label)?.id === person.id) ?? null;
    section.append(createPinnedRow(person, checkboxName, native, selected));
  }

  const filterable = list.querySelector('[data-filterable-for]');
  if (filterable) {
    list.insertBefore(section, filterable);
  } else {
    list.prepend(section);
  }
}

function createPinnedRow(
  person: PinnedPerson,
  checkboxName: string,
  native: HTMLLabelElement | null,
  selected: Set<string>,
): HTMLLabelElement {
  const checked = native
    ? nativeChecked(native)
    : selected.has(person.login.toLowerCase());
  const label = document.createElement('label');
  label.className = 'select-menu-item text-normal';
  label.setAttribute('role', 'menuitemcheckbox');
  label.setAttribute('aria-checked', checked ? 'true' : 'false');
  label.tabIndex = 0;
  label.setAttribute('data-ght-pinned-row', '');
  label.dataset.ghtPersonId = person.id;
  label.dataset.ghtPersonLogin = person.login;
  label.dataset.ghtPersonName = person.name;
  label.dataset.ghtPersonAvatar = person.avatarUrl;

  label.append(checkIcon());
  if (!native) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = checkboxName;
    input.value = person.id;
    input.checked = checked;
    input.style.display = 'none';
    label.append(input);
  } else {
    label.addEventListener('click', (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-ght-pin-button]')) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      native.click();
      label.setAttribute(
        'aria-checked',
        nativeChecked(native) ? 'true' : 'false',
      );
    });
  }

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

function nativePersonLabels(menu: HTMLElement): HTMLLabelElement[] {
  return Array.from(
    menu.querySelectorAll<HTMLLabelElement>('label.select-menu-item'),
  ).filter(
    (label) => !label.closest('[data-ght-pins]') && readPerson(label) !== null,
  );
}

function suppressNative(label: HTMLLabelElement): void {
  if (!label.hasAttribute('hidden')) {
    label.setAttribute('hidden', '');
    label.setAttribute('data-ght-pin-hidden', '');
  }
}

function restoreSuppressed(menu: HTMLElement): void {
  for (const label of menu.querySelectorAll<HTMLElement>('[data-ght-pin-hidden]')) {
    label.removeAttribute('hidden');
    label.removeAttribute('data-ght-pin-hidden');
  }
}

function nativeChecked(label: HTMLElement): boolean {
  const input = label.querySelector<HTMLInputElement>('input[type="checkbox"]');
  return input?.checked === true || label.getAttribute('aria-checked') === 'true';
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

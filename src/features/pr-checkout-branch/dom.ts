import type { MenuEntry } from './model';

export const MARKER = 'data-ght-checkout-branch';
export const ACCESSIBLE_NAME = 'Check out branch locally';

const COPY_HEAD_LABEL = 'Copy head branch name to clipboard';

const CHECKOUT_ICON =
  '<svg aria-hidden="true" focusable="false" class="octicon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="m4.927 5.427 2.896 2.896a.25.25 0 0 0 .354 0l2.896-2.896A.25.25 0 0 0 10.896 5H8.75V.75a.75.75 0 1 0-1.5 0V5H5.104a.25.25 0 0 0-.177.427Z"></path><path d="M1.573 2.573a.25.25 0 0 0-.073.177v7.5a.25.25 0 0 0 .25.25h12.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-3a.75.75 0 1 1 0-1.5h3A1.75 1.75 0 0 1 16 2.75v7.5A1.75 1.75 0 0 1 14.25 12h-3.727c.099 1.041.52 1.872 1.292 2.757A.75.75 0 0 1 11.25 16h-6.5a.75.75 0 0 1-.565-1.243c.772-.885 1.192-1.716 1.292-2.757H1.75A1.75 1.75 0 0 1 0 10.25v-7.5A1.75 1.75 0 0 1 1.75 1h3a.75.75 0 0 1 0 1.5h-3a.25.25 0 0 0-.177.073ZM6.982 12a5.72 5.72 0 0 1-.765 2.5h3.566a5.72 5.72 0 0 1-.765-2.5H6.982Z"></path></svg>';
const CHECK_ICON =
  '<svg aria-hidden="true" focusable="false" class="octicon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';

export interface HeadBranchMount {
  /** The copy button's tooltip (or the button itself); ours goes after it. */
  anchor: Element;
  link: HTMLAnchorElement;
}

/** Head branch rows, found through GitHub's "Copy head branch name" control. */
export function findHeadBranchMounts(root: ParentNode): HeadBranchMount[] {
  const anchors = [
    ...root.querySelectorAll(`[data-component="Tooltip"][aria-label="${COPY_HEAD_LABEL}"]`),
    ...root.querySelectorAll(`button[aria-label="${COPY_HEAD_LABEL}"]`),
  ];
  return anchors.flatMap((anchor) => {
    const link = anchor.parentElement?.querySelector<HTMLAnchorElement>('a[data-component="BranchName"]');
    return link ? [{ anchor, link }] : [];
  });
}

/** Inserts a button after each mount's anchor once; returns every button in `root`. */
export function syncButtons(root: ParentNode, create: () => HTMLButtonElement): HTMLButtonElement[] {
  for (const { anchor } of findHeadBranchMounts(root)) {
    if (!anchor.parentElement?.querySelector(`[${MARKER}="button"]`)) {
      anchor.after(create());
    }
  }
  return [...root.querySelectorAll<HTMLButtonElement>(`button[${MARKER}="button"]`)];
}

export function createButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'Button Button--invisible Button--small ght-cob-button';
  button.setAttribute(MARKER, 'button');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  renderButton(button, []);
  return button;
}

/** Icon only, or a check and the clone names when the branch is checked out. */
export function renderButton(button: HTMLButtonElement, checkedOutIn: readonly string[]): void {
  const label = checkedOutIn.length ? `Checked out in ${checkedOutIn.join(', ')}` : ACCESSIBLE_NAME;
  if (button.title === label && button.childElementCount > 0) {
    return;
  }
  button.title = label;
  button.setAttribute('aria-label', label);
  button.dataset.ghtCobState = checkedOutIn.length ? 'checked-out' : 'idle';
  button.innerHTML = checkedOutIn.length ? CHECK_ICON : CHECKOUT_ICON;
  if (checkedOutIn.length) {
    const text = document.createElement('span');
    text.className = 'ght-cob-button-label';
    text.textContent = checkedOutIn.join(', ');
    button.append(text);
  }
}

// ---------------------------------------------------------------------------
// Menu

export interface MenuView {
  branch: string;
  repo: string;
  phase: 'loading' | 'ready' | 'failed';
  entries: MenuEntry[];
  /** Path of the entry whose action is in flight. */
  busyPath: string | null;
  message: { text: string; tone: 'info' | 'error' } | null;
}

export function createMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'ght-cob-menu';
  menu.setAttribute(MARKER, 'menu');
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', ACCESSIBLE_NAME);
  menu.tabIndex = -1;
  return menu;
}

/** Places the menu below `button`, kept inside the viewport. */
export function positionMenu(menu: HTMLElement, button: Element): void {
  const rect = button.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 16);
  menu.style.width = `${width}px`;
  menu.style.top = `${Math.round(rect.bottom + 4)}px`;
  menu.style.left = `${Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)))}px`;
}

export function renderMenu(
  menu: HTMLElement,
  view: MenuView,
  onSelect: (entry: MenuEntry) => void,
): void {
  const focusedPath = (document.activeElement as HTMLElement | null)?.closest?.('[data-path]')?.getAttribute('data-path');
  menu.replaceChildren();

  const header = document.createElement('div');
  header.className = 'ght-cob-menu-header';
  const branch = document.createElement('code');
  branch.textContent = view.branch;
  header.append('Check out ', branch);
  menu.append(header);

  if (view.phase === 'loading' && view.entries.length === 0) {
    menu.append(note('Looking for open clones…', 'info'));
  } else if (view.phase === 'ready' && view.entries.length === 0) {
    menu.append(note(`No Cursor window has ${view.repo} open. Open a clone in Cursor first.`, 'info'));
  }

  if (view.entries.length) {
    const list = document.createElement('div');
    list.className = 'ght-cob-list';
    for (const entry of view.entries) {
      list.append(createItem(entry, view.busyPath, onSelect));
    }
    menu.append(list);
  }

  if (view.message) {
    menu.append(note(view.message.text, view.message.tone));
  }

  if (focusedPath) {
    menu.querySelector<HTMLElement>(`[data-path="${CSS.escape(focusedPath)}"]`)?.focus();
  }
}

function createItem(
  entry: MenuEntry,
  busyPath: string | null,
  onSelect: (entry: MenuEntry) => void,
): HTMLButtonElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'ght-cob-item';
  item.dataset.ghtCobState = entry.state;
  item.dataset.path = entry.path;
  item.title = entry.path;
  const busy = busyPath === entry.path;
  item.disabled = busyPath !== null;
  item.setAttribute('aria-busy', String(busy));

  const name = document.createElement('span');
  name.className = 'ght-cob-item-name';
  name.textContent = entry.name;
  const detail = document.createElement('span');
  detail.className = 'ght-cob-item-detail';
  detail.textContent = entry.detail;
  const action = document.createElement('span');
  action.className = 'ght-cob-item-action';
  action.textContent = busy ? 'Starting…' : entry.action === 'checkout' ? 'Check out' : 'Focus window';

  item.append(name, action, detail);
  item.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!item.disabled) {
      onSelect(entry);
    }
  });
  return item;
}

function note(text: string, tone: 'info' | 'error'): HTMLElement {
  const element = document.createElement('div');
  element.className = 'ght-cob-note';
  element.dataset.tone = tone;
  element.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  element.textContent = text;
  return element;
}

export function clearCheckoutUi(root: ParentNode = document): void {
  root.querySelectorAll(`[${MARKER}]`).forEach((element) => element.remove());
}

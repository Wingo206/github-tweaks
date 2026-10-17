import type { OpenResult, OpenTarget, PullRequestRef } from '../../shared/types';
import {
  describeFailure,
  parseBlobLocation,
  parseCommentElementId,
  parseMenuLineLabel,
  parseThreadHeadingLine,
  readEmbeddedBlobInfo,
  type EmbeddedBlobInfo,
} from './model';

export const MARKER = 'data-ght-open-in-cursor';
export const ACCESSIBLE_NAME = 'Open in Cursor';

export type Opener = (target: OpenTarget) => Promise<OpenResult>;
export type ControlState = 'idle' | 'working' | 'opened' | 'failed';

export interface RecordedDiffCell {
  side: 'left' | 'right';
  line: number;
  path: string;
}

const OPENED_MS = 1_500;
const FAILED_MS = 5_000;

const FILE_SECTION_SELECTOR = '[role="region"][id^="diff-"]';
const HEADER_SELECTOR = '[data-diff-header-wrapper="true"]';
const LINE_CELL_SELECTOR = 'td[data-line-number][data-diff-side]';
const RIGHT_CELL_SELECTOR = 'td[data-diff-side="right"][data-line-number]';

const OPEN_ICON =
  '<svg aria-hidden="true" focusable="false" class="octicon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"></path></svg>';
const CHECK_ICON =
  '<svg aria-hidden="true" focusable="false" class="octicon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';
const SPINNER = '<span class="ght-oic-spinner" aria-hidden="true"></span>';

const resetTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Controls

function createIconButton(surface: string, variant: 'invisible' | 'secondary'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `Button Button--iconOnly Button--${variant} Button--small ght-oic-button`;
  button.setAttribute(MARKER, surface);
  button.setAttribute('aria-label', ACCESSIBLE_NAME);
  button.title = ACCESSIBLE_NAME;
  button.innerHTML = OPEN_ICON;
  return button;
}

export function setControlState(button: HTMLButtonElement, state: ControlState, message?: string): void {
  button.dataset.ghtOicState = state;
  button.disabled = state === 'working';
  button.setAttribute('aria-busy', String(state === 'working'));
  button.innerHTML = state === 'working' ? SPINNER : state === 'opened' ? CHECK_ICON : OPEN_ICON;
  button.title = state === 'opened' ? 'Opened in Cursor' : ACCESSIBLE_NAME;

  let note = button.nextElementSibling;
  if (!(note instanceof HTMLElement) || note.getAttribute(MARKER) !== 'message') {
    note = null;
  }
  if (state === 'failed' && message) {
    if (!note) {
      note = document.createElement('span');
      note.className = 'ght-oic-message';
      note.setAttribute(MARKER, 'message');
      note.setAttribute('role', 'alert');
      button.after(note);
    }
    note.textContent = message;
  } else {
    note?.remove();
  }
}

function bindButton(
  button: HTMLButtonElement,
  getTarget: () => OpenTarget | null,
  open: Opener,
): void {
  const stop = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  button.addEventListener('mousedown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => {
    stop(event);
    if (button.disabled) {
      return;
    }
    const target = getTarget();
    if (!target) {
      return;
    }
    clearTimeout(resetTimers.get(button));
    setControlState(button, 'working');
    void runOpen(open, target).then((result) => {
      if (result.status === 'opened') {
        setControlState(button, 'opened');
        resetTimers.set(button, setTimeout(() => setControlState(button, 'idle'), OPENED_MS));
      } else {
        setControlState(button, 'failed', describeFailure(result));
        resetTimers.set(button, setTimeout(() => setControlState(button, 'idle'), FAILED_MS));
      }
    });
  });
}

async function runOpen(open: Opener, target: OpenTarget): Promise<OpenResult> {
  try {
    return await open(target);
  } catch (error) {
    return {
      status: 'failed',
      reason: 'open-failed',
      message: error instanceof Error ? error.message : 'The extension failed.',
    };
  }
}

/** Fixed-position feedback for actions started from menus that close on click. */
export function showToast(text: string, state: ControlState): void {
  let toast = document.querySelector<HTMLElement>(`[${MARKER}="toast"]`);
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'ght-oic-toast';
    toast.setAttribute(MARKER, 'toast');
    toast.setAttribute('role', 'status');
    document.body.append(toast);
  }
  toast.textContent = text;
  toast.dataset.ghtOicState = state;
  toast.hidden = false;
  clearTimeout(resetTimers.get(toast));
  if (state !== 'working') {
    const element = toast;
    resetTimers.set(
      toast,
      setTimeout(() => element.remove(), state === 'failed' ? FAILED_MS : OPENED_MS),
    );
  }
}

/**
 * Builds a menu item mirroring a sibling Primer ActionList item. Class names
 * are copied from the live sibling at runtime rather than hard-coded.
 */
function createMenuItem(menu: HTMLElement, surface: string): HTMLLIElement {
  const sample = menu.querySelector<HTMLElement>('li[role="menuitem"]');
  const sampleContent = sample?.firstElementChild;
  const sampleSpacer = sampleContent?.firstElementChild;
  const sampleVisual = menu.querySelector('[data-component="ActionList.LeadingVisual"]');
  const sampleSubContent = sample?.querySelector('[data-component="ActionList.Item--DividerContainer"]');
  const sampleLabel = sample?.querySelector('[data-component="ActionList.Item.Label"]');

  const item = document.createElement('li');
  item.setAttribute('role', 'menuitem');
  item.tabIndex = -1;
  item.className = `${sample?.className ?? ''} ght-oic-menu-item`.trim();
  item.setAttribute('data-component', 'ActionList.Item');
  item.setAttribute(MARKER, surface);
  item.setAttribute('aria-label', ACCESSIBLE_NAME);

  const content = document.createElement('div');
  content.className = sampleContent?.className ?? '';
  content.setAttribute('data-size', 'medium');
  if (sampleSpacer && !sampleSpacer.hasAttribute('data-component')) {
    const spacer = document.createElement('span');
    spacer.className = sampleSpacer.className;
    content.append(spacer);
  }
  if (sampleVisual) {
    const visual = document.createElement('span');
    visual.className = sampleVisual.className;
    visual.setAttribute('data-component', 'ActionList.LeadingVisual');
    visual.innerHTML = OPEN_ICON;
    content.append(visual);
  }
  const subContent = document.createElement('span');
  subContent.className = sampleSubContent?.className ?? '';
  const label = document.createElement('span');
  label.className = sampleLabel?.className ?? '';
  label.textContent = ACCESSIBLE_NAME;
  subContent.append(label);
  content.append(subContent);
  item.append(content);
  return item;
}

function bindMenuItem(
  item: HTMLElement,
  menu: HTMLElement,
  getTarget: () => OpenTarget | null,
  open: Opener,
): void {
  const activate = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const target = getTarget();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (!target) {
      return;
    }
    showToast('Opening in Cursor…', 'working');
    void runOpen(open, target).then((result) => {
      if (result.status === 'opened') {
        showToast('Opened in Cursor', 'opened');
      } else {
        showToast(describeFailure(result), 'failed');
      }
    });
  };
  item.addEventListener('click', activate);
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      activate(event);
    }
  });
}

function insertMenuItemAfter(menu: HTMLElement, item: HTMLElement, label: string): void {
  const anchor = Array.from(menu.querySelectorAll('[data-component="ActionList.Item.Label"]'))
    .find((element) => element.textContent?.trim() === label)
    ?.closest('li');
  if (anchor && anchor.parentElement === menu) {
    anchor.after(item);
  } else {
    menu.append(item);
  }
}

export function clearOpenInCursorUi(root: ParentNode = document): void {
  root.querySelectorAll(`[${MARKER}]`).forEach((element) => element.remove());
}

// ---------------------------------------------------------------------------
// Pull request changes tab: file headers and line cells

export function filePathForHeader(header: Element): string | null {
  const explicit = header.querySelector<HTMLElement>('[data-file-path]')?.dataset.filePath;
  if (explicit) {
    return explicit;
  }
  const text = header
    .querySelector('h3 a[href^="#diff-"] code')
    ?.textContent?.replace(/[\u200e\u200f]/g, '')
    .trim();
  return text || null;
}

export function filePathForElement(element: Element): string | null {
  const header = element.closest(FILE_SECTION_SELECTOR)?.querySelector(HEADER_SELECTOR);
  return header ? filePathForHeader(header) : null;
}

/** Rendered cells exist but none on the right side: the file was deleted. */
export function isDeletedFile(section: Element): boolean {
  return (
    section.querySelector(LINE_CELL_SELECTOR) !== null &&
    section.querySelector(RIGHT_CELL_SELECTOR) === null
  );
}

export function firstChangedLine(section: Element): number {
  const cells = Array.from(section.querySelectorAll<HTMLElement>(RIGHT_CELL_SELECTOR));
  const addition = cells.find((cell) => cell.querySelector('code.addition'));
  const line = Number((addition ?? cells[0])?.dataset.lineNumber);
  return Number.isInteger(line) && line >= 1 ? line : 1;
}

function findViewedButton(header: Element): HTMLButtonElement | null {
  return (
    Array.from(header.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')).find((button) =>
      button.textContent?.includes('Viewed'),
    ) ?? null
  );
}

export function syncFileHeaders(root: ParentNode, ref: PullRequestRef, open: Opener): void {
  for (const section of root.querySelectorAll(FILE_SECTION_SELECTOR)) {
    const header = section.querySelector(HEADER_SELECTOR);
    if (!header || !filePathForHeader(header)) {
      continue;
    }
    const existing = header.querySelector<HTMLButtonElement>(`[${MARKER}="file-header"]`);
    if (isDeletedFile(section)) {
      if (existing) {
        setControlState(existing, 'idle');
        existing.remove();
      }
      continue;
    }
    if (existing) {
      continue;
    }
    const viewed = findViewedButton(header);
    const container = viewed?.parentElement ?? header.firstElementChild ?? header;
    const button = createIconButton('file-header', 'invisible');
    bindButton(
      button,
      () => {
        const path = filePathForHeader(header);
        return path
          ? { kind: 'pr-line', ...ref, path, line: firstChangedLine(section) }
          : null;
      },
      open,
    );
    if (viewed) {
      viewed.before(button);
    } else {
      container.append(button);
    }
  }
}

/** Reads the line cell whose "More actions" button was clicked, if any. */
export function recordDiffCell(target: EventTarget | null): RecordedDiffCell | null | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }
  const button = target.closest('button[aria-label="More actions"][aria-haspopup="true"]');
  if (!button) {
    return undefined;
  }
  const cell = button.closest<HTMLElement>(LINE_CELL_SELECTOR);
  const side = cell?.dataset.diffSide;
  const line = Number(cell?.dataset.lineNumber);
  const path = cell ? filePathForElement(cell) : null;
  if (!cell || (side !== 'left' && side !== 'right') || !Number.isInteger(line) || !path) {
    return null;
  }
  return { side, line, path };
}

export function syncDiffLineMenu(
  menu: HTMLElement,
  cell: RecordedDiffCell | null,
  ref: PullRequestRef,
  open: Opener,
): void {
  const label = Array.from(menu.querySelectorAll('[data-component="ActionList.Item.Label"]'))
    .map((element) => parseMenuLineLabel(element.textContent ?? ''))
    .find((parsed) => parsed !== null);
  const existing = menu.querySelector<HTMLElement>(`[${MARKER}="diff-line-menu"]`);
  const key = cell ? `${cell.path}:${cell.side}:${cell.line}` : '';
  const matches = !!label && !!cell && label.side === cell.side && label.line === cell.line;
  if (existing) {
    if (matches && existing.dataset.ghtOicKey === key) {
      return;
    }
    existing.remove();
  }
  if (!matches || !cell) {
    return;
  }
  const item = createMenuItem(menu, 'diff-line-menu');
  item.dataset.ghtOicKey = key;
  bindMenuItem(
    item,
    menu,
    () => ({ kind: 'pr-line', ...ref, path: cell.path, line: cell.line }),
    open,
  );
  insertMenuItemAfter(menu, item, 'Copy link');
}

// ---------------------------------------------------------------------------
// Review threads

export function syncChangesThreads(root: ParentNode, ref: PullRequestRef, open: Opener): void {
  for (const thread of root.querySelectorAll<HTMLElement>('[data-marker-id]')) {
    const heading = Array.from(thread.querySelectorAll('h2')).find((element) =>
      /^Comment on lines?\b/.test(element.textContent?.trim() ?? ''),
    );
    const row = heading?.parentElement;
    if (!heading || !row || row.querySelector(`[${MARKER}="changes-thread"]`)) {
      continue;
    }
    const commentId = Array.from(thread.querySelectorAll('[id]'))
      .map((element) => parseCommentElementId(element.id))
      .find((id) => id !== null);
    if (!commentId) {
      continue;
    }
    const button = createIconButton('changes-thread', 'invisible');
    bindButton(
      button,
      () => {
        const path = filePathForElement(thread);
        const line = parseThreadHeadingLine(heading.textContent ?? '');
        return {
          kind: 'pr-comment',
          ...ref,
          commentId,
          fallback: path && line ? { path, line } : null,
        };
      },
      open,
    );
    heading.after(button);
  }
}

export function syncConversationThreads(root: ParentNode, ref: PullRequestRef, open: Opener): void {
  for (const thread of root.querySelectorAll<HTMLElement>('review-thread-collapsible')) {
    const row = thread.firstElementChild;
    const link = row?.querySelector('a[href*="#diff-"]');
    if (!row || !link || row.querySelector(`[${MARKER}="conversation-thread"]`)) {
      continue;
    }
    const commentId = conversationCommentId(thread);
    if (!commentId) {
      continue;
    }
    const button = createIconButton('conversation-thread', 'invisible');
    bindButton(button, () => ({ kind: 'pr-comment', ...ref, commentId, fallback: null }), open);
    link.after(button);
  }
}

export function conversationCommentId(thread: Element): string | null {
  const rendered = thread.querySelector('[id^="discussion_r"]');
  const fromElement = rendered ? parseCommentElementId(rendered.id) : null;
  if (fromElement) {
    return fromElement;
  }
  const hidden = thread.getAttribute('data-hidden-comment-ids')?.split(',')[0]?.trim();
  return hidden && /^\d+$/.test(hidden) ? hidden : null;
}

// ---------------------------------------------------------------------------
// Blob pages

export function readEmbeddedBlobData(root: ParentNode = document): EmbeddedBlobInfo | null {
  for (const script of root.querySelectorAll('script[data-target="react-app.embeddedData"]')) {
    try {
      const info = readEmbeddedBlobInfo(JSON.parse(script.textContent ?? ''));
      if (info) {
        return info;
      }
    } catch {
      // Not JSON; keep looking.
    }
  }
  return null;
}

export function currentBlobTarget(): OpenTarget | null {
  const location = parseBlobLocation(new URL(window.location.href), readEmbeddedBlobData());
  return location ? { kind: 'blob', ...location } : null;
}

export function syncBlobToolbar(root: ParentNode, open: Opener): void {
  const group = root
    .querySelector('[data-testid="raw-button"]')
    ?.closest('[data-component="ButtonGroup"]');
  if (!group?.parentElement || group.parentElement.querySelector(`[${MARKER}="blob-toolbar"]`)) {
    return;
  }
  const button = createIconButton('blob-toolbar', 'secondary');
  bindButton(button, currentBlobTarget, open);
  group.after(button);
}

export function syncBlobLineMenu(menu: HTMLElement, open: Opener): void {
  if (menu.querySelector(`[${MARKER}="blob-line-menu"]`)) {
    return;
  }
  const item = createMenuItem(menu, 'blob-line-menu');
  bindMenuItem(item, menu, currentBlobTarget, open);
  insertMenuItemAfter(menu, item, 'View file in GitHub.dev');
}

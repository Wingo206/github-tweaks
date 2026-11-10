import { shouldShowHandbackButton } from './model';

export const HANDBACK_ROOT_ATTRIBUTE = 'data-ght-handback';
export const HANDBACK_BUTTON_CLASS = 'ght-handback__button';
export const HANDBACK_ERROR_CLASS = 'ght-handback__error';
export const HANDBACK_NOTE_CLASS = 'ght-handback__note';
export const HANDBACK_ROOT_CLASS = 'ght-handback';

/** `done`: GitHub accepted the change, but this page may still show the old assignees. */
export type HandbackUiState = 'idle' | 'updating' | 'done' | 'error';

export interface HandbackRenderOptions {
  viewerLogin: string | null;
  authorLogin: string | null;
  uiState: HandbackUiState;
  errorMessage: string | null;
  onHandback: () => void;
}

export interface HandbackSyncResult {
  visible: boolean;
  assigneeLogins: string[];
}

/** One page layout's Assignees block. */
export interface AssigneesAdapter {
  /** The Assignees block, or null when this layout's sidebar is not on the page. */
  findRoot(root: ParentNode): HTMLElement | null;
  sync(assigneesRoot: HTMLElement, options: HandbackRenderOptions): HandbackSyncResult;
  /** Shows GitHub's updated assignees after a hand back. */
  refresh(assigneesRoot: HTMLElement): Promise<void>;
}

export function clearHandbackUi(root: ParentNode = document): void {
  root.querySelectorAll(`[${HANDBACK_ROOT_ATTRIBUTE}]`).forEach((element) => {
    element.remove();
  });
}

const OVERVIEW_ROOT_SELECTOR = 'section[aria-label="Assignees"][data-overview-sidebar-item]';

/**
 * The Overview sidebar's Assignees section. Its heading is one button that
 * opens GitHub's picker, so the action is the heading's next child, laid over
 * the row right after the "Assignees" text (see styles.css), rather than
 * nested inside GitHub's button.
 */
export const overviewAssignees: AssigneesAdapter = {
  findRoot(root) {
    return root.querySelector<HTMLElement>(OVERVIEW_ROOT_SELECTOR);
  },

  sync(section, options) {
    const assigneeLogins = readOverviewAssigneeLogins(section);
    const heading = section.querySelector<HTMLElement>(':scope > h4');
    const visible =
      !!heading &&
      shouldShowHandbackButton({
        viewerLogin: options.viewerLogin,
        authorLogin: options.authorLogin,
        assigneeLogins,
      });
    if (!visible || !heading) {
      clearHandbackUi(section);
      return { visible: false, assigneeLogins };
    }

    let mount = heading.querySelector<HTMLElement>(`:scope > [${HANDBACK_ROOT_ATTRIBUTE}="action"]`);
    if (!mount) {
      mount = document.createElement('span');
      mount.className = HANDBACK_ROOT_CLASS;
      mount.setAttribute(HANDBACK_ROOT_ATTRIBUTE, 'action');
      mount.append(document.createTextNode('– '));
      heading.append(mount);
    }
    renderAction(mount, options);
    renderError(heading, options);
    return { visible: true, assigneeLogins };
  },

  // GitHub's sidebar follows live updates on its own.
  async refresh() {},
};

/** Logins from the profile links in the Overview Assignees list. */
export function readOverviewAssigneeLogins(section: HTMLElement): string[] {
  return Array.from(
    section.querySelectorAll<HTMLAnchorElement>('li a[data-hovercard-type="user"][href]'),
    (link) => new URL(link.getAttribute('href')!, window.location.origin).pathname.split('/')[1] ?? '',
  ).filter((login) => login !== '');
}

function renderAction(mount: HTMLElement, options: HandbackRenderOptions): void {
  let button = mount.querySelector<HTMLButtonElement>(`.${HANDBACK_BUTTON_CLASS}`);
  let note = mount.querySelector<HTMLElement>(`.${HANDBACK_NOTE_CLASS}`);
  if (options.uiState === 'done') {
    button?.remove();
    if (!note) {
      note = document.createElement('span');
      note.className = HANDBACK_NOTE_CLASS;
      note.setAttribute('role', 'status');
      mount.append(note);
    }
    setText(note, 'reassigned, reload to update');
    note.title = `Reassigned to ${options.authorLogin}`;
    return;
  }

  note?.remove();
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = HANDBACK_BUTTON_CLASS;
    mount.append(button);
  }
  const updating = options.uiState === 'updating';
  button.disabled = updating;
  button.setAttribute('aria-busy', String(updating));
  button.setAttribute('aria-label', `Reassign to ${options.authorLogin}`);
  button.title = `Reassign to ${options.authorLogin}`;
  setText(button, updating ? 'reassigning…' : 'reassign author');
  const stop = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  button.onmousedown = stop;
  button.onclick = (event) => {
    stop(event);
    options.onHandback();
  };
}

/** Errors don't fit on the heading row, so they go on their own line below it. */
function renderError(heading: HTMLElement, options: HandbackRenderOptions): void {
  let error = heading.nextElementSibling?.matches(`[${HANDBACK_ROOT_ATTRIBUTE}="error"]`)
    ? (heading.nextElementSibling as HTMLElement)
    : null;
  if (options.uiState === 'error' && options.errorMessage) {
    if (!error) {
      error = document.createElement('div');
      error.className = HANDBACK_ERROR_CLASS;
      error.setAttribute(HANDBACK_ROOT_ATTRIBUTE, 'error');
      error.setAttribute('role', 'alert');
      heading.after(error);
    }
    setText(error, options.errorMessage);
  } else {
    error?.remove();
  }
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

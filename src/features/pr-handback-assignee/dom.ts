import { shouldShowHandbackButton } from './model';

export const ASSIGNEES_ROOT_SELECTOR =
  '.discussion-sidebar-item.sidebar-assignee.js-updatable-content[data-channel-event-name="assignees_updated"]';
export const ASSIGNEES_FORM_SELECTOR = 'form[aria-label="Select assignees"]';
export const HANDBACK_ROOT_ATTRIBUTE = 'data-ght-handback';
export const HANDBACK_BUTTON_CLASS = 'ght-handback__button';
export const HANDBACK_ERROR_CLASS = 'ght-handback__error';
export const HANDBACK_ROOT_CLASS = 'ght-handback';

export type HandbackUiState = 'idle' | 'updating' | 'error';

export interface HandbackRenderOptions {
  viewerLogin: string | null;
  authorLogin: string | null;
  uiState: HandbackUiState;
  errorMessage: string | null;
  onHandback: () => void;
}

export function findAssigneesRoot(
  root: ParentNode = document,
): HTMLElement | null {
  const byEvent = root.querySelector<HTMLElement>(ASSIGNEES_ROOT_SELECTOR);
  if (byEvent) {
    return byEvent;
  }

  // GitHub's reviewers block also uses `sidebar-assignee`; prefer the assignees form.
  const form = root.querySelector<HTMLElement>(ASSIGNEES_FORM_SELECTOR);
  const fromForm = form?.closest<HTMLElement>(
    '.discussion-sidebar-item.js-updatable-content',
  );
  return fromForm ?? null;
}

export function readAssigneeLogins(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-assignee-name]'),
  )
    .map((element) => element.getAttribute('data-assignee-name'))
    .filter((login): login is string => !!login);
}

export function getAssigneesPartialUrl(root: HTMLElement): string | null {
  const dataUrl = root.getAttribute('data-url');
  if (!dataUrl) {
    return null;
  }

  try {
    return new URL(dataUrl, window.location.origin).toString();
  } catch {
    return null;
  }
}

export async function refreshAssigneesPartial(
  root: HTMLElement,
): Promise<HTMLElement | null> {
  const url = getAssigneesPartialUrl(root);
  if (!url) {
    return root;
  }

  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      Accept: 'text/html',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (!response.ok) {
    throw new Error('Couldn’t refresh assignees from GitHub.');
  }

  const html = await response.text();
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const next = template.content.firstElementChild;
  if (!(next instanceof HTMLElement)) {
    throw new Error('GitHub returned an empty assignees partial.');
  }

  root.replaceWith(next);
  return next;
}

export function clearHandbackUi(root: ParentNode = document): void {
  root.querySelectorAll(`[${HANDBACK_ROOT_ATTRIBUTE}]`).forEach((element) => {
    element.remove();
  });
}

/**
 * Injects a Refined-GitHub-style header action next to "Assignees"
 * (`– reassign author`) when the viewer is assigned and is not the author.
 */
export function syncHandbackUi(
  assigneesRoot: HTMLElement,
  options: HandbackRenderOptions,
): {
  visible: boolean;
  assigneeLogins: string[];
  hasForm: boolean;
  hasList: boolean;
} {
  const form = assigneesRoot.querySelector(ASSIGNEES_FORM_SELECTOR);
  const list = assigneesRoot.querySelector('.js-issue-assignees');
  const summary = assigneesRoot.querySelector<HTMLElement>(
    '#assignees-select-menu > summary',
  );
  if (!form || !list || !summary) {
    clearHandbackUi(assigneesRoot);
    return {
      visible: false,
      assigneeLogins: [],
      hasForm: !!form,
      hasList: !!list,
    };
  }

  const assigneeLogins = readAssigneeLogins(assigneesRoot);
  const visible = shouldShowHandbackButton({
    viewerLogin: options.viewerLogin,
    authorLogin: options.authorLogin,
    assigneeLogins,
  });

  let mount = summary.querySelector<HTMLElement>(`[${HANDBACK_ROOT_ATTRIBUTE}]`);
  let error = form.querySelector<HTMLElement>(`.${HANDBACK_ERROR_CLASS}`);
  if (!visible) {
    mount?.remove();
    error?.remove();
    return {
      visible: false,
      assigneeLogins,
      hasForm: true,
      hasList: true,
    };
  }

  if (!mount) {
    mount = document.createElement('span');
    mount.className = `text-normal color-fg-muted ${HANDBACK_ROOT_CLASS}`;
    mount.setAttribute(HANDBACK_ROOT_ATTRIBUTE, 'true');
    mount.append(document.createTextNode('– '));
    summary.append(mount);
  }

  const updating = options.uiState === 'updating';
  let button = mount.querySelector<HTMLButtonElement>(
    `.${HANDBACK_BUTTON_CLASS}`,
  );
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = `btn-link Link--muted Link--inTextBlock ${HANDBACK_BUTTON_CLASS}`;
    mount.append(button);
  }

  button.disabled = updating;
  button.textContent = updating ? 'Updating…' : 'reassign author';
  button.setAttribute('aria-busy', updating ? 'true' : 'false');
  const stopSummaryToggle = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  button.onmousedown = stopSummaryToggle;
  button.onclick = (event) => {
    stopSummaryToggle(event);
    options.onHandback();
  };

  if (options.uiState === 'error' && options.errorMessage) {
    if (!error) {
      error = document.createElement('div');
      error.className = HANDBACK_ERROR_CLASS;
      error.setAttribute(HANDBACK_ROOT_ATTRIBUTE, 'error');
      error.setAttribute('role', 'alert');
      form.insertBefore(error, list);
    }
    error.textContent = options.errorMessage;
  } else {
    error?.remove();
  }

  return {
    visible: true,
    assigneeLogins,
    hasForm: true,
    hasList: true,
  };
}

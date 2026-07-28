import { sendBackgroundMessage } from '../../src/shared/messaging';
import type {
  ContentRequest,
  PageStatus,
} from '../../src/shared/types';

const tokenForm = getElement<HTMLFormElement>('token-form');
const tokenInput = getElement<HTMLInputElement>('token');
const removeTokenButton = getElement<HTMLButtonElement>('remove-token');
const retryPageButton = getElement<HTMLButtonElement>('retry-page');
const authStatus = getElement<HTMLElement>('auth-status');
const pageStatus = getElement<HTMLElement>('page-status');
const errorMessage = getElement<HTMLElement>('error');

void initialize();

tokenForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void saveToken();
});

removeTokenButton.addEventListener('click', () => {
  void removeToken();
});

retryPageButton.addEventListener('click', () => {
  void refreshPageStatus(true);
});

async function initialize(): Promise<void> {
  clearError();
  try {
    const auth = await sendBackgroundMessage<{ configured: boolean }>({
      type: 'auth:get',
    });
    renderAuthStatus(auth.configured);
  } catch (error) {
    showError(error);
  }
  await refreshPageStatus(false);
}

async function saveToken(): Promise<void> {
  setBusy(true);
  clearError();
  authStatus.textContent = 'Validating token…';
  try {
    const result = await sendBackgroundMessage<{ login: string }>({
      type: 'auth:save',
      token: tokenInput.value,
    });
    tokenInput.value = '';
    authStatus.textContent = `Connected as @${result.login}.`;
    authStatus.dataset.state = 'success';
    await refreshPageStatus(true);
  } catch (error) {
    renderAuthStatus(false);
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function removeToken(): Promise<void> {
  setBusy(true);
  clearError();
  try {
    await sendBackgroundMessage<void>({ type: 'auth:remove' });
    renderAuthStatus(false);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function refreshPageStatus(retry: boolean): Promise<void> {
  retryPageButton.disabled = true;
  pageStatus.textContent = retry ? 'Retrying…' : 'Checking…';
  try {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url?.startsWith('https://github.com/')) {
      throw new Error('Open a GitHub pull request changed-files page.');
    }

    const request: ContentRequest = {
      type: retry ? 'page:retry' : 'page:get-status',
    };
    const status = (await browser.tabs.sendMessage(tab.id, request)) as PageStatus;
    renderPageStatus(status);
  } catch (error) {
    pageStatus.textContent =
      error instanceof Error
        ? error.message
        : 'GitHub Tweaks is not active on this page.';
    pageStatus.dataset.state = 'muted';
  } finally {
    retryPageButton.disabled = false;
  }
}

async function getActiveTab(): Promise<Browser.tabs.Tab | undefined> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function renderAuthStatus(configured: boolean): void {
  authStatus.textContent = configured
    ? 'A token is saved locally in extension storage.'
    : 'No token configured.';
  authStatus.dataset.state = configured ? 'success' : 'muted';
  removeTokenButton.hidden = !configured;
}

function renderPageStatus(status: PageStatus): void {
  switch (status.state) {
    case 'idle':
      pageStatus.textContent =
        'Open a pull request changed-files page to use this feature.';
      pageStatus.dataset.state = 'muted';
      break;
    case 'loading':
      pageStatus.textContent = `Loading ${formatRef(status.ref)}…`;
      pageStatus.dataset.state = 'muted';
      break;
    case 'ready':
      pageStatus.textContent = `${formatRef(status.ref)}: ${status.fileCount} files loaded.`;
      pageStatus.dataset.state = 'success';
      break;
    case 'error':
      pageStatus.textContent = status.message;
      pageStatus.dataset.state = 'error';
      break;
  }
}

function formatRef(ref: {
  owner: string;
  repository: string;
  number: number;
}): string {
  return `${ref.owner}/${ref.repository}#${ref.number}`;
}

function setBusy(busy: boolean): void {
  tokenInput.disabled = busy;
  removeTokenButton.disabled = busy;
  tokenForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled =
    busy;
}

function showError(error: unknown): void {
  errorMessage.hidden = false;
  errorMessage.textContent =
    error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function clearError(): void {
  errorMessage.hidden = true;
  errorMessage.textContent = '';
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing popup element #${id}.`);
  }
  return element as T;
}

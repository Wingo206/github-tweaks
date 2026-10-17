import { getFeatureFlags, setFeatureEnabled } from '../../src/features/flags';
import { FEATURES, type FeatureFlags, type FeatureId } from '../../src/features/registry';
import { sendBackgroundMessage } from '../../src/shared/messaging';
import type {
  CompanionSettingsView,
  CompanionStatus,
  ContentRequest,
  PageStatus,
} from '../../src/shared/types';

const featureList = getElement<HTMLUListElement>('feature-list');
const reloadNotice = getElement<HTMLElement>('reload-notice');
const reloadTabButton = getElement<HTMLButtonElement>('reload-tab');
const tokenForm = getElement<HTMLFormElement>('token-form');
const tokenInput = getElement<HTMLInputElement>('token');
const removeTokenButton = getElement<HTMLButtonElement>('remove-token');
const retryPageButton = getElement<HTMLButtonElement>('retry-page');
const authStatus = getElement<HTMLElement>('auth-status');
const pageStatus = getElement<HTMLElement>('page-status');
const errorMessage = getElement<HTMLElement>('error');
const companionPortInput = getElement<HTMLInputElement>('companion-port');
const companionTokenInput = getElement<HTMLInputElement>('companion-token');
const companionStatus = getElement<HTMLElement>('companion-status');

void initialize();

companionPortInput.addEventListener('change', () => {
  void saveCompanionSettings({ port: Number(companionPortInput.value) });
});

companionTokenInput.addEventListener('change', () => {
  void saveCompanionSettings({ token: companionTokenInput.value });
});

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

reloadTabButton.addEventListener('click', () => {
  void reloadActiveTab();
});

async function initialize(): Promise<void> {
  clearError();
  try {
    renderFeatureToggles(await getFeatureFlags());
  } catch (error) {
    showError(error);
  }
  try {
    const auth = await sendBackgroundMessage<{ configured: boolean }>({
      type: 'auth:get',
    });
    renderAuthStatus(auth.configured);
  } catch (error) {
    showError(error);
  }
  try {
    renderCompanionSettings(
      await sendBackgroundMessage<CompanionSettingsView>({ type: 'companion:get-settings' }),
    );
  } catch (error) {
    showError(error);
  }
  await Promise.all([refreshPageStatus(false), refreshCompanionStatus()]);
}

async function saveCompanionSettings(update: {
  port?: number;
  token?: string;
}): Promise<void> {
  clearError();
  try {
    renderCompanionSettings(
      await sendBackgroundMessage<CompanionSettingsView>({
        type: 'companion:save-settings',
        ...update,
      }),
    );
  } catch (error) {
    showError(error);
  }
  await refreshCompanionStatus();
}

function renderCompanionSettings(settings: CompanionSettingsView): void {
  companionPortInput.value = String(settings.port);
  companionTokenInput.value = '';
  companionTokenInput.placeholder = settings.paired
    ? 'Saved. Paste a new token to replace it.'
    : 'Paste pairing token';
}

async function refreshCompanionStatus(): Promise<void> {
  companionStatus.textContent = 'Checking…';
  companionStatus.dataset.state = 'muted';
  try {
    renderCompanionStatus(
      await sendBackgroundMessage<CompanionStatus>({ type: 'companion-status' }),
    );
  } catch (error) {
    companionStatus.textContent =
      error instanceof Error ? error.message : 'Couldn’t check the companion.';
    companionStatus.dataset.state = 'error';
  }
}

function renderCompanionStatus(status: CompanionStatus): void {
  if (status.connected) {
    const windows = `${status.windows} ${status.windows === 1 ? 'window' : 'windows'}`;
    companionStatus.textContent = `Connected · v${status.version} · ${windows}`;
    companionStatus.dataset.state = 'success';
    return;
  }
  switch (status.reason) {
    case 'not-paired':
      companionStatus.textContent =
        'Not paired: run GitHub Tweaks: Copy pairing token in Cursor';
      companionStatus.dataset.state = 'muted';
      break;
    case 'offline':
      companionStatus.textContent = 'Companion offline: open a Cursor window';
      companionStatus.dataset.state = 'muted';
      break;
    case 'unauthorized':
      companionStatus.textContent = 'Token rejected';
      companionStatus.dataset.state = 'error';
      break;
  }
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

function renderFeatureToggles(flags: FeatureFlags): void {
  featureList.replaceChildren(
    ...FEATURES.map((feature) => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = flags[feature.id];
      checkbox.addEventListener('change', () => {
        void toggleFeature(feature.id, checkbox);
      });

      const title = document.createElement('span');
      title.className = 'feature-title';
      title.textContent = feature.title;

      const description = document.createElement('span');
      description.className = 'feature-description';
      description.textContent = feature.description;

      const label = document.createElement('label');
      label.className = 'feature-toggle';
      label.append(checkbox, title, description);

      const item = document.createElement('li');
      item.append(label);
      return item;
    }),
  );
}

async function toggleFeature(
  id: FeatureId,
  checkbox: HTMLInputElement,
): Promise<void> {
  clearError();
  checkbox.disabled = true;
  try {
    await setFeatureEnabled(id, checkbox.checked);
    reloadNotice.hidden = false;
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    showError(error);
  } finally {
    checkbox.disabled = false;
  }
}

async function reloadActiveTab(): Promise<void> {
  const tab = await getActiveTab();
  if (tab?.id && tab.url?.startsWith('https://github.com/')) {
    await browser.tabs.reload(tab.id);
  }
  window.close();
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
    case 'disabled':
      pageStatus.textContent = 'Pull request sidebar metadata is turned off.';
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

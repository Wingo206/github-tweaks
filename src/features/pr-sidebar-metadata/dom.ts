import type {
  PullRequestFile,
  PullRequestFilesSnapshot,
} from '../../shared/types';
import {
  aggregateFolder,
  aggregateLineViewProgress,
  isViewed,
  lineViewProgressRatio,
  type LineViewProgress,
} from './model';

const METADATA_ATTRIBUTE = 'data-ght-pr-metadata';
const TOOLBAR_LINES_VALUE = 'toolbar-lines';
const VIEWED_ROW_CLASS = 'ght-pr-tree-row--viewed';
const PROGRESS_RING_CIRCUMFERENCE = 38;
const numberFormatter = new Intl.NumberFormat();

export interface SidebarCallbacks {
  onViewedChange(path: string, viewed: boolean): void;
  onRetry(): void;
  onOpenSetup(): void;
}

export class SidebarRenderer {
  private readonly viewedErrors = new Map<string, string>();

  constructor(private readonly callbacks: SidebarCallbacks) {}

  setViewedError(path: string, message: string | null): void {
    if (message) {
      this.viewedErrors.set(path, message);
    } else {
      this.viewedErrors.delete(path);
    }
  }

  render(snapshot: PullRequestFilesSnapshot): boolean {
    this.renderToolbarLineProgress(aggregateLineViewProgress(snapshot.files));

    const root = document.querySelector<HTMLElement>('#pr-file-tree');
    if (!root) {
      return false;
    }

    this.hideBanner(root);
    const filesByPath = new Map(
      snapshot.files.map((file) => [file.path, file]),
    );

    for (const row of root.querySelectorAll<HTMLElement>(
      'li[role="treeitem"][id]',
    )) {
      const path = row.id;
      const file = filesByPath.get(path);
      if (file && !row.hasAttribute('aria-expanded')) {
        this.renderFileRow(row, file);
      } else if (row.hasAttribute('aria-expanded')) {
        const aggregate = aggregateFolder(path, snapshot.files);
        if (aggregate.total > 0) {
          this.renderFolderRow(row, aggregate);
        } else {
          this.clearRowMetadata(row);
        }
      } else {
        this.clearRowMetadata(row);
      }
    }

    return true;
  }

  showLoading(): void {
    this.renderToolbarLineProgress(null);
    this.showBanner('Loading pull request metadata…', 'loading');
  }

  showError(message: string): void {
    this.showBanner(message, 'error');
  }

  clear(): void {
    document
      .querySelectorAll(`[${METADATA_ATTRIBUTE}]`)
      .forEach((element) => element.remove());
    document
      .querySelectorAll(`.${VIEWED_ROW_CLASS}`)
      .forEach((element) => element.classList.remove(VIEWED_ROW_CLASS));
  }

  private clearRowMetadata(row: HTMLElement): void {
    row.classList.remove(VIEWED_ROW_CLASS);
    const container = findContentContainer(row);
    if (!container) {
      return;
    }
    findDirectMetadata(container)?.remove();
  }

  private renderToolbarLineProgress(
    progress: LineViewProgress | null,
  ): void {
    const mount = findViewedProgressMount();
    if (!mount) {
      return;
    }

    let metadata = mount.querySelector<HTMLElement>(
      `[${METADATA_ATTRIBUTE}="${TOOLBAR_LINES_VALUE}"]`,
    );
    if (!metadata) {
      metadata = document.createElement('span');
      metadata.className = 'ght-pr-toolbar-lines';
      metadata.setAttribute(METADATA_ATTRIBUTE, TOOLBAR_LINES_VALUE);
      metadata.innerHTML = `
        <span aria-hidden="true" class="ght-pr-toolbar-lines__visible">
          <span class="ght-pr-toolbar-lines__separator">·</span>
          <svg
            class="ght-pr-toolbar-lines__ring"
            data-circumference="${PROGRESS_RING_CIRCUMFERENCE}"
            height="16"
            role="presentation"
            width="16"
          >
            <circle
              class="ght-pr-toolbar-lines__ring-track"
              cx="50%"
              cy="50%"
              fill="transparent"
              r="6"
              stroke-width="2"
            ></circle>
            <circle
              class="ght-pr-toolbar-lines__ring-value"
              cx="50%"
              cy="50%"
              fill="transparent"
              r="6"
              stroke-dasharray="${PROGRESS_RING_CIRCUMFERENCE}"
              stroke-dashoffset="${PROGRESS_RING_CIRCUMFERENCE}"
              stroke-linecap="round"
              stroke-width="2"
            ></circle>
          </svg>
          <span class="ght-pr-toolbar-lines__counts">
            <span class="ght-pr-toolbar-lines__count ght-pr-toolbar-lines__count--viewed"></span>
            <span class="ght-pr-toolbar-lines__slash"> / </span>
            <span class="ght-pr-toolbar-lines__count ght-pr-toolbar-lines__count--total"></span>
            <span class="ght-pr-toolbar-lines__suffix"> changes</span>
          </span>
        </span>
        <span class="sr-only"></span>
      `;
      mount.append(metadata);
    }

    const viewedCount = metadata.querySelector<HTMLElement>(
      '.ght-pr-toolbar-lines__count--viewed',
    );
    const totalCount = metadata.querySelector<HTMLElement>(
      '.ght-pr-toolbar-lines__count--total',
    );
    const ringValue = metadata.querySelector<SVGCircleElement>(
      '.ght-pr-toolbar-lines__ring-value',
    );
    const srOnly = metadata.querySelector<HTMLElement>('.sr-only');
    const ratio = lineViewProgressRatio(progress);
    const viewedLabel = progress
      ? numberFormatter.format(progress.viewed)
      : '…';
    const totalLabel = progress
      ? numberFormatter.format(progress.total)
      : '…';

    if (viewedCount) {
      viewedCount.textContent = viewedLabel;
    }
    if (totalCount) {
      totalCount.textContent = totalLabel;
    }
    if (ringValue) {
      const offset =
        ratio === null
          ? PROGRESS_RING_CIRCUMFERENCE
          : PROGRESS_RING_CIRCUMFERENCE * (1 - ratio);
      ringValue.setAttribute('stroke-dashoffset', String(offset));
    }
    if (srOnly) {
      srOnly.textContent = progress
        ? `${viewedLabel} of ${totalLabel} changes viewed`
        : 'Line view progress loading';
    }
  }

  private renderFileRow(row: HTMLElement, file: PullRequestFile): void {
    row.classList.toggle(VIEWED_ROW_CLASS, isViewed(file.viewedState));
    const container = findContentContainer(row);
    if (!container) {
      return;
    }

    let metadata = findDirectMetadata(container);
    if (!metadata) {
      metadata = document.createElement('span');
      metadata.className = 'ght-pr-metadata';
      metadata.setAttribute(METADATA_ATTRIBUTE, 'file');
      metadata.innerHTML = `
        <span class="ght-pr-metadata__counts"></span>
        <label class="ght-pr-metadata__viewed">
          <input type="checkbox">
        </label>
      `;
      // Keep checkbox clicks and keys from also activating the tree row.
      metadata.addEventListener('click', (event) => event.stopPropagation());
      metadata.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.stopPropagation();
        }
      });
      const checkbox = metadata.querySelector<HTMLInputElement>('input');
      checkbox?.addEventListener('change', () => {
        const path = checkbox.closest<HTMLElement>('li[role="treeitem"]')?.id;
        if (path) {
          this.callbacks.onViewedChange(path, checkbox.checked);
        }
      });
      container.append(metadata);
    }

    const counts = metadata.querySelector<HTMLElement>(
      '.ght-pr-metadata__counts',
    );
    if (counts) {
      renderCounts(counts, file.additions, file.deletions);
    }

    const error = this.viewedErrors.get(file.path);
    metadata.classList.toggle('ght-pr-metadata--error', !!error);
    const checkbox = metadata.querySelector<HTMLInputElement>(
      '.ght-pr-metadata__viewed input',
    );
    if (checkbox) {
      checkbox.checked = isViewed(file.viewedState);
      checkbox.setAttribute(
        'aria-label',
        `${checkbox.checked ? 'Unmark' : 'Mark'} ${file.path} as viewed`,
      );
      checkbox.parentElement!.title =
        error ??
        (checkbox.checked ? 'Unmark file as viewed' : 'Mark file as viewed');
    }
  }

  private renderFolderRow(
    row: HTMLElement,
    aggregate: ReturnType<typeof aggregateFolder>,
  ): void {
    row.classList.toggle(
      VIEWED_ROW_CLASS,
      aggregate.viewed === aggregate.total ||
        (aggregate.additions === 0 && aggregate.deletions === 0),
    );
    const container = findContentContainer(row);
    if (!container) {
      return;
    }

    let metadata = findDirectMetadata(container);
    if (!metadata) {
      metadata = document.createElement('span');
      metadata.className =
        'ght-pr-metadata ght-pr-metadata--folder';
      metadata.setAttribute(METADATA_ATTRIBUTE, 'folder');
      metadata.innerHTML = `
        <span class="ght-pr-metadata__counts"></span>
        <span class="ght-pr-metadata__progress"></span>
      `;
      container.append(metadata);
    }

    const counts = metadata.querySelector<HTMLElement>(
      '.ght-pr-metadata__counts',
    );
    if (counts) {
      renderCounts(
        counts,
        aggregate.additions,
        aggregate.deletions,
        'No remaining changes in unviewed files',
      );
      counts.title = 'Remaining changes in unviewed files';
      counts.setAttribute(
        'aria-label',
        `${aggregate.additions} additions and ${aggregate.deletions} deletions remaining in unviewed files`,
      );
    }

    const progress = metadata.querySelector<HTMLElement>(
      '.ght-pr-metadata__progress',
    );
    if (progress) {
      progress.textContent = `${aggregate.viewed}/${aggregate.total}`;
      progress.title = `${aggregate.viewed} of ${aggregate.total} files viewed`;
      progress.setAttribute(
        'aria-label',
        `${aggregate.viewed} of ${aggregate.total} files viewed`,
      );
    }
  }

  private showBanner(message: string, state: 'loading' | 'error'): void {
    const root = document.querySelector<HTMLElement>('#pr-file-tree');
    if (!root) {
      return;
    }

    let banner = root.querySelector<HTMLElement>(
      `[${METADATA_ATTRIBUTE}="banner"]`,
    );
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'ght-pr-banner';
      banner.setAttribute(METADATA_ATTRIBUTE, 'banner');
      const filter = root.querySelector('#diff-file-tree-filter');
      filter?.insertAdjacentElement('afterend', banner);
      if (!filter) {
        root.prepend(banner);
      }
    }

    banner.dataset.state = state;
    banner.replaceChildren();
    const text = document.createElement('span');
    text.textContent = message;
    banner.append(text);

    if (state === 'error') {
      banner.append(
        createBannerButton('Retry', this.callbacks.onRetry),
        createBannerButton('Open setup', this.callbacks.onOpenSetup),
      );
    }
  }

  private hideBanner(root: HTMLElement): void {
    root
      .querySelector(`[${METADATA_ATTRIBUTE}="banner"]`)
      ?.remove();
  }
}

export function isNativeViewedButton(
  target: Element,
): target is HTMLButtonElement {
  return (
    target instanceof HTMLButtonElement &&
    target.hasAttribute('aria-pressed') &&
    target.closest('[data-diff-header-wrapper="true"]') !== null &&
    target.textContent?.includes('Viewed') === true
  );
}

export function getNativeViewedPath(button: HTMLButtonElement): string | null {
  const header = button.closest<HTMLElement>(
    '[data-diff-header-wrapper="true"]',
  );
  const explicitPath = header?.querySelector<HTMLElement>('[data-file-path]')
    ?.dataset.filePath;
  if (explicitPath) {
    return explicitPath;
  }

  const link = header?.querySelector<HTMLAnchorElement>('h3 a[href^="#diff-"]');
  const treePath = link
    ? document
        .querySelector(`#pr-file-tree a[href="${link.getAttribute('href')}"]`)
        ?.closest<HTMLElement>('li[role="treeitem"]')?.id
    : undefined;
  if (treePath) {
    return treePath;
  }

  // Renamed files show both paths; the screen-reader text spells out the new one.
  const renamed = link
    ?.querySelector('code .sr-only')
    ?.textContent?.match(/ renamed to (.+)$/)?.[1]
    ?.trim();
  if (renamed) {
    return renamed;
  }

  const text = link
    ?.querySelector('code')
    ?.textContent?.replace(/[\u200e\u200f]/g, '')
    .trim();
  return text || null;
}

export function isNativeViewedPressed(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-pressed') === 'true';
}

/**
 * Native Viewed buttons keyed by file path. GitHub only renders a file's
 * button once its diff has loaded, so unloaded files are absent.
 */
export function indexNativeViewedButtons(
  doc: Document = document,
): Map<string, HTMLButtonElement> {
  const buttons = new Map<string, HTMLButtonElement>();
  for (const button of doc.querySelectorAll<HTMLButtonElement>(
    '[data-diff-header-wrapper="true"] button[aria-pressed]',
  )) {
    if (!isNativeViewedButton(button)) {
      continue;
    }
    const path = getNativeViewedPath(button);
    if (path) {
      buttons.set(path, button);
    }
  }
  return buttons;
}

function findViewedProgressMount(): HTMLElement | null {
  const toolbar = Array.from(
    document.querySelectorAll<HTMLElement>('h2.sr-only'),
  ).find((heading) => heading.textContent?.trim() === 'Pull request toolbar')
    ?.closest('section');
  if (!toolbar) {
    return null;
  }

  const fileProgress = Array.from(
    toolbar.querySelectorAll<HTMLElement>('.sr-only'),
  ).find((element) => /files viewed/i.test(element.textContent ?? ''));
  if (fileProgress?.parentElement) {
    return fileProgress.parentElement;
  }

  const reviewButton = Array.from(
    toolbar.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => /^(submit review|review)$/i.test(
    button.textContent?.trim() ?? '',
  ));
  const controls = reviewButton?.previousElementSibling;
  return controls instanceof HTMLElement ? controls : null;
}

function findContentContainer(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>('.PRIVATE_TreeView-item-content');
}

function findDirectMetadata(container: HTMLElement): HTMLElement | null {
  return Array.from(container.children).find((element) =>
    element.hasAttribute(METADATA_ATTRIBUTE),
  ) as HTMLElement | null;
}

function renderCounts(
  container: HTMLElement,
  additions: number,
  deletions: number,
  zeroTitle = 'Line counts unavailable',
): void {
  container.replaceChildren();
  if (additions === 0 && deletions === 0) {
    const unavailable = document.createElement('span');
    unavailable.className = 'ght-pr-metadata__unavailable';
    unavailable.textContent = '—';
    unavailable.title = zeroTitle;
    container.append(unavailable);
    return;
  }

  if (additions > 0) {
    const added = document.createElement('span');
    added.className = 'ght-pr-metadata__additions';
    added.textContent = `+${numberFormatter.format(additions)}`;
    container.append(added);
  }

  if (deletions > 0) {
    const deleted = document.createElement('span');
    deleted.className = 'ght-pr-metadata__deletions';
    deleted.textContent = `-${numberFormatter.format(deletions)}`;
    container.append(deleted);
  }
}

function createBannerButton(
  label: string,
  callback: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', callback);
  return button;
}

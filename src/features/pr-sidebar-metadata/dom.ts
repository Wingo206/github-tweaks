import type {
  PullRequestFile,
  PullRequestFilesSnapshot,
} from '../../shared/types';
import {
  aggregateFileViewProgress,
  aggregateFolder,
  aggregateLineViewProgress,
  isViewed,
  viewProgressRatio,
  type ViewProgress,
} from './model';

const METADATA_ATTRIBUTE = 'data-ght-pr-metadata';
const VIEWED_ROW_CLASS = 'ght-pr-tree-row--viewed';

interface ToolbarMeter {
  /** Value of the metadata attribute that marks this meter. */
  value: string;
  /** Visible text after the counts. */
  suffix: string;
  /** What the counts measure, for screen readers. */
  noun: string;
  /** Leading meters go first in the mount and have no separator. */
  leading: boolean;
}

/** Stands in for GitHub's own files meter, which commit views leave out. */
const FILES_METER: ToolbarMeter = {
  value: 'toolbar-files',
  suffix: 'viewed',
  noun: 'files',
  leading: true,
};
const LINES_METER: ToolbarMeter = {
  value: 'toolbar-lines',
  suffix: 'changes',
  noun: 'changes',
  leading: false,
};
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
    this.renderToolbarProgress(
      aggregateFileViewProgress(snapshot.files),
      aggregateLineViewProgress(snapshot.files),
    );

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
    this.renderToolbarProgress(null, null);
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
    row.classList.toggle(VIEWED_ROW_CLASS, false);
    const container = findContentContainer(row);
    if (!container) {
      return;
    }
    findDirectMetadata(container)?.remove();
  }

  private renderToolbarProgress(
    files: ViewProgress | null,
    lines: ViewProgress | null,
  ): void {
    const toolbar = findPullRequestToolbar();
    if (!toolbar) {
      return;
    }

    const nativeFiles = findNativeFileProgress(toolbar);
    const mount = nativeFiles?.parentElement ?? findFileControls(toolbar);
    if (!mount) {
      return;
    }

    if (nativeFiles) {
      findToolbarMeter(toolbar, FILES_METER)?.remove();
    } else {
      this.renderToolbarMeter(toolbar, mount, FILES_METER, files);
    }
    this.renderToolbarMeter(toolbar, mount, LINES_METER, lines);
  }

  private renderToolbarMeter(
    toolbar: HTMLElement,
    mount: HTMLElement,
    meter: ToolbarMeter,
    progress: ViewProgress | null,
  ): void {
    let metadata = findToolbarMeter(toolbar, meter);
    if (!metadata) {
      metadata = document.createElement('span');
      metadata.className = 'ght-pr-toolbar-meter';
      metadata.setAttribute(METADATA_ATTRIBUTE, meter.value);
      metadata.innerHTML = `
        <span aria-hidden="true" class="ght-pr-toolbar-meter__visible">
          ${meter.leading ? '' : '<span class="ght-pr-toolbar-meter__separator">·</span>'}
          <svg
            class="ght-pr-toolbar-meter__ring"
            data-circumference="${PROGRESS_RING_CIRCUMFERENCE}"
            height="16"
            role="presentation"
            width="16"
          >
            <circle
              class="ght-pr-toolbar-meter__ring-track"
              cx="50%"
              cy="50%"
              fill="transparent"
              r="6"
              stroke-width="2"
            ></circle>
            <circle
              class="ght-pr-toolbar-meter__ring-value"
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
          <span class="ght-pr-toolbar-meter__counts">
            <span class="ght-pr-toolbar-meter__count ght-pr-toolbar-meter__count--viewed"></span>
            <span class="ght-pr-toolbar-meter__slash"> / </span>
            <span class="ght-pr-toolbar-meter__count ght-pr-toolbar-meter__count--total"></span>
            <span class="ght-pr-toolbar-meter__suffix"> ${meter.suffix}</span>
          </span>
        </span>
        <span class="sr-only"></span>
      `;
    }
    // GitHub can add its own meter after ours mounted, which moves the mount.
    if (metadata.parentElement !== mount) {
      if (meter.leading) {
        mount.prepend(metadata);
      } else {
        mount.append(metadata);
      }
    }

    const viewedCount = metadata.querySelector<HTMLElement>(
      '.ght-pr-toolbar-meter__count--viewed',
    );
    const totalCount = metadata.querySelector<HTMLElement>(
      '.ght-pr-toolbar-meter__count--total',
    );
    const ringValue = metadata.querySelector<SVGCircleElement>(
      '.ght-pr-toolbar-meter__ring-value',
    );
    const srOnly = metadata.querySelector<HTMLElement>('.sr-only');
    const ratio = viewProgressRatio(progress);
    const viewedLabel = progress
      ? numberFormatter.format(progress.viewed)
      : '…';
    const totalLabel = progress
      ? numberFormatter.format(progress.total)
      : '…';

    if (viewedCount) {
      setText(viewedCount, viewedLabel);
    }
    if (totalCount) {
      setText(totalCount, totalLabel);
    }
    if (ringValue) {
      const offset =
        ratio === null
          ? PROGRESS_RING_CIRCUMFERENCE
          : PROGRESS_RING_CIRCUMFERENCE * (1 - ratio);
      setAttribute(ringValue, 'stroke-dashoffset', String(offset));
    }
    if (srOnly) {
      setText(
        srOnly,
        progress
          ? `${viewedLabel} of ${totalLabel} ${meter.noun} viewed`
          : `Viewed ${meter.noun} loading`,
      );
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
      const viewed = isViewed(file.viewedState);
      if (checkbox.checked !== viewed) {
        checkbox.checked = viewed;
      }
      setAttribute(
        checkbox,
        'aria-label',
        `${viewed ? 'Unmark' : 'Mark'} ${file.path} as viewed`,
      );
      setAttribute(
        checkbox.parentElement!,
        'title',
        error ?? (viewed ? 'Unmark file as viewed' : 'Mark file as viewed'),
      );
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
      setAttribute(counts, 'title', 'Remaining changes in unviewed files');
      setAttribute(
        counts,
        'aria-label',
        `${aggregate.additions} additions and ${aggregate.deletions} deletions remaining in unviewed files`,
      );
    }

    const progress = metadata.querySelector<HTMLElement>(
      '.ght-pr-metadata__progress',
    );
    if (progress) {
      const label = `${aggregate.viewed} of ${aggregate.total} files viewed`;
      setText(progress, `${aggregate.viewed}/${aggregate.total}`);
      setAttribute(progress, 'title', label);
      setAttribute(progress, 'aria-label', label);
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
  return header ? getDiffHeaderPath(header) : null;
}

function getDiffHeaderPath(header: HTMLElement): string | null {
  const explicitPath = header.querySelector<HTMLElement>('[data-file-path]')
    ?.dataset.filePath;
  if (explicitPath) {
    return explicitPath;
  }

  const link = header.querySelector<HTMLAnchorElement>('h3 a[href^="#diff-"]');
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

/**
 * Opens or closes a file's diff with the chevron in its header. Does nothing
 * when the file's header is not on the page.
 */
export function setDiffCollapsed(
  path: string,
  collapsed: boolean,
  doc: Document = document,
): void {
  for (const header of doc.querySelectorAll<HTMLElement>(
    '[data-diff-header-wrapper="true"]',
  )) {
    if (getDiffHeaderPath(header) !== path) {
      continue;
    }
    const toggle = findDiffToggle(header);
    if (toggle && toggle.expanded === collapsed) {
      toggle.button.click();
    }
    return;
  }
}

/** The chevron is labelled only by its tooltip, which names the next action. */
function findDiffToggle(
  header: HTMLElement,
): { button: HTMLButtonElement; expanded: boolean } | null {
  for (const button of header.querySelectorAll<HTMLButtonElement>(
    'button[aria-labelledby]',
  )) {
    const labelId = button.getAttribute('aria-labelledby')!.split(/\s+/)[0];
    const label = labelId
      ? header.ownerDocument.getElementById(labelId)?.textContent?.trim()
      : undefined;
    if (label === 'Collapse file' || label === 'Expand file') {
      return { button, expanded: label === 'Collapse file' };
    }
  }
  return null;
}

function findPullRequestToolbar(): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('h2.sr-only'))
      .find((heading) => heading.textContent?.trim() === 'Pull request toolbar')
      ?.closest<HTMLElement>('section') ?? null
  );
}

/** GitHub's "N of M files viewed" text, which commit and range views omit. */
function findNativeFileProgress(toolbar: HTMLElement): HTMLElement | null {
  return (
    Array.from(toolbar.querySelectorAll<HTMLElement>('.sr-only')).find(
      (element) =>
        !element.closest(`[${METADATA_ATTRIBUTE}]`) &&
        /files viewed/i.test(element.textContent ?? ''),
    ) ?? null
  );
}

/**
 * The box that holds GitHub's files meter; commit views leave it empty. Its
 * class is `file-controls__<hash>`, once prefixed `PullRequestFilesToolbar-module__`.
 */
function findFileControls(toolbar: HTMLElement): HTMLElement | null {
  const fileControls = Array.from(
    toolbar.querySelectorAll<HTMLElement>('[class*="file-controls"]'),
  ).find((element) =>
    Array.from(element.classList).some((name) =>
      /(?:^|__)file-controls(?:__|$)/.test(name),
    ),
  );
  if (fileControls) {
    return fileControls;
  }

  // The button holds both its full and short labels: "Submit reviewReview".
  const reviewButton = Array.from(
    toolbar.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) =>
    /^(submit review|review)/i.test(button.textContent?.trim() ?? ''),
  );
  const controls = reviewButton?.previousElementSibling;
  return controls instanceof HTMLElement ? controls : null;
}

function findToolbarMeter(
  toolbar: HTMLElement,
  meter: ToolbarMeter,
): HTMLElement | null {
  return toolbar.querySelector<HTMLElement>(
    `[${METADATA_ATTRIBUTE}="${meter.value}"]`,
  );
}

function findContentContainer(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>('.PRIVATE_TreeView-item-content');
}

function findDirectMetadata(container: HTMLElement): HTMLElement | null {
  return Array.from(container.children).find((element) =>
    element.hasAttribute(METADATA_ATTRIBUTE),
  ) as HTMLElement | null;
}

/**
 * Every write is skipped when the value is already there: GitHub re-renders
 * often, and an unchanged render must not touch the DOM, or every page
 * observer (GitHub's and ours) reacts to thousands of no-op mutations.
 */
function setText(element: Element, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

function setAttribute(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function renderCounts(
  container: HTMLElement,
  additions: number,
  deletions: number,
  zeroTitle = 'Line counts unavailable',
): void {
  const key = `${additions}:${deletions}:${zeroTitle}`;
  if (container.dataset.ghtCounts === key) {
    return;
  }
  container.dataset.ghtCounts = key;
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

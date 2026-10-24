import { sendBackgroundMessage } from '../../shared/messaging';
import type {
  PageStatus,
  PullRequestChangeSelection,
  PullRequestFilesSnapshot,
  PullRequestRef,
} from '../../shared/types';
import {
  getNativeViewedPath,
  indexNativeViewedButtons,
  isNativeViewedButton,
  isNativeViewedPressed,
  SidebarRenderer,
} from './dom';
import {
  applyViewedOverrides,
  isViewed,
  updateFileViewedState,
} from './model';

/** How long to wait for GitHub to answer a native Viewed click before retrying. */
const NATIVE_CLICK_TIMEOUT_MS = 1000;
const NATIVE_CLICK_ATTEMPTS = 3;

interface NativeClick {
  /** When the last click was sent; 0 once GitHub's button has responded. */
  at: number;
  attempts: number;
}

export class PrSidebarController {
  private readonly renderer: SidebarRenderer;
  /**
   * Viewed states chosen in the sidebar that GitHub's page does not show yet.
   * They override fetched snapshots until the native button agrees.
   */
  private readonly intendedViewed = new Map<string, boolean>();
  /** The latest unsent API choice per path. */
  private readonly queuedMutations = new Map<string, boolean>();
  private readonly runningMutations = new Set<string>();
  /** Last state GitHub confirmed, for rolling back failed mutations. */
  private readonly confirmedViewed = new Map<string, boolean>();
  private readonly nativeClicks = new Map<string, NativeClick>();
  private observer: MutationObserver | null = null;
  private snapshot: PullRequestFilesSnapshot | null = null;
  private status: PageStatus = { state: 'idle' };
  private stopped = false;
  private loadGeneration = 0;
  private renderQueued = false;
  private reconcileTimer: number | undefined;
  private nativeRetryTimer: number | undefined;

  constructor(
    readonly ref: PullRequestRef,
    readonly selection: PullRequestChangeSelection = { kind: 'all' },
  ) {
    this.renderer = new SidebarRenderer({
      onViewedChange: (path, viewed) => {
        this.setViewedFromSidebar(path, viewed);
      },
      onRetry: () => {
        void this.retry();
      },
      onOpenSetup: () => {
        void sendBackgroundMessage<void>({ type: 'ui:open-popup' }).catch(
          () => {
            this.renderer.showError(
              'Open the GitHub Tweaks toolbar popup to configure your token.',
            );
          },
        );
      },
    });
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.observeDocument();
    document.addEventListener('click', this.onDocumentClick, true);
    this.status = { state: 'loading', ref: this.ref };
    this.renderCurrent();

    const cachedPromise = sendBackgroundMessage<PullRequestFilesSnapshot | null>(
      {
        type: 'cache:get',
        ref: this.ref,
        selection: this.selection,
      },
    );
    const freshPromise = this.loadFresh();

    try {
      const cached = await cachedPromise;
      if (cached && !this.snapshot && !this.stopped) {
        this.applySnapshot(cached);
      }
    } catch {
      // A cache miss or invalid cache should not prevent a fresh request.
    }

    await freshPromise;
  }

  stop(): void {
    this.stopped = true;
    this.loadGeneration += 1;
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('click', this.onDocumentClick, true);
    window.clearTimeout(this.reconcileTimer);
    window.clearTimeout(this.nativeRetryTimer);
    this.renderer.clear();
    this.status = { state: 'idle' };
  }

  getStatus(): PageStatus {
    return this.status;
  }

  async retry(): Promise<void> {
    this.status = { state: 'loading', ref: this.ref };
    this.renderCurrent();
    await this.loadFresh();
  }

  private async loadFresh(): Promise<void> {
    const generation = ++this.loadGeneration;
    try {
      const snapshot =
        await sendBackgroundMessage<PullRequestFilesSnapshot>({
          type: 'pull:load',
          ref: this.ref,
          selection: this.selection,
        });
      if (this.stopped || generation !== this.loadGeneration) {
        return;
      }
      this.applySnapshot(snapshot);
    } catch (error) {
      if (this.stopped || generation !== this.loadGeneration) {
        return;
      }
      const message =
        error instanceof Error ? error.message : 'Unable to load pull request.';
      this.status = { state: 'error', ref: this.ref, message };
      this.renderer.showError(message);
    }
  }

  private applySnapshot(snapshot: PullRequestFilesSnapshot): void {
    // GitHub's API reports a native Viewed click up to ~1.5 s after the page
    // shows it, so files with a loaded button take their state from the page.
    const pageViewed = new Map(
      Array.from(indexNativeViewedButtons(), ([path, button]) => [
        path,
        isNativeViewedPressed(button),
      ]),
    );
    const known = applyViewedOverrides(snapshot, pageViewed);
    for (const file of known.files) {
      if (!this.isMutating(file.path) && !this.intendedViewed.has(file.path)) {
        this.confirmedViewed.set(file.path, isViewed(file.viewedState));
      }
    }
    this.snapshot = applyViewedOverrides(known, this.intendedViewed);
    this.status = {
      state: 'ready',
      ref: this.ref,
      fileCount: snapshot.files.length,
      savedAt: snapshot.savedAt,
    };
    this.renderCurrent();
  }

  private renderCurrent(): void {
    if (this.stopped) {
      return;
    }

    this.observer?.disconnect();
    if (this.snapshot) {
      this.renderer.render(this.snapshot);
    } else if (this.status.state === 'error') {
      this.renderer.showError(this.status.message);
    } else {
      this.renderer.showLoading();
    }
    this.observeDocument();
  }

  private observeDocument(): void {
    if (this.stopped || !document.body) {
      return;
    }

    this.observer ??= new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.target instanceof HTMLButtonElement &&
          isNativeViewedButton(mutation.target)
        ) {
          this.onNativeViewedChange(mutation.target);
          continue;
        }

        if (
          mutation.type === 'childList' &&
          Array.from(mutation.addedNodes).some(
            (node) =>
              node instanceof Element &&
              !node.closest('[data-ght-pr-metadata]'),
          )
        ) {
          this.queueRender();
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-pressed'],
    });
  }

  private queueRender(): void {
    if (this.renderQueued) {
      return;
    }

    this.renderQueued = true;
    window.requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderCurrent();
      this.syncNativeButtons();
    });
  }

  private setViewedFromSidebar(path: string, viewed: boolean): void {
    if (!this.snapshot) {
      return;
    }

    this.renderer.setViewedError(path, null);
    this.intendedViewed.set(path, viewed);
    const click = this.nativeClicks.get(path);
    if (click) {
      click.attempts = 0;
    }
    this.snapshot = updateFileViewedState(this.snapshot, path, viewed);

    // A loaded file goes through GitHub's own button so its page state
    // stays current; unloaded files are set through the API and
    // reconciled when GitHub renders their button.
    if (!this.isMutating(path) && indexNativeViewedButtons().has(path)) {
      this.renderCurrent();
      this.syncNativeButtons();
      return;
    }

    this.queuedMutations.set(path, viewed);
    this.renderCurrent();
    void this.drainMutations(path);
  }

  private isMutating(path: string): boolean {
    return this.runningMutations.has(path) || this.queuedMutations.has(path);
  }

  private async drainMutations(path: string): Promise<void> {
    if (this.runningMutations.has(path)) {
      return;
    }

    this.runningMutations.add(path);
    try {
      for (
        let viewed = this.queuedMutations.get(path);
        viewed !== undefined && this.snapshot && !this.stopped;
        viewed = this.queuedMutations.get(path)
      ) {
        this.queuedMutations.delete(path);
        try {
          await sendBackgroundMessage<void>({
            type: 'pull:set-viewed',
            ref: this.ref,
            selection: this.selection,
            pullRequestId: this.snapshot.pullRequestId,
            path,
            viewed,
          });
          this.confirmedViewed.set(path, viewed);
        } catch (error) {
          if (this.stopped || this.queuedMutations.has(path) || !this.snapshot) {
            continue;
          }
          this.intendedViewed.delete(path);
          this.nativeClicks.delete(path);
          this.snapshot = updateFileViewedState(
            this.snapshot,
            path,
            this.confirmedViewed.get(path) ?? !viewed,
          );
          this.renderer.setViewedError(
            path,
            error instanceof Error
              ? error.message
              : 'Unable to update Viewed state.',
          );
          this.renderCurrent();
        }
      }
    } finally {
      this.runningMutations.delete(path);
    }

    this.syncNativeButtons();
  }

  /** Clicks loaded native Viewed buttons that disagree with the sidebar. */
  private syncNativeButtons(): void {
    if (this.stopped || !this.snapshot) {
      return;
    }
    const paths = Array.from(this.intendedViewed.keys()).filter(
      (path) => !this.isMutating(path),
    );
    if (paths.length === 0) {
      return;
    }

    const buttons = indexNativeViewedButtons();
    const now = Date.now();
    let waiting = false;
    for (const path of paths) {
      const button = buttons.get(path);
      if (!button) {
        continue;
      }

      const viewed = this.intendedViewed.get(path)!;
      const click = this.nativeClicks.get(path);
      if (click && click.at > 0 && now - click.at < NATIVE_CLICK_TIMEOUT_MS) {
        waiting = true;
        continue;
      }

      const pressed = isNativeViewedPressed(button);
      if (pressed === viewed) {
        this.intendedViewed.delete(path);
        this.nativeClicks.delete(path);
        continue;
      }

      if (click && click.attempts >= NATIVE_CLICK_ATTEMPTS) {
        this.giveUpNativeSync(path, viewed, pressed);
        continue;
      }

      this.nativeClicks.set(path, {
        at: now,
        attempts: (click?.attempts ?? 0) + 1,
      });
      waiting = true;
      button.click();
    }

    window.clearTimeout(this.nativeRetryTimer);
    if (waiting) {
      this.nativeRetryTimer = window.setTimeout(
        () => this.syncNativeButtons(),
        NATIVE_CLICK_TIMEOUT_MS,
      );
    }
  }

  private giveUpNativeSync(path: string, viewed: boolean, pressed: boolean): void {
    this.intendedViewed.delete(path);
    this.nativeClicks.delete(path);
    if (!this.snapshot) {
      return;
    }

    if (this.confirmedViewed.get(path) === viewed) {
      this.renderer.setViewedError(
        path,
        'Saved on GitHub, but this page did not update. Reload to sync.',
      );
    } else {
      this.snapshot = updateFileViewedState(this.snapshot, path, pressed);
      this.renderer.setViewedError(
        path,
        'GitHub did not apply the Viewed change.',
      );
    }
    this.renderCurrent();
  }

  private readonly onDocumentClick = (event: Event): void => {
    const target =
      event.target instanceof Element ? event.target.closest('button') : null;
    if (!target || !isNativeViewedButton(target)) {
      return;
    }

    window.setTimeout(() => {
      const path = getNativeViewedPath(target);
      // Sidebar-driven clicks settle through the aria-pressed observer.
      if (path && !this.intendedViewed.has(path)) {
        this.onNativeViewedChange(target);
      }
      this.scheduleReconcile();
    });
  };

  private onNativeViewedChange(button: HTMLButtonElement): void {
    const path = getNativeViewedPath(button);
    if (!path || !this.snapshot) {
      return;
    }

    const viewed = isNativeViewedPressed(button);
    const click = this.nativeClicks.get(path);
    if (click) {
      click.at = 0;
    }

    if (this.isMutating(path)) {
      // The user clicked GitHub's button while an API change was in flight;
      // their latest choice wins on the server too.
      this.intendedViewed.set(path, viewed);
      this.queuedMutations.set(path, viewed);
      void this.drainMutations(path);
    } else if (this.intendedViewed.has(path)) {
      if (this.intendedViewed.get(path) !== viewed) {
        this.syncNativeButtons();
        return;
      }
      this.intendedViewed.delete(path);
      this.nativeClicks.delete(path);
    }

    this.renderer.setViewedError(path, null);
    this.snapshot = updateFileViewedState(this.snapshot, path, viewed);
    this.renderCurrent();
  }

  private scheduleReconcile(): void {
    window.clearTimeout(this.reconcileTimer);
    this.reconcileTimer = window.setTimeout(() => {
      void this.loadFresh();
    }, 750);
  }
}

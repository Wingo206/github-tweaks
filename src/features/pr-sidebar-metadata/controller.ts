import { sendBackgroundMessage } from '../../shared/messaging';
import type {
  PageStatus,
  PullRequestFilesSnapshot,
  PullRequestRef,
} from '../../shared/types';
import {
  getNativeViewedPath,
  isNativeViewedButton,
  SidebarRenderer,
} from './dom';
import { isViewed, updateFileViewedState } from './model';

export class PrSidebarController {
  private readonly renderer: SidebarRenderer;
  private readonly confirmedViewed = new Map<string, boolean>();
  private readonly desiredViewed = new Map<string, boolean>();
  private readonly runningMutations = new Set<string>();
  private observer: MutationObserver | null = null;
  private snapshot: PullRequestFilesSnapshot | null = null;
  private status: PageStatus = { state: 'idle' };
  private stopped = false;
  private loadGeneration = 0;
  private renderQueued = false;
  private reconcileTimer: number | undefined;

  constructor(readonly ref: PullRequestRef) {
    this.renderer = new SidebarRenderer({
      onViewedChange: (path, viewed) => {
        this.setViewed(path, viewed);
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
      { type: 'cache:get', ref: this.ref },
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
    if (this.reconcileTimer !== undefined) {
      window.clearTimeout(this.reconcileTimer);
    }
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
    let next = snapshot;
    for (const path of this.runningMutations) {
      const current = this.snapshot?.files.find((file) => file.path === path);
      if (current) {
        next = updateFileViewedState(next, path, isViewed(current.viewedState));
      }
    }
    for (const [path, viewed] of this.desiredViewed) {
      next = updateFileViewedState(next, path, viewed);
    }

    this.snapshot = next;
    for (const file of snapshot.files) {
      if (
        !this.runningMutations.has(file.path) &&
        !this.desiredViewed.has(file.path)
      ) {
        this.confirmedViewed.set(file.path, isViewed(file.viewedState));
      }
    }
    this.status = {
      state: 'ready',
      ref: this.ref,
      fileCount: next.files.length,
      savedAt: next.savedAt,
    };
    this.renderCurrent();
  }

  private setViewed(path: string, viewed: boolean): void {
    if (!this.snapshot) {
      return;
    }

    this.desiredViewed.set(path, viewed);
    this.snapshot = updateFileViewedState(this.snapshot, path, viewed);
    this.renderCurrent();
    void this.drainViewedMutation(path);
  }

  private async drainViewedMutation(path: string): Promise<void> {
    if (this.runningMutations.has(path) || !this.snapshot) {
      return;
    }

    this.runningMutations.add(path);
    try {
      while (this.desiredViewed.has(path) && this.snapshot) {
        const viewed = this.desiredViewed.get(path);
        this.desiredViewed.delete(path);
        if (viewed === undefined) {
          continue;
        }

        try {
          await sendBackgroundMessage<void>({
            type: 'pull:set-viewed',
            ref: this.ref,
            pullRequestId: this.snapshot.pullRequestId,
            path,
            viewed,
          });
          this.confirmedViewed.set(path, viewed);
        } catch (error) {
          if (!this.desiredViewed.has(path) && this.snapshot) {
            const confirmed = this.confirmedViewed.get(path) ?? !viewed;
            this.snapshot = updateFileViewedState(
              this.snapshot,
              path,
              confirmed,
            );
            this.renderCurrent();
            this.renderer.showFileError(
              path,
              error instanceof Error
                ? error.message
                : 'Unable to update Viewed state.',
            );
          }
        }
      }
    } finally {
      this.runningMutations.delete(path);
    }
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
          this.applyNativeButtonState(mutation.target);
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
    });
  }

  private readonly onDocumentClick = (event: Event): void => {
    const target =
      event.target instanceof Element ? event.target.closest('button') : null;
    if (!target || !isNativeViewedButton(target)) {
      return;
    }

    window.setTimeout(() => {
      this.applyNativeButtonState(target);
      this.scheduleReconcile();
    });
  };

  private applyNativeButtonState(button: HTMLButtonElement): void {
    const path = getNativeViewedPath(button);
    if (!path || !this.snapshot) {
      return;
    }

    const viewed = button.getAttribute('aria-pressed') === 'true';
    this.confirmedViewed.set(path, viewed);
    this.snapshot = updateFileViewedState(this.snapshot, path, viewed);
    this.renderCurrent();
  }

  private scheduleReconcile(): void {
    if (this.reconcileTimer !== undefined) {
      window.clearTimeout(this.reconcileTimer);
    }
    this.reconcileTimer = window.setTimeout(() => {
      void this.loadFresh();
    }, 750);
  }
}

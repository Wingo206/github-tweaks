import { sendBackgroundMessage } from '../../shared/messaging';
import type {
  PageStatus,
  PullRequestChangeSelection,
  PullRequestFilesSnapshot,
  PullRequestRef,
} from '../../shared/types';
import {
  getNativeViewedPath,
  isNativeViewedButton,
  SidebarRenderer,
} from './dom';
import { updateFileViewedState } from './model';

export class PrSidebarController {
  private readonly renderer: SidebarRenderer;
  private observer: MutationObserver | null = null;
  private snapshot: PullRequestFilesSnapshot | null = null;
  private status: PageStatus = { state: 'idle' };
  private stopped = false;
  private loadGeneration = 0;
  private renderQueued = false;
  private reconcileTimer: number | undefined;

  constructor(
    readonly ref: PullRequestRef,
    readonly selection: PullRequestChangeSelection = { kind: 'all' },
  ) {
    this.renderer = new SidebarRenderer({
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
    this.snapshot = snapshot;
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

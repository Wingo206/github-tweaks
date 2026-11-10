import { tracked, trackedObserver } from '../../diagnostics/recorder';
import { sendBackgroundMessage } from '../../shared/messaging';
import { touches } from '../../shared/mutations';
import type { HandbackContext, PullRequestRef } from '../../shared/types';
import { classicAssignees } from './classicDom';
import {
  clearHandbackUi,
  overviewAssignees,
  type AssigneesAdapter,
  type HandbackUiState,
} from './dom';

const ADAPTERS: readonly AssigneesAdapter[] = [
  overviewAssignees,
  // TODO(classic-2): the classic Conversation sidebar.
  classicAssignees,
];

const AREAS = ADAPTERS.map((adapter) => adapter.area).join(', ');

function findAssignees(): { adapter: AssigneesAdapter; root: HTMLElement } | null {
  for (const adapter of ADAPTERS) {
    const root = adapter.findRoot(document);
    if (root) {
      return { adapter, root };
    }
  }
  return null;
}

export class HandbackController {
  private observer: MutationObserver | null = null;
  private context: Pick<
    HandbackContext,
    'viewerLogin' | 'authorLogin'
  > | null = null;
  private uiState: HandbackUiState = 'idle';
  private errorMessage: string | null = null;
  private stopped = false;
  private loadGeneration = 0;
  private syncQueued = false;
  private mutating = false;
  private lastSyncKey = '';

  constructor(readonly ref: PullRequestRef) {}

  async start(): Promise<void> {
    this.stopped = false;
    console.info('[ght-handback] start', this.ref);
    this.observeDocument();
    await this.loadContext();
    this.sync();
  }

  stop(): void {
    this.stopped = true;
    this.loadGeneration += 1;
    this.observer?.disconnect();
    this.observer = null;
    clearHandbackUi();
    this.context = null;
    this.uiState = 'idle';
    this.errorMessage = null;
    this.mutating = false;
    this.lastSyncKey = '';
  }

  private async loadContext(): Promise<void> {
    const generation = ++this.loadGeneration;
    try {
      const context = await sendBackgroundMessage<HandbackContext>({
        type: 'pull:handback-context',
        ref: this.ref,
      });
      if (this.stopped || generation !== this.loadGeneration) {
        return;
      }
      this.context = {
        viewerLogin: context.viewerLogin,
        authorLogin: context.authorLogin,
      };
      console.info('[ght-handback] context', {
        viewer: context.viewerLogin,
        author: context.authorLogin,
        assignees: context.assigneeLogins,
      });
    } catch (error) {
      if (this.stopped || generation !== this.loadGeneration) {
        return;
      }
      // No token / missing access → keep the control hidden.
      this.context = null;
      console.warn(
        '[ght-handback] context failed (button stays hidden)',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private sync(): void {
    if (this.stopped) {
      return;
    }

    this.observer?.disconnect();
    const found = findAssignees();
    if (found && this.context) {
      const result = found.adapter.sync(found.root, {
        viewerLogin: this.context.viewerLogin,
        authorLogin: this.context.authorLogin,
        uiState: this.uiState,
        errorMessage: this.errorMessage,
        onHandback: () => {
          void this.handback();
        },
      });
      if (!result.visible && this.uiState === 'done') {
        this.uiState = 'idle';
      }
      const key = JSON.stringify({
        ...result,
        uiState: this.uiState,
        viewer: this.context.viewerLogin,
        author: this.context.authorLogin,
      });
      if (key !== this.lastSyncKey) {
        this.lastSyncKey = key;
        console.info('[ght-handback] sync', result);
      }
    } else {
      const key = `skip:${!!found}:${!!this.context}`;
      if (key !== this.lastSyncKey) {
        this.lastSyncKey = key;
        console.info('[ght-handback] sync skipped', {
          hasRoot: !!found,
          hasContext: !!this.context,
        });
      }
      clearHandbackUi();
    }
    this.observeDocument();
  }

  private async handback(): Promise<void> {
    if (this.mutating || this.stopped || !this.context) {
      return;
    }

    this.mutating = true;
    this.uiState = 'updating';
    this.errorMessage = null;
    this.sync();

    try {
      await sendBackgroundMessage<HandbackContext>({
        type: 'pull:handback-assignee',
        ref: this.ref,
      });
      if (this.stopped) {
        return;
      }

      const found = findAssignees();
      if (found) {
        await found.adapter.refresh(found.root);
      }

      if (this.stopped) {
        return;
      }

      this.uiState = 'done';
      this.errorMessage = null;
      this.sync();
    } catch (error) {
      if (this.stopped) {
        return;
      }
      this.uiState = 'error';
      this.errorMessage =
        error instanceof Error
          ? error.message
          : 'Couldn’t update assignees.';
      this.sync();
    } finally {
      this.mutating = false;
    }
  }

  private observeDocument(): void {
    if (this.stopped || !document.body) {
      return;
    }

    this.observer ??= trackedObserver('pr-handback-assignee', (records) => {
      if (touches(records, AREAS)) {
        this.queueSync();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private queueSync(): void {
    if (this.syncQueued || this.stopped) {
      return;
    }

    this.syncQueued = true;
    window.requestAnimationFrame(() =>
      tracked('pr-handback-assignee', 'sync', () => {
        this.syncQueued = false;
        this.sync();
      }),
    );
  }
}

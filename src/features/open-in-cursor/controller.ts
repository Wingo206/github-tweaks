import { sendBackgroundMessage } from '../../shared/messaging';
import type { OpenResult } from '../../shared/types';
import {
  clearOpenInCursorUi,
  recordDiffCell,
  syncBlobLineMenu,
  syncBlobToolbar,
  syncChangesThreads,
  syncConversationThreads,
  syncDiffLineMenu,
  syncFileHeaders,
  type Opener,
  type RecordedDiffCell,
} from './dom';
import type { OpenInCursorRoute } from './model';

const defaultOpener: Opener = (target) =>
  sendBackgroundMessage<OpenResult>({ type: 'open-in-cursor', target });

export class OpenInCursorController {
  private observer: MutationObserver | null = null;
  private recordedCell: RecordedDiffCell | null = null;
  private syncQueued = false;
  private stopped = true;

  constructor(
    readonly route: OpenInCursorRoute,
    private readonly open: Opener = defaultOpener,
  ) {}

  start(): void {
    this.stopped = false;
    document.addEventListener('click', this.onClickCapture, true);
    this.sync();
  }

  stop(): void {
    this.stopped = true;
    document.removeEventListener('click', this.onClickCapture, true);
    this.observer?.disconnect();
    this.observer = null;
    this.recordedCell = null;
    clearOpenInCursorUi();
  }

  sync(): void {
    if (this.stopped) {
      return;
    }
    this.observer?.disconnect();
    const route = this.route;
    if (route.kind === 'pull') {
      syncFileHeaders(document, route.ref, this.open);
      syncChangesThreads(document, route.ref, this.open);
      syncConversationThreads(document, route.ref, this.open);
      for (const menu of document.querySelectorAll<HTMLElement>('[role="menu"]')) {
        syncDiffLineMenu(menu, this.recordedCell, route.ref, this.open);
      }
    } else {
      syncBlobToolbar(document, this.open);
      for (const menu of document.querySelectorAll<HTMLElement>(
        '[role="menu"][data-testid="highlighted-line-menu"]',
      )) {
        syncBlobLineMenu(menu, this.open);
      }
    }
    this.observe();
  }

  private readonly onClickCapture = (event: MouseEvent): void => {
    const recorded = recordDiffCell(event.target);
    if (recorded !== undefined) {
      this.recordedCell = recorded;
    }
  };

  private observe(): void {
    if (this.stopped || !document.body) {
      return;
    }
    this.observer ??= new MutationObserver(() => this.queueSync());
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  private queueSync(): void {
    if (this.syncQueued || this.stopped) {
      return;
    }
    this.syncQueued = true;
    window.requestAnimationFrame(() => {
      this.syncQueued = false;
      this.sync();
    });
  }
}

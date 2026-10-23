import { sendBackgroundMessage } from '../../shared/messaging';
import type {
  CheckoutActionResult,
  CheckoutStatusResult,
  CheckoutTarget,
  CloneStatus,
  PullRequestRef,
} from '../../shared/types';
import {
  clearCheckoutUi,
  createButton,
  createMenu,
  findHeadBranchMounts,
  positionMenu,
  renderButton,
  renderMenu,
  syncButtons,
  type MenuView,
} from './dom';
import { checkedOutNames, cloneName, menuEntries, parseHeadBranch, type MenuEntry } from './model';

export interface CheckoutApi {
  status(target: CheckoutTarget): Promise<CheckoutStatusResult>;
  start(target: CheckoutTarget, folder: string): Promise<CheckoutActionResult>;
  focus(folder: string): Promise<CheckoutActionResult>;
}

const backgroundApi: CheckoutApi = {
  status: (target) => sendBackgroundMessage({ type: 'checkout:status', target }),
  start: (target, folder) => sendBackgroundMessage({ type: 'checkout:start', target, folder }),
  focus: (folder) => sendBackgroundMessage({ type: 'checkout:focus', folder }),
};

const POLL_INTERVAL_MS = 1_000;
const POLL_BUDGET_MS = 90_000;

interface OpenMenu {
  element: HTMLElement;
  button: HTMLButtonElement;
  dispose(): void;
}

export class CheckoutBranchController {
  private observer: MutationObserver | null = null;
  private syncQueued = false;
  private stopped = true;
  private target: CheckoutTarget | null = null;
  private clones: CloneStatus[] | null = null;
  private failure: string | null = null;
  private loading = false;
  private refreshSeq = 0;
  private menu: OpenMenu | null = null;
  private busyPath: string | null = null;
  private message: MenuView['message'] = null;
  private poll: { path: string; deadline: number; timer: ReturnType<typeof setTimeout> | null } | null = null;

  private readonly onFocus = (): void => void this.refresh();
  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      void this.refresh();
    }
  };

  constructor(
    readonly route: PullRequestRef,
    private readonly api: CheckoutApi = backgroundApi,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    this.stopped = false;
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.sync();
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener('focus', this.onFocus);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.observer?.disconnect();
    this.observer = null;
    this.stopPoll();
    this.closeMenu();
    clearCheckoutUi();
  }

  sync(): void {
    if (this.stopped) {
      return;
    }
    this.observer?.disconnect();
    if (!this.target) {
      const link = findHeadBranchMounts(document)[0]?.link;
      this.target = link
        ? parseHeadBranch({ href: link.getAttribute('href') ?? '', text: link.textContent ?? '' }, this.route)
        : null;
      if (this.target) {
        void this.refresh();
      }
    }
    if (this.target) {
      this.renderButtons(syncButtons(document, () => this.createBoundButton()));
    }
    this.observe();
  }

  /** Reloads clone status from the companion and re-renders. */
  async refresh(): Promise<void> {
    const target = this.target;
    if (!target || this.stopped) {
      return;
    }
    const seq = ++this.refreshSeq;
    this.loading = true;
    this.renderMenuView();
    let result: CheckoutStatusResult;
    try {
      result = await this.api.status(target);
    } catch (error) {
      result = { status: 'failed', reason: 'failed', message: errorMessage(error) };
    }
    if (seq !== this.refreshSeq || this.stopped) {
      return;
    }
    this.loading = false;
    if (result.status === 'ok') {
      this.clones = result.clones;
      this.failure = null;
    } else {
      this.clones = null;
      this.failure = result.message;
    }
    this.checkPoll();
    this.renderButtons();
    this.renderMenuView();
  }

  private createBoundButton(): HTMLButtonElement {
    const button = createButton();
    button.addEventListener('mousedown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.menu?.button === button) {
        this.closeMenu();
      } else {
        this.openMenu(button);
      }
    });
    return button;
  }

  private renderButtons(
    buttons: Iterable<HTMLButtonElement> = document.querySelectorAll<HTMLButtonElement>(
      'button[data-ght-checkout-branch="button"]',
    ),
  ): void {
    const names = checkedOutNames(this.clones);
    for (const button of buttons) {
      renderButton(button, names);
    }
  }

  private openMenu(button: HTMLButtonElement): void {
    this.closeMenu();
    const element = createMenu();
    document.body.append(element);
    positionMenu(element, button);
    button.setAttribute('aria-expanded', 'true');

    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target && !element.contains(target) && !button.contains(target)) {
        this.closeMenu();
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeMenu();
        button.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        moveFocus(element, event.key === 'ArrowDown' ? 1 : -1);
      }
    };
    const onLayout = (): void => positionMenu(element, button);
    document.addEventListener('mousedown', onPointer);
    element.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onLayout, true);
    window.addEventListener('resize', onLayout);

    this.menu = {
      element,
      button,
      dispose: () => {
        document.removeEventListener('mousedown', onPointer);
        window.removeEventListener('scroll', onLayout, true);
        window.removeEventListener('resize', onLayout);
        element.remove();
        button.setAttribute('aria-expanded', 'false');
      },
    };
    if (!this.poll) {
      this.message = null;
    }
    this.renderMenuView();
    element.focus();
    void this.refresh();
  }

  private closeMenu(): void {
    this.menu?.dispose();
    this.menu = null;
  }

  private renderMenuView(): void {
    const target = this.target;
    if (!this.menu || !target) {
      return;
    }
    const entries = menuEntries(this.clones ?? []);
    const view: MenuView = {
      branch: target.branch,
      repo: `${target.owner}/${target.repository}`,
      phase: this.failure ? 'failed' : this.loading && !this.clones ? 'loading' : 'ready',
      entries,
      busyPath: this.busyPath,
      message: this.message ?? (this.failure ? { text: this.failure, tone: 'error' } : null),
    };
    const element = this.menu.element;
    const hadItems = element.querySelector('[data-path]') !== null;
    renderMenu(element, view, (entry) => void this.select(entry));
    if (!hadItems && document.activeElement === element) {
      element.querySelector<HTMLElement>('[data-path]')?.focus();
    }
  }

  private async select(entry: MenuEntry): Promise<void> {
    const target = this.target;
    if (!target || this.busyPath) {
      return;
    }
    this.busyPath = entry.path;
    this.message = null;
    this.renderMenuView();
    let result: CheckoutActionResult;
    try {
      result =
        entry.action === 'checkout'
          ? await this.api.start(target, entry.path)
          : await this.api.focus(entry.path);
    } catch (error) {
      result = { status: 'failed', message: errorMessage(error) };
    }
    this.busyPath = null;
    if (this.stopped) {
      return;
    }
    switch (result.status) {
      case 'started':
        this.message = {
          text: `Checking out in ${entry.name}. Answer any hook prompts in its Cursor terminal.`,
          tone: 'info',
        };
        this.startPoll(entry.path);
        break;
      case 'checked-out':
        this.message = { text: `Already checked out in ${entry.name}.`, tone: 'info' };
        void this.refresh();
        break;
      case 'focused':
        this.closeMenu();
        return;
      case 'failed':
        this.message = { text: result.message, tone: 'error' };
        void this.refresh();
        break;
    }
    this.renderMenuView();
  }

  private startPoll(path: string): void {
    this.stopPoll();
    this.poll = { path, deadline: this.now() + POLL_BUDGET_MS, timer: null };
    this.schedulePoll();
  }

  private schedulePoll(): void {
    const poll = this.poll;
    if (!poll || poll.timer || this.stopped) {
      return;
    }
    poll.timer = setTimeout(() => {
      poll.timer = null;
      void this.refresh().then(() => this.schedulePoll());
    }, POLL_INTERVAL_MS);
  }

  private checkPoll(): void {
    const poll = this.poll;
    if (!poll) {
      return;
    }
    const clone = this.clones?.find((candidate) => candidate.path === poll.path);
    if (clone?.checkedOut) {
      this.message = { text: `Checked out in ${cloneName(poll.path)}.`, tone: 'info' };
      this.stopPoll();
    } else if (this.now() >= poll.deadline) {
      this.message = {
        text: `${cloneName(poll.path)} hasn’t switched yet. Check its terminal in Cursor.`,
        tone: 'error',
      };
      this.stopPoll();
    }
  }

  private stopPoll(): void {
    if (this.poll?.timer) {
      clearTimeout(this.poll.timer);
    }
    this.poll = null;
  }

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

function moveFocus(menu: HTMLElement, step: number): void {
  const items = [...menu.querySelectorAll<HTMLElement>('[data-path]')];
  if (!items.length) {
    return;
  }
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next = index < 0 ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length;
  items[next]?.focus();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The extension failed.';
}

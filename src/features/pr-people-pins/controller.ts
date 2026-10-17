import { sendBackgroundMessage } from '../../shared/messaging';
import type { PinnedPerson, PullRequestRef } from '../../shared/types';
import { clearPeoplePins, readPerson, syncPeoplePins } from './dom';
import { togglePin } from './model';

export class PeoplePinsController {
  private pins: PinnedPerson[] = [];
  private observer: MutationObserver | null = null;
  private stopped = false;
  private listening = false;
  private syncQueued = false;
  private loadGeneration = 0;
  private saveGeneration = 0;

  constructor(readonly ref: PullRequestRef) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.listen();
    await this.load();
    if (!this.stopped) {
      this.sync();
    }
  }

  stop(): void {
    this.stopped = true;
    this.loadGeneration += 1;
    this.saveGeneration += 1;
    this.observer?.disconnect();
    this.observer = null;
    if (this.listening) {
      document.removeEventListener('click', this.onClick, true);
      document.removeEventListener('change', this.onChange, true);
      document.removeEventListener('toggle', this.onToggle, true);
      document.removeEventListener('input', this.onInput, true);
      this.listening = false;
    }
    clearPeoplePins();
    this.pins = [];
  }

  private async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    const saveAtStart = this.saveGeneration;
    try {
      const pins = await sendBackgroundMessage<PinnedPerson[]>({
        type: 'pins:get',
        owner: this.ref.owner,
        repository: this.ref.repository,
      });
      if (
        this.stopped ||
        generation !== this.loadGeneration ||
        saveAtStart !== this.saveGeneration
      ) {
        return;
      }
      this.pins = pins;
    } catch {
      if (this.stopped || generation !== this.loadGeneration) {
        return;
      }
      this.pins = [];
    }
  }

  private sync(): void {
    if (this.stopped) {
      return;
    }

    this.observer?.disconnect();
    syncPeoplePins(this.pins);
    this.observeDocument();
  }

  private listen(): void {
    if (this.listening) {
      return;
    }

    document.addEventListener('click', this.onClick, true);
    document.addEventListener('change', this.onChange, true);
    document.addEventListener('toggle', this.onToggle, true);
    document.addEventListener('input', this.onInput, true);
    this.listening = true;
  }

  private readonly onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>('[data-ght-pin-button]');
    if (!button) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const label = button.closest('label');
    if (!label) {
      return;
    }

    const person = readPerson(label);
    if (!person) {
      return;
    }

    const next = togglePin(this.pins, person);
    this.pins = next;
    this.sync();
    void this.persist(next);
  };

  private readonly onChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (!target.closest('[data-ght-pinned-row]')) {
      return;
    }
    this.sync();
  };

  private readonly onToggle = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.id !== 'reviewers-select-menu' && target.id !== 'assignees-select-menu') {
      return;
    }
    this.sync();
  };

  private readonly onInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (!target.closest('#reviewers-select-menu, #assignees-select-menu')) {
      return;
    }
    this.sync();
  };

  private async persist(people: PinnedPerson[]): Promise<void> {
    const generation = ++this.saveGeneration;
    try {
      const stored = await sendBackgroundMessage<PinnedPerson[]>({
        type: 'pins:save',
        owner: this.ref.owner,
        repository: this.ref.repository,
        people,
      });
      if (this.stopped || generation !== this.saveGeneration) {
        return;
      }
      this.pins = stored;
      this.sync();
    } catch {
      if (this.stopped || generation !== this.saveGeneration) {
        return;
      }
      await this.load();
      this.sync();
    }
  }

  private observeDocument(): void {
    if (this.stopped || !document.body) {
      return;
    }

    this.observer ??= new MutationObserver(() => {
      this.queueSync();
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
    window.requestAnimationFrame(() => {
      this.syncQueued = false;
      this.sync();
    });
  }
}

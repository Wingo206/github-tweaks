import { tracked, trackedObserver } from '../../diagnostics/recorder';
import { sendBackgroundMessage } from '../../shared/messaging';
import { touches } from '../../shared/mutations';
import type { PinnedPerson, PullRequestRef } from '../../shared/types';
import {
  clearPeoplePins,
  findOption,
  findPanelFor,
  findPeoplePanels,
  personFromButton,
  PIN_BUTTON_ATTRIBUTE,
  PIN_SELECT_ATTRIBUTE,
  readPersonOptions,
  setFilterQuery,
  syncPinButtons,
  syncPinnedSection,
  type PeoplePanel,
} from './dom';
import { loginKey, togglePin, visiblePins } from './model';

/** How long GitHub's picker gets to find a pinned person it isn't listing. */
const SEARCH_TIMEOUT_MS = 4_000;
const SEARCH_POLL_MS = 100;

const OWN_CONTROLS = `[${PIN_BUTTON_ATTRIBUTE}], [${PIN_SELECT_ATTRIBUTE}]`;

/**
 * Pins in GitHub's Reviewers and Assignees pickers. Picking a pinned person
 * clicks GitHub's own option for them, so GitHub makes the change.
 */
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
      document.removeEventListener('pointerdown', this.onPress, true);
      document.removeEventListener('mousedown', this.onPress, true);
      document.removeEventListener('click', this.onClick, true);
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
      if (this.stopped || generation !== this.loadGeneration || saveAtStart !== this.saveGeneration) {
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
    for (const panel of findPeoplePanels()) {
      this.syncPanel(panel);
    }
    this.observeDocument();
  }

  private syncPanel(panel: PeoplePanel): void {
    const options = readPersonOptions(panel);
    syncPinButtons(options, this.pins);
    const selected = new Map(options.map(({ person, selected }) => [loginKey(person.login), selected]));
    syncPinnedSection(
      panel,
      visiblePins(this.pins, panel.input.value).map((person) => ({
        person,
        selected: selected.get(loginKey(person.login)) ?? false,
      })),
    );
  }

  private listen(): void {
    if (this.listening) {
      return;
    }
    // Capture on the document runs before GitHub's handlers, so a pin click
    // never reaches the option it sits in.
    document.addEventListener('pointerdown', this.onPress, true);
    document.addEventListener('mousedown', this.onPress, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('input', this.onInput, true);
    this.listening = true;
  }

  /** Keeps focus in GitHub's filter box, and keeps the press from reaching the option. */
  private readonly onPress = (event: Event): void => {
    const target = event.target;
    if (target instanceof Element && target.closest(OWN_CONTROLS)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private readonly onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const control = target.closest<HTMLElement>(OWN_CONTROLS);
    if (!control) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const person = personFromButton(control);
    if (!person) {
      return;
    }
    if (control.hasAttribute(PIN_BUTTON_ATTRIBUTE)) {
      const next = togglePin(this.pins, person);
      this.pins = next;
      this.sync();
      void this.persist(next);
      return;
    }
    const panel = findPanelFor(control);
    if (panel) {
      void this.selectThroughGitHub(panel, person);
    }
  };

  private readonly onInput = (event: Event): void => {
    if (event.target instanceof HTMLInputElement && findPanelFor(event.target)) {
      this.queueSync();
    }
  };

  /**
   * Clicks GitHub's option for `person`. When the picker isn't listing them,
   * searches for them in its filter box first, then puts the filter back.
   */
  private async selectThroughGitHub(panel: PeoplePanel, person: PinnedPerson): Promise<void> {
    const listed = findOption(panel, person.login);
    if (listed) {
      listed.click();
      return;
    }

    const query = panel.input.value;
    setFilterQuery(panel.input, person.login);
    const found = await this.waitForOption(panel, person.login);
    if (!found || this.stopped || !panel.input.isConnected) {
      return;
    }
    found.click();
    setFilterQuery(panel.input, query);
  }

  private async waitForOption(panel: PeoplePanel, login: string): Promise<HTMLElement | null> {
    for (let waited = 0; waited < SEARCH_TIMEOUT_MS; waited += SEARCH_POLL_MS) {
      if (this.stopped || !panel.root.isConnected) {
        return null;
      }
      const option = findOption(panel, login);
      if (option) {
        return option;
      }
      await new Promise((done) => setTimeout(done, SEARCH_POLL_MS));
    }
    return null;
  }

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
    // GitHub renders its pickers into this portal.
    this.observer ??= trackedObserver('pr-people-pins', (records) => {
      if (touches(records, '#__primerPortalRoot__')) {
        this.queueSync();
      }
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected'],
    });
  }

  private queueSync(): void {
    if (this.syncQueued || this.stopped) {
      return;
    }
    this.syncQueued = true;
    window.requestAnimationFrame(() =>
      tracked('pr-people-pins', 'sync', () => {
        this.syncQueued = false;
        this.sync();
      }),
    );
  }
}

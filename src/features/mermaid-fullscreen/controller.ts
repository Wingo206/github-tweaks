import { requestRenderedSvg } from './bridge';
import { logMermaidViewerFailure } from './errors';
import {
  EMBED_SELECTOR,
  MermaidModal,
  NATIVE_OPEN_SELECTOR,
  OPEN_BUTTON_ATTRIBUTE,
  OPEN_CLASS,
  clearWiredMarkers,
  findAllNativeDetails,
  findMermaidEmbeds,
  findOpenButton,
  findVisibleNativeDetails,
  isNativeFallback,
  isRenderError,
  isWired,
  markNativeFallback,
  markWired,
  mountOpenControl,
  reconcileOpenControl,
  showNativeOpenControl,
  unmountOpenControl,
} from './dom';
import { describeEmbed, outlineElement, traceMermaid } from './trace';

const MOUNT_STUCK_MS = 3000;

interface PendingMount {
  since: number;
  timer: number | null;
}

export class MermaidFullscreenController {
  private observer: MutationObserver | null = null;
  private modal: MermaidModal | null = null;
  private activeEmbed: HTMLElement | null = null;
  private readonly onClickByEmbed = new Map<
    HTMLElement,
    (event: MouseEvent) => void
  >();
  private readonly pendingMounts = new Map<HTMLElement, PendingMount>();
  private readonly reported = new WeakMap<HTMLElement, Set<string>>();
  private stopped = true;
  private scanQueued = false;
  private loadGeneration = 0;

  start(): void {
    this.stopped = false;
    document.addEventListener('click', this.onDocumentClick, true);
    this.observeDocument();
    this.scan();
    traceMermaid('debug', 'start', {
      embeds: findMermaidEmbeds().length,
      wired: this.onClickByEmbed.size,
    });
  }

  stop(): void {
    traceMermaid('debug', 'stop', { wired: this.onClickByEmbed.size });
    this.stopped = true;
    document.removeEventListener('click', this.onDocumentClick, true);
    this.observer?.disconnect();
    this.observer = null;
    this.closeModal();

    for (const pending of this.pendingMounts.values()) {
      if (pending.timer !== null) {
        window.clearTimeout(pending.timer);
      }
    }
    this.pendingMounts.clear();

    for (const [embed, onClick] of this.onClickByEmbed) {
      const button = embed.querySelector<HTMLElement>('[data-ght-mermaid-open]');
      button?.removeEventListener('click', onClick);
      unmountOpenControl(embed);
      findAllNativeDetails(embed).forEach(showNativeOpenControl);
      embed.removeAttribute('data-ght-mermaid-native-fallback');
    }
    this.onClickByEmbed.clear();
    clearWiredMarkers();
    document.documentElement.classList.remove(OPEN_CLASS);
  }

  /** Records what a click near a diagram actually hit, before any handler runs. */
  private onDocumentClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const hit = target.closest(
      `[${OPEN_BUTTON_ATTRIBUTE}], ${NATIVE_OPEN_SELECTOR}, ${EMBED_SELECTOR}`,
    );
    if (!hit) {
      return;
    }

    const embed = target.closest<HTMLElement>(EMBED_SELECTOR);
    const onOurButton = target.closest(`[${OPEN_BUTTON_ATTRIBUTE}]`) !== null;
    const listening = embed ? this.onClickByEmbed.has(embed) : false;
    const describe = (element: Element): string => {
      const classes = Array.from(element.classList).slice(0, 4).join('.');
      const label = element.getAttribute('aria-label');
      return `${element.localName}${classes ? `.${classes}` : ''}${label ? `[aria-label="${label}"]` : ''}`;
    };

    traceMermaid(onOurButton && !listening ? 'warn' : 'debug', 'click', {
      target: describe(target),
      hit: describe(hit),
      onOurButton,
      onNativeOpen: target.closest(NATIVE_OPEN_SELECTOR) !== null,
      insideEmbed: embed !== null,
      identity: embed?.dataset.identity ?? null,
      listening,
    });
  };

  private observeDocument(): void {
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => this.queueScan());
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  private queueScan(): void {
    if (this.stopped || this.scanQueued) {
      return;
    }
    this.scanQueued = true;
    queueMicrotask(() => {
      this.scanQueued = false;
      if (!this.stopped) {
        this.scan();
      }
    });
  }

  private scan(): void {
    for (const embed of findMermaidEmbeds()) {
      if (isNativeFallback(embed)) {
        continue;
      }
      if (isWired(embed)) {
        this.checkWired(embed);
        continue;
      }

      const button = mountOpenControl(embed);
      if (!button) {
        this.notePendingMount(embed);
        continue;
      }

      const onClick = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        this.openForEmbed(embed);
      };
      button.addEventListener('click', onClick);
      this.onClickByEmbed.set(embed, onClick);
      markWired(embed);
      this.noteMounted(embed);
    }
  }

  /** Wired markers and our button can outlive the listener (e.g. a cloned page snapshot). */
  private checkWired(embed: HTMLElement): void {
    if (!this.onClickByEmbed.has(embed)) {
      this.warnOnce(embed, 'wired-without-listener');
      return;
    }
    if (!findOpenButton(embed)) {
      this.warnOnce(embed, 'open-button-removed');
      return;
    }
    if (findVisibleNativeDetails(embed).length === 0) {
      return;
    }
    const before = describeEmbed(embed);
    const repair = reconcileOpenControl(embed);
    this.warnOnce(embed, 'native-control-reshown', { ...before, ...repair });
  }

  private warnOnce(
    embed: HTMLElement,
    event: string,
    data: Record<string, unknown> = describeEmbed(embed),
  ): void {
    const events = this.reported.get(embed) ?? new Set<string>();
    if (events.has(event)) {
      return;
    }
    events.add(event);
    this.reported.set(embed, events);
    traceMermaid(isRenderError(embed) ? 'debug' : 'warn', event, data);
  }

  private notePendingMount(embed: HTMLElement): void {
    if (this.pendingMounts.has(embed)) {
      return;
    }
    const pending: PendingMount = { since: performance.now(), timer: null };
    pending.timer = window.setTimeout(() => {
      pending.timer = null;
      if (this.stopped || this.pendingMounts.get(embed) !== pending) {
        return;
      }
      if (!embed.isConnected) {
        this.pendingMounts.delete(embed);
        return;
      }
      traceMermaid(isRenderError(embed) ? 'debug' : 'warn', 'mount-stuck', {
        waitedMs: Math.round(performance.now() - pending.since),
        ...describeEmbed(embed),
        outline: outlineElement(embed),
      });
    }, MOUNT_STUCK_MS);
    this.pendingMounts.set(embed, pending);
  }

  private noteMounted(embed: HTMLElement): void {
    const pending = this.pendingMounts.get(embed);
    if (pending?.timer != null) {
      window.clearTimeout(pending.timer);
    }
    this.pendingMounts.delete(embed);
    traceMermaid('debug', 'mounted', {
      identity: embed.dataset.identity ?? null,
      waitedMs: pending ? Math.round(performance.now() - pending.since) : 0,
    });
  }

  private openForEmbed(embed: HTMLElement): void {
    if (this.stopped || isNativeFallback(embed)) {
      traceMermaid('warn', 'open-ignored', {
        reason: this.stopped ? 'controller-stopped' : 'native-fallback',
        ...describeEmbed(embed),
      });
      return;
    }

    if (this.modal && this.activeEmbed === embed) {
      // The modal covers the page, so a click reaching here means it is not visible.
      traceMermaid('warn', 'open-ignored', {
        reason: 'already-open',
        modalConnected: this.modal.isConnected,
        modalState: this.modal.state,
        openClass: document.documentElement.classList.contains(OPEN_CLASS),
        ...describeEmbed(embed),
      });
      return;
    }

    traceMermaid('debug', 'open', describeEmbed(embed));
    this.closeModal();
    this.activeEmbed = embed;
    this.modal = new MermaidModal({
      onClose: () => this.closeModal(),
      onRetry: () => {
        if (this.activeEmbed) {
          void this.loadSvg(this.activeEmbed);
        }
      },
      onShowNative: () => this.fallbackToNative(embed),
    });
    void this.loadSvg(embed);
  }

  private async loadSvg(embed: HTMLElement): Promise<void> {
    const modal = this.modal;
    if (!modal || this.activeEmbed !== embed) {
      return;
    }

    const generation = ++this.loadGeneration;
    modal.showLoading();

    const startedAt = performance.now();
    const result = await requestRenderedSvg(embed);
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (
      this.stopped ||
      generation !== this.loadGeneration ||
      this.modal !== modal ||
      this.activeEmbed !== embed
    ) {
      traceMermaid('debug', 'load-discarded', {
        elapsedMs,
        ok: result.ok,
        stopped: this.stopped,
        superseded: generation !== this.loadGeneration,
        modalChanged: this.modal !== modal,
      });
      return;
    }

    if (!result.ok) {
      logMermaidViewerFailure({
        reason: result.reason,
        detail: result.detail,
      });
      modal.showError();
      return;
    }

    if (!modal.showSvg(result.svg)) {
      logMermaidViewerFailure({
        reason: 'invalid-svg',
        detail: modal.parseError ?? 'Rendered SVG could not be parsed.',
      });
      return;
    }

    const render = modal.renderInfo;
    const suspicious =
      !render ||
      !render.fitted ||
      render.contentWidth <= 1 ||
      render.contentHeight <= 1 ||
      render.renderedWidth < 2 ||
      render.renderedHeight < 2 ||
      !modal.isConnected;
    traceMermaid(suspicious ? 'warn' : 'debug', 'rendered', {
      identity: embed.dataset.identity ?? null,
      elapsedMs,
      svgLength: result.svg.length,
      modalConnected: modal.isConnected,
      ...render,
    });
  }

  private fallbackToNative(embed: HTMLElement): void {
    traceMermaid('debug', 'native-fallback', describeEmbed(embed));
    const onClick = this.onClickByEmbed.get(embed);
    const button = embed.querySelector<HTMLElement>('[data-ght-mermaid-open]');
    if (onClick && button) {
      button.removeEventListener('click', onClick);
    }
    this.onClickByEmbed.delete(embed);
    unmountOpenControl(embed);
    findAllNativeDetails(embed).forEach(showNativeOpenControl);
    markNativeFallback(embed);
    embed.removeAttribute('data-ght-mermaid-wired');
    this.closeModal();
  }

  private closeModal(): void {
    this.loadGeneration += 1;
    this.modal?.teardown();
    this.modal = null;
    this.activeEmbed = null;
  }
}

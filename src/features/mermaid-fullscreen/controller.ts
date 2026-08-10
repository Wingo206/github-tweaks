import { requestRenderedSvg } from './bridge';
import {
  MermaidModal,
  clearWiredMarkers,
  findMermaidEmbeds,
  findNativeDetails,
  isNativeFallback,
  isWired,
  markNativeFallback,
  markWired,
  mountOpenControl,
  showNativeOpenControl,
  unmountOpenControl,
} from './dom';

export class MermaidFullscreenController {
  private observer: MutationObserver | null = null;
  private modal: MermaidModal | null = null;
  private activeEmbed: HTMLElement | null = null;
  private readonly onClickByEmbed = new Map<
    HTMLElement,
    (event: MouseEvent) => void
  >();
  private stopped = true;
  private scanQueued = false;
  private loadGeneration = 0;

  start(): void {
    this.stopped = false;
    this.observeDocument();
    this.scan();
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    this.observer = null;
    this.closeModal();

    for (const [embed, onClick] of this.onClickByEmbed) {
      const button = embed.querySelector<HTMLElement>('[data-ght-mermaid-open]');
      button?.removeEventListener('click', onClick);
      unmountOpenControl(embed);
      const details = findNativeDetails(embed);
      if (details) {
        showNativeOpenControl(details);
      }
      embed.removeAttribute('data-ght-mermaid-native-fallback');
    }
    this.onClickByEmbed.clear();
    clearWiredMarkers();
    document.documentElement.classList.remove('ght-mermaid-open');
  }

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
      if (isWired(embed) || isNativeFallback(embed)) {
        continue;
      }

      const button = mountOpenControl(embed);
      if (!button) {
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
    }
  }

  private openForEmbed(embed: HTMLElement): void {
    if (this.stopped || isNativeFallback(embed)) {
      return;
    }

    if (this.modal && this.activeEmbed === embed) {
      return;
    }

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

    const svgMarkup = await requestRenderedSvg(embed);
    if (
      this.stopped ||
      generation !== this.loadGeneration ||
      this.modal !== modal ||
      this.activeEmbed !== embed
    ) {
      return;
    }

    if (!svgMarkup || !modal.showSvg(svgMarkup)) {
      modal.showError();
    }
  }

  private fallbackToNative(embed: HTMLElement): void {
    const onClick = this.onClickByEmbed.get(embed);
    const button = embed.querySelector<HTMLElement>('[data-ght-mermaid-open]');
    if (onClick && button) {
      button.removeEventListener('click', onClick);
    }
    this.onClickByEmbed.delete(embed);
    unmountOpenControl(embed);

    const details = findNativeDetails(embed);
    if (details) {
      showNativeOpenControl(details);
    }
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

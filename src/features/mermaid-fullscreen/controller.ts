import {
  MermaidDialogEnhancer,
  clearWiredMarkers,
  enhanceOpenDialog,
  findMermaidDetails,
  findMermaidEmbeds,
  isWired,
  markWired,
} from './dom';

export class MermaidFullscreenController {
  private observer: MutationObserver | null = null;
  private readonly enhancements = new Map<
    HTMLDetailsElement,
    MermaidDialogEnhancer
  >();
  private readonly onToggleByDetails = new Map<
    HTMLDetailsElement,
    () => void
  >();
  private stopped = true;
  private scanQueued = false;

  start(): void {
    this.stopped = false;
    this.observeDocument();
    this.scan();
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    this.observer = null;

    for (const [details, onToggle] of this.onToggleByDetails) {
      details.removeEventListener('toggle', onToggle);
    }
    this.onToggleByDetails.clear();

    for (const enhancer of this.enhancements.values()) {
      enhancer.teardown();
    }
    this.enhancements.clear();
    clearWiredMarkers();
    document.documentElement.classList.remove('ght-mermaid-enhanced-open');
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
      const details = findMermaidDetails(embed);
      if (!details || isWired(details)) {
        continue;
      }

      const onToggle = (): void => {
        this.handleToggle(details);
      };
      details.addEventListener('toggle', onToggle);
      this.onToggleByDetails.set(details, onToggle);
      markWired(details);

      if (details.open) {
        this.handleToggle(details);
      }
    }
  }

  private handleToggle(details: HTMLDetailsElement): void {
    if (this.stopped) {
      return;
    }

    if (details.open) {
      if (this.enhancements.has(details)) {
        return;
      }
      // Let GitHub finish opening / enriching the dialog before we wrap it.
      requestAnimationFrame(() => {
        if (this.stopped || !details.open || this.enhancements.has(details)) {
          return;
        }
        const enhancer = enhanceOpenDialog(details);
        if (enhancer) {
          this.enhancements.set(details, enhancer);
        }
      });
      return;
    }

    const enhancer = this.enhancements.get(details);
    if (enhancer) {
      enhancer.teardown();
      this.enhancements.delete(details);
    }
  }
}

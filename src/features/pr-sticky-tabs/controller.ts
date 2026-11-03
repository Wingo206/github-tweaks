import {
  clearStickyTabs,
  createNav,
  findNativeLineCounts,
  findNativeTabs,
  showsLineCounts,
  syncTabs,
  type NativeTab,
} from './dom';
import { isPlainClick, type LineCounts } from './model';

/**
 * Mirrors GitHub's pull request tab bar and line totals into the sticky header.
 * Plain clicks are forwarded to GitHub's own tab link so it navigates in-page;
 * clicking the current tab scrolls to the top instead.
 */
export class StickyTabsController {
  private observer: MutationObserver | null = null;
  private syncQueued = false;
  private stopped = true;

  start(): void {
    this.stopped = false;
    this.sync();
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    this.observer = null;
    clearStickyTabs();
  }

  sync(): void {
    if (this.stopped) {
      return;
    }
    this.observer?.disconnect();
    const tabs = findNativeTabs(document);
    const lines = showsLineCounts(tabs) ? findNativeLineCounts(document) : null;
    syncTabs(document, tabs, lines, (tabs, lines) => this.createBoundNav(tabs, lines));
    this.observe();
  }

  private createBoundNav(tabs: readonly NativeTab[], lines: LineCounts | null): HTMLElement {
    const nav = createNav(tabs, lines);
    nav.addEventListener('click', (event) => this.onClick(event));
    return nav;
  }

  private onClick(event: MouseEvent): void {
    const link = (event.target as Element | null)?.closest?.('a.ght-pst-tab');
    if (!link || !isPlainClick(event)) {
      return;
    }
    const native = findNativeTabs(document).find((tab) => tab.href === link.getAttribute('href'));
    if (!native) {
      return;
    }
    event.preventDefault();
    if (native.current) {
      window.scrollTo({ top: 0 });
    } else {
      native.link.click();
    }
  }

  private observe(): void {
    if (this.stopped || !document.body) {
      return;
    }
    this.observer ??= new MutationObserver(() => this.queueSync());
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-current'],
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

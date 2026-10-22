import { MERMAID_OPEN_CLASS } from '../../shared/pageSignals';
import {
  FAVICON_MODES,
  prefixTitle,
  renderFavicon,
  type FaviconMode,
  type PrTab,
} from './model';

export const ORIGINAL_HREF = 'data-ght-favicon-href';
export const ORIGINAL_TYPE = 'data-ght-favicon-type';

const ICON_LINKS = 'link[rel~="icon"]';
const OWN_HREFS = new Set(FAVICON_MODES.map(renderFavicon));

/**
 * Keeps the tab favicon and title marked for one PR tab, or for a diagram
 * while the Mermaid fullscreen viewer is open over it. GitHub rewrites the
 * favicon for CI status and the title on navigation, so both are re-applied
 * whenever `<head>` changes, and GitHub's latest values are what `stop`
 * restores.
 */
export class PrTabMarker {
  private headObserver: MutationObserver | null = null;
  private rootObserver: MutationObserver | null = null;
  private baseTitle = '';
  private appliedTitle: string | null = null;

  constructor(
    private readonly doc: Document,
    private tab: PrTab,
  ) {}

  start(): void {
    this.sync();
    this.headObserver = new MutationObserver(() => this.sync());
    this.headObserver.observe(this.doc.head, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href'],
    });
    this.rootObserver = new MutationObserver(() => this.sync());
    this.rootObserver.observe(this.doc.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  setTab(tab: PrTab): void {
    if (tab !== this.tab) {
      this.tab = tab;
      this.sync();
    }
  }

  stop(): void {
    this.headObserver?.disconnect();
    this.headObserver = null;
    this.rootObserver?.disconnect();
    this.rootObserver = null;

    for (const link of this.doc.head.querySelectorAll<HTMLLinkElement>(ICON_LINKS)) {
      const href = link.getAttribute(ORIGINAL_HREF);
      if (href === null) {
        continue;
      }
      link.setAttribute('href', href);
      restoreAttribute(link, 'type', link.getAttribute(ORIGINAL_TYPE));
      link.removeAttribute(ORIGINAL_HREF);
      link.removeAttribute(ORIGINAL_TYPE);
    }

    if (this.appliedTitle !== null && this.doc.title === this.appliedTitle) {
      this.doc.title = this.baseTitle;
    }
    this.appliedTitle = null;
  }

  private mode(): FaviconMode {
    return this.doc.documentElement.classList.contains(MERMAID_OPEN_CLASS) ? 'diagram' : this.tab;
  }

  private sync(): void {
    const mode = this.mode();
    const href = renderFavicon(mode);
    for (const link of this.doc.head.querySelectorAll<HTMLLinkElement>(ICON_LINKS)) {
      const current = link.getAttribute('href') ?? '';
      if (current === href) {
        continue;
      }
      if (!OWN_HREFS.has(current)) {
        link.setAttribute(ORIGINAL_HREF, current);
        if (!link.hasAttribute(ORIGINAL_TYPE)) {
          link.setAttribute(ORIGINAL_TYPE, link.getAttribute('type') ?? '');
        }
      }
      link.setAttribute('type', 'image/svg+xml');
      link.setAttribute('href', href);
    }

    const title = this.doc.title;
    if (title !== this.appliedTitle) {
      this.baseTitle = title;
    }
    this.appliedTitle = prefixTitle(this.baseTitle, mode);
    if (title !== this.appliedTitle) {
      this.doc.title = this.appliedTitle;
    }
  }
}

function restoreAttribute(element: Element, name: string, value: string | null): void {
  if (value) {
    element.setAttribute(name, value);
  } else {
    element.removeAttribute(name);
  }
}

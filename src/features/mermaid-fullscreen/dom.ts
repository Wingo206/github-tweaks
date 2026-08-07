import {
  DEFAULT_TRANSFORM,
  isPanButton,
  pan,
  toCssTransform,
  type ViewportTransform,
  wheelZoomFactor,
  zoomAt,
} from './model';

export const EMBED_SELECTOR =
  'section.js-render-needs-enrichment[data-type="mermaid"]';
export const OPEN_BUTTON_SELECTOR = 'summary[aria-label="Open dialog"]';
export const DIALOG_SELECTOR = 'details-dialog.render-full-screen';
export const WIRED_ATTRIBUTE = 'data-ght-mermaid-wired';
export const ENHANCED_ATTRIBUTE = 'data-ght-mermaid-enhanced';
export const VIEWPORT_CLASS = 'ght-mermaid-viewport';
export const STAGE_CLASS = 'ght-mermaid-stage';

export function findMermaidEmbeds(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(EMBED_SELECTOR));
}

export function findOpenButton(embed: HTMLElement): HTMLElement | null {
  return embed.querySelector<HTMLElement>(OPEN_BUTTON_SELECTOR);
}

export function findMermaidDetails(embed: HTMLElement): HTMLDetailsElement | null {
  const button = findOpenButton(embed);
  const details = button?.closest('details');
  return details instanceof HTMLDetailsElement ? details : null;
}

export function findFullscreenDialog(
  details: HTMLDetailsElement,
): HTMLElement | null {
  return details.querySelector<HTMLElement>(DIALOG_SELECTOR);
}

export function findFullscreenRenderTarget(
  dialog: HTMLElement,
): HTMLElement | null {
  return dialog.querySelector<HTMLElement>(
    '.js-render-target[data-type="mermaid"]',
  );
}

export function isWired(details: HTMLDetailsElement): boolean {
  return details.hasAttribute(WIRED_ATTRIBUTE);
}

export function markWired(details: HTMLDetailsElement): void {
  details.setAttribute(WIRED_ATTRIBUTE, 'true');
}

export function clearWiredMarkers(root: ParentNode = document): void {
  root.querySelectorAll(`[${WIRED_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(WIRED_ATTRIBUTE);
  });
}

/**
 * Expands GitHub's native Mermaid dialog to ~90% of the viewport and adds
 * pan/zoom around the already-loaded render target. Reparents the dialog to
 * `document.body` so `position: fixed` is not trapped by GitHub layout
 * ancestors (e.g. transformed PR columns).
 */
export class MermaidDialogEnhancer {
  private readonly dialog: HTMLElement;
  private readonly dialogParent: Node;
  private readonly dialogNextSibling: Node | null;
  private readonly dialogPlaceholder: Comment;
  private readonly renderTarget: HTMLElement;
  private readonly renderParent: Node;
  private readonly renderNextSibling: Node | null;
  private readonly viewport: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly previousHeight: string | null;
  private transform: ViewportTransform = { ...DEFAULT_TRANSFORM };
  private dragging = false;
  private activePointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private active = true;

  constructor(dialog: HTMLElement, renderTarget: HTMLElement) {
    this.dialog = dialog;
    this.dialogParent = dialog.parentNode!;
    this.dialogNextSibling = dialog.nextSibling;
    this.dialogPlaceholder = document.createComment('ght-mermaid-dialog');
    this.renderTarget = renderTarget;
    this.renderParent = renderTarget.parentNode!;
    this.renderNextSibling = renderTarget.nextSibling;
    this.previousHeight = renderTarget.style.height || null;

    this.viewport = document.createElement('div');
    this.viewport.className = VIEWPORT_CLASS;

    this.stage = document.createElement('div');
    this.stage.className = STAGE_CLASS;

    this.stage.append(renderTarget);
    this.viewport.append(this.stage);
    this.renderParent.insertBefore(this.viewport, this.renderNextSibling);

    this.dialogParent.insertBefore(this.dialogPlaceholder, this.dialog);
    document.body.append(this.dialog);

    this.dialog.classList.add('ght-mermaid-enhanced');
    this.dialog.setAttribute(ENHANCED_ATTRIBUTE, 'true');
    // Neutralize GitHub's centering transform if it was applied as an inline style.
    this.dialog.style.setProperty('transform', 'none', 'important');
    this.renderTarget.style.setProperty('height', '100%', 'important');
    document.documentElement.classList.add('ght-mermaid-enhanced-open');

    this.viewport.addEventListener('pointerdown', this.onPointerDown);
    this.viewport.addEventListener('pointermove', this.onPointerMove);
    this.viewport.addEventListener('pointerup', this.onPointerUp);
    this.viewport.addEventListener('pointercancel', this.onPointerUp);
    this.viewport.addEventListener('wheel', this.onWheel, { passive: false });
    this.viewport.addEventListener('auxclick', this.onAuxClick);

    this.applyTransform();
  }

  get currentTransform(): ViewportTransform {
    return this.transform;
  }

  get isActive(): boolean {
    return this.active;
  }

  teardown(): void {
    if (!this.active) {
      return;
    }
    this.active = false;

    this.viewport.removeEventListener('pointerdown', this.onPointerDown);
    this.viewport.removeEventListener('pointermove', this.onPointerMove);
    this.viewport.removeEventListener('pointerup', this.onPointerUp);
    this.viewport.removeEventListener('pointercancel', this.onPointerUp);
    this.viewport.removeEventListener('wheel', this.onWheel);
    this.viewport.removeEventListener('auxclick', this.onAuxClick);

    if (this.previousHeight) {
      this.renderTarget.style.height = this.previousHeight;
    } else {
      this.renderTarget.style.removeProperty('height');
    }
    this.dialog.style.removeProperty('transform');

    this.renderParent.insertBefore(this.renderTarget, this.renderNextSibling);
    this.viewport.remove();

    this.dialog.classList.remove('ght-mermaid-enhanced');
    this.dialog.removeAttribute(ENHANCED_ATTRIBUTE);

    if (this.dialogPlaceholder.isConnected) {
      this.dialogPlaceholder.replaceWith(this.dialog);
    } else if (this.dialogParent.isConnected) {
      this.dialogParent.insertBefore(this.dialog, this.dialogNextSibling);
    } else {
      this.dialog.remove();
    }

    if (!document.querySelector(`[${ENHANCED_ATTRIBUTE}]`)) {
      document.documentElement.classList.remove('ght-mermaid-enhanced-open');
    }
  }

  private applyTransform(): void {
    this.stage.style.transform = toCssTransform(this.transform);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!isPanButton(event.button)) {
      return;
    }

    event.preventDefault();
    this.dragging = true;
    this.activePointerId = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.viewport.classList.add(`${VIEWPORT_CLASS}--dragging`);
    this.viewport.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.activePointerId) {
      return;
    }

    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.transform = pan(this.transform, dx, dy);
    this.applyTransform();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }

    this.dragging = false;
    this.activePointerId = null;
    this.viewport.classList.remove(`${VIEWPORT_CLASS}--dragging`);
    if (this.viewport.hasPointerCapture(event.pointerId)) {
      this.viewport.releasePointerCapture(event.pointerId);
    }
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.viewport.getBoundingClientRect();
    this.transform = zoomAt(
      this.transform,
      event.clientX - rect.left,
      event.clientY - rect.top,
      wheelZoomFactor(event.deltaY),
    );
    this.applyTransform();
  };

  private onAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };
}

export function enhanceOpenDialog(
  details: HTMLDetailsElement,
): MermaidDialogEnhancer | null {
  const dialog = findFullscreenDialog(details);
  if (!dialog || dialog.hasAttribute(ENHANCED_ATTRIBUTE)) {
    return null;
  }

  const renderTarget = findFullscreenRenderTarget(dialog);
  if (!renderTarget) {
    return null;
  }

  return new MermaidDialogEnhancer(dialog, renderTarget);
}

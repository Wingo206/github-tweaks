import {
  DEFAULT_TRANSFORM,
  isPanButton,
  offsetFromThumbPosition,
  pan,
  scrollbarMetrics,
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
export const SCROLLBAR_X_CLASS = 'ght-mermaid-scrollbar ght-mermaid-scrollbar--x';
export const SCROLLBAR_Y_CLASS = 'ght-mermaid-scrollbar ght-mermaid-scrollbar--y';
export const THUMB_CLASS = 'ght-mermaid-scrollbar__thumb';

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

type ScrollAxis = 'x' | 'y';

/**
 * Expands GitHub's native Mermaid dialog to ~90% of the viewport and adds
 * free pan/zoom around the already-loaded render target, with custom
 * scrollbars as position chrome. Reparents the dialog to `document.body` so
 * `position: fixed` is not trapped by GitHub layout ancestors.
 */
export class MermaidDialogEnhancer {
  private readonly details: HTMLDetailsElement;
  private readonly dialog: HTMLElement;
  private readonly dialogParent: Node;
  private readonly dialogNextSibling: Node | null;
  private readonly dialogPlaceholder: Comment;
  private readonly renderTarget: HTMLElement;
  private readonly renderParent: Node;
  private readonly renderNextSibling: Node | null;
  private readonly viewport: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly scrollbarX: HTMLElement;
  private readonly scrollbarY: HTMLElement;
  private readonly thumbX: HTMLElement;
  private readonly thumbY: HTMLElement;
  private readonly closeButton: HTMLElement | null;
  private readonly previousHeight: string | null;
  private transform: ViewportTransform = { ...DEFAULT_TRANSFORM };
  private baseWidth = 0;
  private baseHeight = 0;
  private draggingCanvas = false;
  private draggingThumb: ScrollAxis | null = null;
  private activePointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private thumbGrabOffset = 0;
  private active = true;

  constructor(
    details: HTMLDetailsElement,
    dialog: HTMLElement,
    renderTarget: HTMLElement,
  ) {
    this.details = details;
    this.dialog = dialog;
    this.dialogParent = dialog.parentNode!;
    this.dialogNextSibling = dialog.nextSibling;
    this.dialogPlaceholder = document.createComment('ght-mermaid-dialog');
    this.renderTarget = renderTarget;
    this.renderParent = renderTarget.parentNode!;
    this.renderNextSibling = renderTarget.nextSibling;
    this.previousHeight = renderTarget.style.height || null;
    this.closeButton = dialog.querySelector<HTMLElement>(
      '[data-close-dialog], [aria-label="Close dialog"]',
    );

    this.viewport = document.createElement('div');
    this.viewport.className = VIEWPORT_CLASS;

    this.stage = document.createElement('div');
    this.stage.className = STAGE_CLASS;

    this.scrollbarX = document.createElement('div');
    this.scrollbarX.className = SCROLLBAR_X_CLASS;
    this.scrollbarX.setAttribute('role', 'scrollbar');
    this.scrollbarX.setAttribute('aria-orientation', 'horizontal');
    this.thumbX = document.createElement('div');
    this.thumbX.className = THUMB_CLASS;
    this.scrollbarX.append(this.thumbX);

    this.scrollbarY = document.createElement('div');
    this.scrollbarY.className = SCROLLBAR_Y_CLASS;
    this.scrollbarY.setAttribute('role', 'scrollbar');
    this.scrollbarY.setAttribute('aria-orientation', 'vertical');
    this.thumbY = document.createElement('div');
    this.thumbY.className = THUMB_CLASS;
    this.scrollbarY.append(this.thumbY);

    this.stage.append(renderTarget);
    this.viewport.append(this.stage, this.scrollbarX, this.scrollbarY);
    this.renderParent.insertBefore(this.viewport, this.renderNextSibling);

    this.dialogParent.insertBefore(this.dialogPlaceholder, this.dialog);
    document.body.append(this.dialog);

    this.dialog.classList.add('ght-mermaid-enhanced');
    this.dialog.setAttribute(ENHANCED_ATTRIBUTE, 'true');
    this.dialog.style.setProperty('transform', 'none', 'important');
    this.renderTarget.style.setProperty('height', '100%', 'important');
    this.renderTarget.style.setProperty('width', '100%', 'important');
    document.documentElement.classList.add('ght-mermaid-enhanced-open');

    this.viewport.addEventListener('pointerdown', this.onPointerDown);
    this.viewport.addEventListener('pointermove', this.onPointerMove);
    this.viewport.addEventListener('pointerup', this.onPointerUp);
    this.viewport.addEventListener('pointercancel', this.onPointerUp);
    this.viewport.addEventListener('wheel', this.onWheel, { passive: false });
    this.viewport.addEventListener('auxclick', this.onAuxClick);
    this.closeButton?.addEventListener('click', this.onCloseClick, true);
    document.addEventListener('keydown', this.onKeyDown, true);

    this.measureBaseSize();
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
    this.closeButton?.removeEventListener('click', this.onCloseClick, true);
    document.removeEventListener('keydown', this.onKeyDown, true);

    this.renderTarget.style.removeProperty('width');
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

  private measureBaseSize(): void {
    this.baseWidth = Math.max(1, this.viewport.clientWidth);
    this.baseHeight = Math.max(1, this.viewport.clientHeight);
  }

  private applyTransform(): void {
    this.stage.style.transform = toCssTransform(this.transform);
    this.syncScrollbars();
  }

  private syncScrollbars(): void {
    const viewportW = this.viewport.clientWidth;
    const viewportH = this.viewport.clientHeight;
    const contentW = this.baseWidth * this.transform.scale;
    const contentH = this.baseHeight * this.transform.scale;

    const x = scrollbarMetrics(
      this.transform.x,
      viewportW,
      contentW,
      this.scrollbarX.clientWidth,
    );
    const y = scrollbarMetrics(
      this.transform.y,
      viewportH,
      contentH,
      this.scrollbarY.clientHeight,
    );

    this.scrollbarX.classList.toggle('ght-mermaid-scrollbar--inactive', x.inactive);
    this.scrollbarY.classList.toggle('ght-mermaid-scrollbar--inactive', y.inactive);
    this.thumbX.style.width = `${x.thumbSize}px`;
    this.thumbX.style.transform = `translateX(${x.thumbOffset}px)`;
    this.thumbY.style.height = `${y.thumbSize}px`;
    this.thumbY.style.transform = `translateY(${y.thumbOffset}px)`;
    this.scrollbarX.setAttribute('aria-valuenow', String(Math.round(-this.transform.x)));
    this.scrollbarY.setAttribute('aria-valuenow', String(Math.round(-this.transform.y)));
  }

  private requestClose(): void {
    if (this.details.open) {
      this.details.open = false;
    }
  }

  private onCloseClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.requestClose();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.requestClose();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!isPanButton(event.button)) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest(`.${THUMB_CLASS}`)) {
      const axis: ScrollAxis = target.closest('.ght-mermaid-scrollbar--x')
        ? 'x'
        : 'y';
      const thumb = axis === 'x' ? this.thumbX : this.thumbY;
      const track = axis === 'x' ? this.scrollbarX : this.scrollbarY;
      const trackRect = track.getBoundingClientRect();
      const thumbRect = thumb.getBoundingClientRect();
      this.draggingThumb = axis;
      this.thumbGrabOffset =
        axis === 'x'
          ? event.clientX - thumbRect.left
          : event.clientY - thumbRect.top;
      this.activePointerId = event.pointerId;
      this.viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
      void trackRect;
      return;
    }

    if (target.closest('.ght-mermaid-scrollbar')) {
      // Click on track: jump thumb toward click.
      const axis: ScrollAxis = target.closest('.ght-mermaid-scrollbar--x')
        ? 'x'
        : 'y';
      this.jumpScrollbarToPointer(axis, event);
      event.preventDefault();
      return;
    }

    event.preventDefault();
    this.draggingCanvas = true;
    this.activePointerId = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.viewport.classList.add(`${VIEWPORT_CLASS}--dragging`);
    this.viewport.setPointerCapture(event.pointerId);
  };

  private jumpScrollbarToPointer(axis: ScrollAxis, event: PointerEvent): void {
    const viewportW = this.viewport.clientWidth;
    const viewportH = this.viewport.clientHeight;
    const contentW = this.baseWidth * this.transform.scale;
    const contentH = this.baseHeight * this.transform.scale;

    if (axis === 'x') {
      const trackRect = this.scrollbarX.getBoundingClientRect();
      const metrics = scrollbarMetrics(
        this.transform.x,
        viewportW,
        contentW,
        trackRect.width,
      );
      const thumbOffset = event.clientX - trackRect.left - metrics.thumbSize / 2;
      this.transform = {
        ...this.transform,
        x: offsetFromThumbPosition(
          thumbOffset,
          viewportW,
          contentW,
          trackRect.width,
        ),
      };
    } else {
      const trackRect = this.scrollbarY.getBoundingClientRect();
      const metrics = scrollbarMetrics(
        this.transform.y,
        viewportH,
        contentH,
        trackRect.height,
      );
      const thumbOffset = event.clientY - trackRect.top - metrics.thumbSize / 2;
      this.transform = {
        ...this.transform,
        y: offsetFromThumbPosition(
          thumbOffset,
          viewportH,
          contentH,
          trackRect.height,
        ),
      };
    }
    this.applyTransform();
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }

    if (this.draggingThumb) {
      const viewportW = this.viewport.clientWidth;
      const viewportH = this.viewport.clientHeight;
      const contentW = this.baseWidth * this.transform.scale;
      const contentH = this.baseHeight * this.transform.scale;

      if (this.draggingThumb === 'x') {
        const trackRect = this.scrollbarX.getBoundingClientRect();
        const thumbOffset =
          event.clientX - trackRect.left - this.thumbGrabOffset;
        this.transform = {
          ...this.transform,
          x: offsetFromThumbPosition(
            thumbOffset,
            viewportW,
            contentW,
            trackRect.width,
          ),
        };
      } else {
        const trackRect = this.scrollbarY.getBoundingClientRect();
        const thumbOffset =
          event.clientY - trackRect.top - this.thumbGrabOffset;
        this.transform = {
          ...this.transform,
          y: offsetFromThumbPosition(
            thumbOffset,
            viewportH,
            contentH,
            trackRect.height,
          ),
        };
      }
      this.applyTransform();
      return;
    }

    if (!this.draggingCanvas) {
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

    this.draggingCanvas = false;
    this.draggingThumb = null;
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

  return new MermaidDialogEnhancer(details, dialog, renderTarget);
}

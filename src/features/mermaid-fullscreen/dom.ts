import {
  DEFAULT_TRANSFORM,
  clampScale,
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
export const ACTIONS_SELECTOR = '.js-render-block-actions';
export const NATIVE_OPEN_SELECTOR = 'summary[aria-label="Open dialog"]';
export const WIRED_ATTRIBUTE = 'data-ght-mermaid-wired';
export const OPEN_BUTTON_ATTRIBUTE = 'data-ght-mermaid-open';
export const NATIVE_HIDDEN_ATTRIBUTE = 'data-ght-mermaid-native-hidden';
export const NATIVE_FALLBACK_ATTRIBUTE = 'data-ght-mermaid-native-fallback';
export const MODAL_ATTRIBUTE = 'data-ght-mermaid-modal';
export const OPEN_CLASS = 'ght-mermaid-open';
export const VIEWPORT_CLASS = 'ght-mermaid-viewport';
export const STAGE_CLASS = 'ght-mermaid-stage';
export const SVG_CLASS = 'ght-mermaid-svg';
export const SCROLLBAR_X_CLASS = 'ght-mermaid-scrollbar ght-mermaid-scrollbar--x';
export const SCROLLBAR_Y_CLASS = 'ght-mermaid-scrollbar ght-mermaid-scrollbar--y';
export const THUMB_CLASS = 'ght-mermaid-scrollbar__thumb';

const EXPAND_ICON_PATH =
  'M3.72 3.72a.75.75 0 011.06 1.06L2.56 7h10.88l-2.22-2.22a.75.75 0 011.06-1.06l3.5 3.5a.75.75 0 010 1.06l-3.5 3.5a.75.75 0 11-1.06-1.06l2.22-2.22H2.56l2.22 2.22a.75.75 0 11-1.06 1.06l-3.5-3.5a.75.75 0 010-1.06l3.5-3.5z';

const CLOSE_ICON_PATH =
  'M5.72 5.72a.75.75 0 011.06 0L12 10.94l5.22-5.22a.75.75 0 111.06 1.06L13.06 12l5.22 5.22a.75.75 0 11-1.06 1.06L12 13.06l-5.22 5.22a.75.75 0 01-1.06-1.06L10.94 12 5.72 6.78a.75.75 0 010-1.06z';

export type ModalContentState = 'loading' | 'ready' | 'error';

export interface MermaidModalHandlers {
  onClose: () => void;
  onRetry: () => void;
  onShowNative: () => void;
}

type ScrollAxis = 'x' | 'y';

export function findMermaidEmbeds(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(EMBED_SELECTOR));
}

export function findActionsRow(embed: HTMLElement): HTMLElement | null {
  return embed.querySelector<HTMLElement>(ACTIONS_SELECTOR);
}

export function findNativeDetails(embed: HTMLElement): HTMLDetailsElement | null {
  const summary = embed.querySelector<HTMLElement>(NATIVE_OPEN_SELECTOR);
  const details = summary?.closest('details');
  return details instanceof HTMLDetailsElement ? details : null;
}

export function findOpenButton(embed: HTMLElement): HTMLButtonElement | null {
  return embed.querySelector<HTMLButtonElement>(`[${OPEN_BUTTON_ATTRIBUTE}]`);
}

export function isWired(embed: HTMLElement): boolean {
  return embed.hasAttribute(WIRED_ATTRIBUTE);
}

export function markWired(embed: HTMLElement): void {
  embed.setAttribute(WIRED_ATTRIBUTE, 'true');
}

export function clearWiredMarkers(root: ParentNode = document): void {
  root.querySelectorAll(`[${WIRED_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(WIRED_ATTRIBUTE);
  });
}

export function hideNativeOpenControl(details: HTMLDetailsElement): void {
  details.setAttribute(NATIVE_HIDDEN_ATTRIBUTE, 'true');
  details.hidden = true;
}

export function showNativeOpenControl(details: HTMLDetailsElement): void {
  details.removeAttribute(NATIVE_HIDDEN_ATTRIBUTE);
  details.hidden = false;
}

export function isNativeFallback(embed: HTMLElement): boolean {
  return embed.hasAttribute(NATIVE_FALLBACK_ATTRIBUTE);
}

export function markNativeFallback(embed: HTMLElement): void {
  embed.setAttribute(NATIVE_FALLBACK_ATTRIBUTE, 'true');
}

function createExpandIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('octicon', 'm-2');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('d', EXPAND_ICON_PATH);
  svg.append(path);
  return svg;
}

function createCloseIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('octicon', 'octicon-x');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('d', CLOSE_ICON_PATH);
  svg.append(path);
  return svg;
}

/**
 * Injects our fullscreen control before Copy and hides GitHub's native open
 * control. Idempotent via `data-ght-mermaid-open` / wired markers.
 */
export function mountOpenControl(embed: HTMLElement): HTMLButtonElement | null {
  if (isNativeFallback(embed)) {
    return null;
  }

  const existing = findOpenButton(embed);
  if (existing) {
    const details = findNativeDetails(embed);
    if (details && !details.hasAttribute(NATIVE_HIDDEN_ATTRIBUTE)) {
      hideNativeOpenControl(details);
    }
    return existing;
  }

  const actions = findActionsRow(embed);
  const details = findNativeDetails(embed);
  if (!actions || !details) {
    return null;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn my-2 mr-2 p-0 d-inline-flex';
  button.setAttribute('aria-label', 'Open dialog');
  button.setAttribute(OPEN_BUTTON_ATTRIBUTE, 'true');
  button.append(createExpandIcon());

  const copy = actions.querySelector('clipboard-copy');
  if (copy) {
    actions.insertBefore(button, copy);
  } else {
    actions.append(button);
  }

  hideNativeOpenControl(details);
  return button;
}

export function unmountOpenControl(embed: HTMLElement): void {
  findOpenButton(embed)?.remove();
}

export function parseRenderedSvg(markup: string): SVGSVGElement | null {
  // Mermaid serializes HTML labels inside <foreignObject> using HTML void
  // elements such as <br>. Parsing that markup as XML rejects otherwise valid
  // browser-rendered diagrams, so parse it in an inert HTML document instead.
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  const svg = parsed.body.firstElementChild;
  if (
    parsed.body.childElementCount !== 1 ||
    svg?.localName !== 'svg' ||
    !(svg instanceof SVGSVGElement)
  ) {
    return null;
  }

  svg.querySelectorAll('script').forEach((element) => element.remove());
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith('on') ||
        ((name === 'href' || name === 'xlink:href') &&
          value.startsWith('javascript:'))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  svg.classList.add(SVG_CLASS);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.maxWidth = 'none';
  return svg;
}

export function getSvgIntrinsicSize(svg: SVGSVGElement): {
  width: number;
  height: number;
} {
  const values = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = values.length === 4 ? values[2] : Number.NaN;
  const height = values.length === 4 ? values[3] : Number.NaN;

  return {
    width: Number.isFinite(width) && width! > 0 ? width! : 1,
    height: Number.isFinite(height) && height! > 0 ? height! : 1,
  };
}

/**
 * Extension-owned Mermaid fullscreen modal: loading / ready / error content,
 * pan/zoom viewport, Esc / backdrop / close button dismissal.
 */
export class MermaidModal {
  private readonly handlers: MermaidModalHandlers;
  private readonly root: HTMLElement;
  private readonly dialog: HTMLElement;
  private readonly body: HTMLElement;
  private readonly status: HTMLElement;
  private viewport: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private scrollbarX: HTMLElement | null = null;
  private scrollbarY: HTMLElement | null = null;
  private thumbX: HTMLElement | null = null;
  private thumbY: HTMLElement | null = null;
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
  private contentState: ModalContentState = 'loading';

  constructor(handlers: MermaidModalHandlers) {
    this.handlers = handlers;

    this.root = document.createElement('div');
    this.root.className = 'ght-mermaid-modal';
    this.root.setAttribute(MODAL_ATTRIBUTE, 'true');

    const backdrop = document.createElement('div');
    backdrop.className = 'ght-mermaid-modal__backdrop';
    backdrop.addEventListener('click', this.onBackdropClick);

    this.dialog = document.createElement('div');
    this.dialog.className = 'ght-mermaid-modal__dialog';
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.setAttribute('aria-label', 'Mermaid diagram');
    this.dialog.tabIndex = -1;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className =
      'Link--muted btn-link position-absolute ght-mermaid-modal__close';
    closeButton.setAttribute('aria-label', 'Close dialog');
    closeButton.append(createCloseIcon());
    closeButton.addEventListener('click', this.onCloseClick);

    this.body = document.createElement('div');
    this.body.className = 'ght-mermaid-modal__body';

    this.status = document.createElement('div');
    this.status.className = 'ght-mermaid-modal__status';
    this.body.append(this.status);

    this.dialog.append(closeButton, this.body);
    this.root.append(backdrop, this.dialog);
    document.body.append(this.root);
    document.documentElement.classList.add(OPEN_CLASS);
    document.addEventListener('keydown', this.onKeyDown, true);

    this.showLoading();
    this.dialog.focus();
  }

  get isActive(): boolean {
    return this.active;
  }

  get currentTransform(): ViewportTransform {
    return this.transform;
  }

  get state(): ModalContentState {
    return this.contentState;
  }

  showLoading(): void {
    this.contentState = 'loading';
    this.teardownViewport();
    this.status.hidden = false;
    this.status.replaceChildren();
    this.status.className = 'ght-mermaid-modal__status';
    this.status.textContent = 'Loading diagram…';
  }

  showError(): void {
    this.contentState = 'error';
    this.teardownViewport();
    this.status.hidden = false;
    this.status.replaceChildren();
    this.status.className = 'ght-mermaid-modal__status ght-mermaid-modal__status--error';

    const message = document.createElement('p');
    message.className = 'ght-mermaid-modal__error-message';
    message.textContent = 'Could not load the diagram.';

    const actions = document.createElement('div');
    actions.className = 'ght-mermaid-modal__error-actions';

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-sm';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => this.handlers.onRetry());

    const showNative = document.createElement('button');
    showNative.type = 'button';
    showNative.className = 'btn-link';
    showNative.textContent = 'Show native viewer';
    showNative.addEventListener('click', () => this.handlers.onShowNative());

    actions.append(retry, showNative);
    this.status.append(message, actions);
  }

  showSvg(svgMarkup: string): boolean {
    const svg = parseRenderedSvg(svgMarkup);
    if (!svg) {
      this.showError();
      return false;
    }

    this.contentState = 'ready';
    this.status.hidden = true;
    this.status.replaceChildren();
    this.mountViewport(svg);
    return true;
  }

  teardown(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.teardownViewport();
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
    if (!document.querySelector(`[${MODAL_ATTRIBUTE}]`)) {
      document.documentElement.classList.remove(OPEN_CLASS);
    }
  }

  private mountViewport(svg: SVGSVGElement): void {
    this.teardownViewport();

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

    this.stage.append(svg);
    this.viewport.append(this.stage, this.scrollbarX, this.scrollbarY);
    this.body.append(this.viewport);

    this.viewport.addEventListener('pointerdown', this.onPointerDown);
    this.viewport.addEventListener('pointermove', this.onPointerMove);
    this.viewport.addEventListener('pointerup', this.onPointerUp);
    this.viewport.addEventListener('pointercancel', this.onPointerUp);
    this.viewport.addEventListener('wheel', this.onWheel, { passive: false });
    this.viewport.addEventListener('auxclick', this.onAuxClick);

    this.measureBaseSize(svg);
    this.fitToViewport();
    this.applyTransform();
  }

  private teardownViewport(): void {
    if (!this.viewport) {
      return;
    }
    this.viewport.removeEventListener('pointerdown', this.onPointerDown);
    this.viewport.removeEventListener('pointermove', this.onPointerMove);
    this.viewport.removeEventListener('pointerup', this.onPointerUp);
    this.viewport.removeEventListener('pointercancel', this.onPointerUp);
    this.viewport.removeEventListener('wheel', this.onWheel);
    this.viewport.removeEventListener('auxclick', this.onAuxClick);
    this.viewport.remove();
    this.viewport = null;
    this.stage = null;
    this.scrollbarX = null;
    this.scrollbarY = null;
    this.thumbX = null;
    this.thumbY = null;
    this.draggingCanvas = false;
    this.draggingThumb = null;
    this.activePointerId = null;
    this.transform = { ...DEFAULT_TRANSFORM };
  }

  private measureBaseSize(svg: SVGSVGElement): void {
    if (!this.stage) {
      return;
    }
    const size = getSvgIntrinsicSize(svg);
    this.baseWidth = size.width;
    this.baseHeight = size.height;
    this.stage.style.width = `${this.baseWidth}px`;
    this.stage.style.height = `${this.baseHeight}px`;
  }

  private fitToViewport(): void {
    if (!this.viewport) {
      return;
    }
    const viewportWidth = this.viewport.clientWidth;
    const viewportHeight = this.viewport.clientHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      return;
    }

    const scale = clampScale(
      Math.min(
        1,
        viewportWidth / this.baseWidth,
        viewportHeight / this.baseHeight,
      ),
    );
    this.transform = {
      scale,
      x: Math.max(0, (viewportWidth - this.baseWidth * scale) / 2),
      y: Math.max(0, (viewportHeight - this.baseHeight * scale) / 2),
    };
  }

  private applyTransform(): void {
    if (!this.stage) {
      return;
    }
    // Zoom via layout size (not CSS scale) so the browser re-renders the SVG
    // as vectors instead of magnifying a rasterized layer.
    this.stage.style.width = `${this.baseWidth * this.transform.scale}px`;
    this.stage.style.height = `${this.baseHeight * this.transform.scale}px`;
    this.stage.style.transform = toCssTransform(this.transform);
    this.syncScrollbars();
  }

  private syncScrollbars(): void {
    if (
      !this.viewport ||
      !this.scrollbarX ||
      !this.scrollbarY ||
      !this.thumbX ||
      !this.thumbY
    ) {
      return;
    }

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

    this.scrollbarX.classList.toggle(
      'ght-mermaid-scrollbar--inactive',
      x.inactive,
    );
    this.scrollbarY.classList.toggle(
      'ght-mermaid-scrollbar--inactive',
      y.inactive,
    );
    this.thumbX.style.width = `${x.thumbSize}px`;
    this.thumbX.style.transform = `translateX(${x.thumbOffset}px)`;
    this.thumbY.style.height = `${y.thumbSize}px`;
    this.thumbY.style.transform = `translateY(${y.thumbOffset}px)`;
    this.scrollbarX.setAttribute(
      'aria-valuenow',
      String(Math.round(-this.transform.x)),
    );
    this.scrollbarY.setAttribute(
      'aria-valuenow',
      String(Math.round(-this.transform.y)),
    );
  }

  private onCloseClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.handlers.onClose();
  };

  private onBackdropClick = (event: MouseEvent): void => {
    event.preventDefault();
    this.handlers.onClose();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.handlers.onClose();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.viewport || !isPanButton(event.button)) {
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
      if (!thumb || !track) {
        return;
      }
      const thumbRect = thumb.getBoundingClientRect();
      this.draggingThumb = axis;
      this.thumbGrabOffset =
        axis === 'x'
          ? event.clientX - thumbRect.left
          : event.clientY - thumbRect.top;
      this.activePointerId = event.pointerId;
      this.viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (target.closest('.ght-mermaid-scrollbar')) {
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
    if (!this.viewport || !this.scrollbarX || !this.scrollbarY) {
      return;
    }

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
    if (
      !this.viewport ||
      !this.scrollbarX ||
      !this.scrollbarY ||
      event.pointerId !== this.activePointerId
    ) {
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
    if (!this.viewport || event.pointerId !== this.activePointerId) {
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
    if (!this.viewport) {
      return;
    }
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

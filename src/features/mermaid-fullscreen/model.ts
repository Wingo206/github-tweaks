export interface ViewportTransform {
  scale: number;
  x: number;
  y: number;
}

export interface ScrollbarMetrics {
  /** Length of the scrollbar track in px. */
  trackSize: number;
  /** Thumb length in px. */
  thumbSize: number;
  /** Thumb start offset along the track in px. */
  thumbOffset: number;
  /** True when content fits and the bar is inactive. */
  inactive: boolean;
}

export const DEFAULT_TRANSFORM: ViewportTransform = {
  scale: 1,
  x: 0,
  y: 0,
};

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;
export const WHEEL_ZOOM_FACTOR = 1.1;
export const MIN_THUMB_SIZE = 24;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Pan by screen-space delta (content follows the pointer). */
export function pan(
  transform: ViewportTransform,
  dx: number,
  dy: number,
): ViewportTransform {
  return {
    ...transform,
    x: transform.x + dx,
    y: transform.y + dy,
  };
}

/**
 * Zoom so the content point under (cursorX, cursorY) in viewport space stays
 * fixed. `factor` > 1 zooms in.
 */
export function zoomAt(
  transform: ViewportTransform,
  cursorX: number,
  cursorY: number,
  factor: number,
): ViewportTransform {
  const nextScale = clampScale(transform.scale * factor);
  if (nextScale === transform.scale) {
    return transform;
  }

  const contentX = (cursorX - transform.x) / transform.scale;
  const contentY = (cursorY - transform.y) / transform.scale;

  return {
    scale: nextScale,
    x: cursorX - contentX * nextScale,
    y: cursorY - contentY * nextScale,
  };
}

export function wheelZoomFactor(deltaY: number): number {
  return deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
}

export function toCssTransform(transform: ViewportTransform): string {
  return `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
}

export function isPanButton(button: number): boolean {
  return button === 0 || button === 1;
}

/**
 * Map free translate to scrollbar chrome for a single axis.
 * `offset` is the translate on that axis (content origin in viewport space).
 * Content extent is `contentSize`; viewport extent is `viewportSize`.
 */
export function scrollbarMetrics(
  offset: number,
  viewportSize: number,
  contentSize: number,
  trackSize: number,
): ScrollbarMetrics {
  if (contentSize <= viewportSize + 0.5 || trackSize <= 0) {
    return {
      trackSize,
      thumbSize: trackSize,
      thumbOffset: 0,
      inactive: true,
    };
  }

  const maxScroll = contentSize - viewportSize;
  // scrollPos 0 => content left/top aligned; increases as we pan content left/up.
  const scrollPos = clamp(-offset, 0, maxScroll);
  const thumbSize = Math.max(
    MIN_THUMB_SIZE,
    (viewportSize / contentSize) * trackSize,
  );
  const travel = Math.max(0, trackSize - thumbSize);
  const thumbOffset = (scrollPos / maxScroll) * travel;

  return {
    trackSize,
    thumbSize,
    thumbOffset,
    inactive: false,
  };
}

/** Convert a thumb drag to a new translate offset for that axis. */
export function offsetFromThumbPosition(
  thumbOffset: number,
  viewportSize: number,
  contentSize: number,
  trackSize: number,
): number {
  if (contentSize <= viewportSize + 0.5 || trackSize <= 0) {
    return 0;
  }

  const maxScroll = contentSize - viewportSize;
  const thumbSize = Math.max(
    MIN_THUMB_SIZE,
    (viewportSize / contentSize) * trackSize,
  );
  const travel = Math.max(0, trackSize - thumbSize);
  const scrollPos =
    travel === 0 ? 0 : (clamp(thumbOffset, 0, travel) / travel) * maxScroll;
  return -scrollPos;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

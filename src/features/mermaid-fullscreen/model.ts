export interface ViewportTransform {
  scale: number;
  x: number;
  y: number;
}

export const DEFAULT_TRANSFORM: ViewportTransform = {
  scale: 1,
  x: 0,
  y: 0,
};

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;
export const WHEEL_ZOOM_FACTOR = 1.1;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Pan by screen-space delta. */
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

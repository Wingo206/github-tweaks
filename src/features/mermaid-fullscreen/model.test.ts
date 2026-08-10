import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSFORM,
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  isPanButton,
  offsetFromThumbPosition,
  pan,
  scrollbarMetrics,
  toCssTransform,
  wheelZoomFactor,
  zoomAt,
} from './model';

describe('mermaid viewport model', () => {
  it('pans freely by screen deltas', () => {
    expect(pan(DEFAULT_TRANSFORM, 10, -4)).toEqual({
      scale: 1,
      x: 10,
      y: -4,
    });
  });

  it('zooms toward the cursor', () => {
    const zoomed = zoomAt({ scale: 1, x: 0, y: 0 }, 100, 50, 2);
    expect(zoomed.scale).toBe(2);
    expect((100 - zoomed.x) / zoomed.scale).toBe(100);
    expect((50 - zoomed.y) / zoomed.scale).toBe(50);
  });

  it('clamps scale', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(zoomAt(DEFAULT_TRANSFORM, 0, 0, 0.001).scale).toBe(MIN_SCALE);
  });

  it('maps wheel direction to zoom factor', () => {
    expect(wheelZoomFactor(-1)).toBeGreaterThan(1);
    expect(wheelZoomFactor(1)).toBeLessThan(1);
  });

  it('recognizes left and middle mouse as pan buttons', () => {
    expect(isPanButton(0)).toBe(true);
    expect(isPanButton(1)).toBe(true);
    expect(isPanButton(2)).toBe(false);
  });

  it('serializes pan as a css translate (zoom is layout-sized)', () => {
    expect(toCssTransform({ scale: 1.5, x: 12, y: -3 })).toBe(
      'translate(12px, -3px)',
    );
  });

  it('builds scrollbar metrics from free translate', () => {
    const metrics = scrollbarMetrics(-100, 800, 1600, 200);
    expect(metrics.inactive).toBe(false);
    expect(metrics.thumbSize).toBe(100);
    expect(metrics.thumbOffset).toBeCloseTo(12.5);

    expect(scrollbarMetrics(0, 800, 800, 200).inactive).toBe(true);
  });

  it('maps thumb position back to translate offset', () => {
    const offset = offsetFromThumbPosition(50, 800, 1600, 200);
    // travel = 200 - 100 = 100; thumb 50 => scroll 400 => offset -400
    expect(offset).toBe(-400);
  });
});

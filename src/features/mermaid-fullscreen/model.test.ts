import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSFORM,
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  isPanButton,
  pan,
  toCssTransform,
  wheelZoomFactor,
  zoomAt,
} from './model';

describe('mermaid viewport model', () => {
  it('pans by screen deltas', () => {
    expect(pan(DEFAULT_TRANSFORM, 10, -4)).toEqual({
      scale: 1,
      x: 10,
      y: -4,
    });
  });

  it('zooms toward the cursor', () => {
    const zoomed = zoomAt({ scale: 1, x: 0, y: 0 }, 100, 50, 2);
    expect(zoomed.scale).toBe(2);
    // Content point under cursor stays fixed: (100, 50) maps to same place.
    expect(100 - ((100 - 0) / 1) * 2).toBe(zoomed.x);
    expect(50 - ((50 - 0) / 1) * 2).toBe(zoomed.y);
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

  it('serializes css transforms', () => {
    expect(toCssTransform({ scale: 1.5, x: 12, y: -3 })).toBe(
      'translate(12px, -3px) scale(1.5)',
    );
  });
});

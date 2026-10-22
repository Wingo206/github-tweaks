/** A vertical span in pixels. `bottom` is exclusive. */
export interface Extent {
  top: number;
  bottom: number;
}

export interface ScrollView {
  scrollTop: number;
  height: number;
  scrollHeight: number;
}

export function isPullRequestFilesUrl(url: URL): boolean {
  return (
    url.hostname === 'github.com' &&
    /^\/[^/]+\/[^/]+\/pull\/\d+\/(?:files|changes)(?:\/|$)/.test(url.pathname)
  );
}

export function intersects(extent: Extent, viewport: Extent): boolean {
  return (
    extent.bottom > extent.top &&
    extent.bottom > viewport.top &&
    extent.top < viewport.bottom
  );
}

export function unionExtent(extents: readonly Extent[]): Extent | null {
  let union: Extent | null = null;
  for (const { top, bottom } of extents) {
    if (bottom <= top) {
      continue;
    }
    union = union
      ? { top: Math.min(union.top, top), bottom: Math.max(union.bottom, bottom) }
      : { top, bottom };
  }
  return union;
}

/**
 * Tree row ids to try for a file, most specific first: the file itself, then
 * each enclosing folder. Collapsed folders do not render their children, so
 * the deepest rendered folder stands in for a hidden file.
 */
export function treeRowCandidates(path: string): string[] {
  const candidates = [path];
  for (let end = path.lastIndexOf('/'); end > 0; end = path.lastIndexOf('/', end - 1)) {
    candidates.push(path.slice(0, end));
  }
  return candidates;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * The `scrollTop` that keeps `band` in `view` with `buffer` pixels of tree
 * showing beyond it, or `null` when no scroll is needed. When both buffers do
 * not fit, the band stays fully visible and keeps the buffer on the side it is
 * moving toward. A band taller than the view is aligned to its top.
 */
export function followScrollTop(
  band: Extent,
  view: ScrollView,
  buffer: number,
): number | null {
  const { scrollTop, height } = view;
  const bandHeight = band.bottom - band.top;
  let target: number;
  if (bandHeight + buffer * 2 <= height) {
    target = clamp(scrollTop, band.bottom + buffer - height, band.top - buffer);
  } else if (bandHeight > height) {
    target = band.top;
  } else if (band.bottom > scrollTop + height) {
    target = Math.min(band.bottom + buffer - height, band.top);
  } else if (band.top < scrollTop) {
    target = Math.max(band.top - buffer, band.bottom - height);
  } else {
    return null;
  }

  target = Math.round(clamp(target, 0, view.scrollHeight - height));
  return Math.abs(target - scrollTop) < 1 ? null : target;
}

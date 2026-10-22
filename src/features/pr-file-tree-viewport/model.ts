/** A vertical span in pixels. `bottom` is exclusive. */
export interface Extent {
  top: number;
  bottom: number;
}

export interface ScrollView {
  scrollTop: number;
  height: number;
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

/**
 * The `scrollTop` that brings `band` into `view`, or `null` when it is already
 * fully visible. A band taller than the view is aligned to its top.
 */
export function followScrollTop(
  band: Extent,
  view: ScrollView,
  margin: number,
): number | null {
  const visibleBottom = view.scrollTop + view.height;
  if (band.top >= view.scrollTop && band.bottom <= visibleBottom) {
    return null;
  }

  const fits = band.bottom - band.top + margin * 2 <= view.height;
  const target =
    !fits || band.top < view.scrollTop
      ? band.top - margin
      : band.bottom + margin - view.height;
  return Math.max(0, Math.round(target));
}

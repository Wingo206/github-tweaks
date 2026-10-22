import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  diffViewport,
  findTreeRoot,
  findTreeRow,
  findTreeScroller,
  indexTreeLinks,
  MARKER,
  readDiffEntries,
  readDiffPath,
  toContentExtent,
  treeRowBox,
  TreeViewportBand,
} from './dom';

const fixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/file-tree-viewport.html'),
  'utf8',
);

function treeRoot(): HTMLElement {
  return findTreeRoot()!;
}

function entry(id: string) {
  return readDiffEntries().find((candidate) => candidate.id === id)!;
}

function setRect(element: Element, top: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = fixture;
});

describe('readDiffEntries', () => {
  it('lists every file diff in page order', () => {
    expect(readDiffEntries().map(({ id }) => id)).toEqual([
      'diff-format',
      'diff-app',
      'diff-readme',
      'diff-filtered',
    ]);
  });
});

describe('readDiffPath', () => {
  it('prefers the explicit file path', () => {
    expect(readDiffPath(entry('diff-app').element)).toBe('src/app.ts');
  });

  it('falls back to the header link without direction marks', () => {
    expect(readDiffPath(entry('diff-format').element)).toBe('src/utils/format.ts');
  });
});

describe('findTreeRow', () => {
  it('finds a file row through its diff link', () => {
    const links = indexTreeLinks(treeRoot());
    expect(findTreeRow(treeRoot(), links, entry('diff-app'))?.id).toBe('src/app.ts');
    expect(findTreeRow(treeRoot(), links, entry('diff-readme'))?.id).toBe('README.md');
  });

  it('uses the collapsed folder for a hidden file', () => {
    const links = indexTreeLinks(treeRoot());
    expect(findTreeRow(treeRoot(), links, entry('diff-format'))?.id).toBe('src/utils');
  });

  it('returns null for a file the tree does not show', () => {
    const links = indexTreeLinks(treeRoot());
    expect(findTreeRow(treeRoot(), links, entry('diff-filtered'))).toBeNull();
  });
});

describe('treeRowBox', () => {
  it('measures only the row line, not an expanded folder', () => {
    const folder = document.getElementById('src')!;
    expect(treeRowBox(folder).parentElement).toBe(folder);
    expect(treeRowBox(folder).contains(document.getElementById('src/app.ts'))).toBe(false);
  });
});

describe('findTreeScroller', () => {
  it('finds the scrolling tree container', () => {
    expect(findTreeScroller(treeRoot())?.className).toBe('FileTreeScrollable__abc123');
  });

  it("falls back to the tree's parent", () => {
    treeRoot().querySelector<HTMLElement>('[class^="FileTreeScrollable__"]')!.style.overflowY = '';
    expect(findTreeScroller(treeRoot())?.className).toBe('FileTreeScrollable__abc123');
  });
});

describe('diffViewport', () => {
  it('starts below the sticky toolbar', () => {
    setRect(document.querySelector('section')!, 0, 60);
    expect(diffViewport()).toEqual({ top: 60, bottom: window.innerHeight });
  });

  it('starts at the top without a toolbar', () => {
    document.querySelector('section')!.remove();
    expect(diffViewport().top).toBe(0);
  });
});

describe('toContentExtent', () => {
  it('adds the scroll offset relative to the host', () => {
    const host = findTreeScroller(treeRoot())!;
    setRect(host, 100, 400);
    host.scrollTop = 250;
    expect(toContentExtent(host, { top: 132, bottom: 196 })).toEqual({ top: 282, bottom: 346 });
  });
});

describe('TreeViewportBand', () => {
  it('renders one band and moves it', () => {
    const host = findTreeScroller(treeRoot())!;
    const band = new TreeViewportBand();

    band.show(host, { top: 32, bottom: 96 });
    band.show(host, { top: 64, bottom: 128 });

    const elements = document.querySelectorAll<HTMLElement>(`[${MARKER}]`);
    expect(elements).toHaveLength(1);
    expect(elements[0]!.parentElement).toBe(host);
    expect(elements[0]!.style.top).toBe('64px');
    expect(elements[0]!.style.height).toBe('64px');
    expect(host.classList.contains('ght-tv-host')).toBe(true);
  });

  it('re-attaches after the host drops it', () => {
    const host = findTreeScroller(treeRoot())!;
    const band = new TreeViewportBand();
    band.show(host, { top: 0, bottom: 32 });
    host.querySelector(`[${MARKER}]`)!.remove();

    band.show(host, { top: 0, bottom: 32 });
    expect(host.querySelectorAll(`[${MARKER}]`)).toHaveLength(1);
  });

  it('cleans up completely', () => {
    const host = findTreeScroller(treeRoot())!;
    const band = new TreeViewportBand();
    band.show(host, { top: 0, bottom: 32 });

    band.clear();
    expect(document.querySelector(`[${MARKER}]`)).toBeNull();
    expect(host.classList.contains('ght-tv-host')).toBe(false);
  });
});

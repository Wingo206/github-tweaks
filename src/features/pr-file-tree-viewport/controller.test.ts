import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TreeViewportController } from './controller';
import { MARKER } from './dom';

const fixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/file-tree-viewport.html'),
  'utf8',
);

const ROW_HEIGHT = 32;
const TREE_TOP = 100;

function setRect(element: Element, top: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect;
}

function rowBox(id: string): Element {
  return document.getElementById(id)!.querySelector(':scope > .PRIVATE_TreeView-item-container')!;
}

function scroller(): HTMLElement {
  return document.querySelector<HTMLElement>('[class^="FileTreeScrollable__"]')!;
}

function band(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${MARKER}]`);
}

/** Lays out the tree rows and places diffs relative to the window. */
function layout(diffTops: Record<string, [number, number]>, treeScrollTop = 0): void {
  setRect(document.querySelector('section')!, 0, 60);
  const host = scroller();
  setRect(host, TREE_TOP, 2 * ROW_HEIGHT);
  host.scrollTop = treeScrollTop;
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 2 * ROW_HEIGHT });
  Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 4 * ROW_HEIGHT });

  ['src', 'src/utils', 'src/app.ts', 'README.md'].forEach((id, index) => {
    setRect(rowBox(id), TREE_TOP + index * ROW_HEIGHT - treeScrollTop, ROW_HEIGHT);
  });
  for (const region of document.querySelectorAll('[role="region"]')) {
    const [top, height] = diffTops[region.id] ?? [-10_000, 0];
    setRect(region, top, height);
  }
}

let controller: TreeViewportController;

beforeEach(() => {
  document.body.innerHTML = fixture;
  controller = new TreeViewportController();
});

afterEach(() => {
  controller.stop();
});

describe('TreeViewportController', () => {
  it('covers the rows of every file on screen', () => {
    layout({ 'diff-format': [20, 42], 'diff-app': [62, 1800] });
    controller.start();

    expect(band()?.style.top).toBe(`${ROW_HEIGHT}px`);
    expect(band()?.style.height).toBe(`${2 * ROW_HEIGHT}px`);
  });

  it('ignores files hidden under the sticky toolbar', () => {
    layout({ 'diff-format': [0, 42], 'diff-app': [42, 1800] });
    controller.start();

    expect(band()?.style.top).toBe(`${2 * ROW_HEIGHT}px`);
    expect(band()?.style.height).toBe(`${ROW_HEIGHT}px`);
  });

  it('scrolls the tree to follow the band', () => {
    layout({ 'diff-readme': [100, 2500] });
    controller.start();

    expect(scroller().scrollTop).toBe(4 * ROW_HEIGHT + 16 - 2 * ROW_HEIGHT);
    expect(band()?.style.top).toBe(`${3 * ROW_HEIGHT}px`);
  });

  it('leaves the tree alone while the pointer is over it', () => {
    layout({ 'diff-readme': [100, 2500] });
    controller.start();
    scroller().scrollTop = 0;
    layout({ 'diff-readme': [100, 2500] });

    document
      .getElementById('src')!
      .dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    controller.refresh();

    expect(scroller().scrollTop).toBe(0);
  });

  it('removes the band when no tree row matches', () => {
    layout({ 'diff-filtered': [100, 400] });
    controller.start();

    expect(band()).toBeNull();
  });

  it('cleans up on stop', () => {
    layout({ 'diff-app': [100, 1800] });
    controller.start();
    controller.stop();

    expect(band()).toBeNull();
    expect(scroller().classList.contains('ght-tv-host')).toBe(false);
  });
});

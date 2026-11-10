import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PullRequestFilesSnapshot } from '../../shared/types';
import { AutoCollapseController, type SnapshotListener } from './controller';

const fixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/file-tree-auto-collapse.html'),
  'utf8',
);

const PATHS = [
  'web/components/home/Dialog/Dialog.tsx',
  'web/components/home/Dialog/Dialog.test.tsx',
  'web/components/home/utils/format.ts',
  'web/components/home/Page.tsx',
  'README.md',
];

function snapshot(viewed: readonly string[]): PullRequestFilesSnapshot {
  return {
    ref: { owner: 'acme', repository: 'widgets', number: 42 },
    selection: { kind: 'all' },
    pullRequestId: 'PR_1',
    headOid: 'head',
    savedAt: 1,
    files: PATHS.map((path) => ({
      path,
      additions: 1,
      deletions: 0,
      viewedState: viewed.includes(path) ? 'VIEWED' : 'UNVIEWED',
    })),
  };
}

function createSource() {
  let listener: SnapshotListener | null = null;
  return {
    subscribe(next: SnapshotListener) {
      listener = next;
      next(null);
      return () => {
        listener = null;
      };
    },
    publish(next: PullRequestFilesSnapshot | null) {
      listener?.(next);
    },
  };
}

let unwire: AbortController;

/**
 * Stands in for GitHub's React tree: a chevron click flips the row on a later
 * microtask, unmounts a closed folder's children, and remounts them with
 * their folders open.
 */
function wireTree(): void {
  const unmounted = new Map<HTMLElement, Element>();
  document.addEventListener(
    'click',
    (event) => {
      const toggle =
        event.target instanceof Element
          ? event.target.closest('.PRIVATE_TreeView-item-toggle')
          : null;
      const row = toggle?.closest<HTMLElement>('li[role="treeitem"]');
      if (!row) {
        return;
      }
      queueMicrotask(() => {
        const expand = row.getAttribute('aria-expanded') !== 'true';
        row.setAttribute('aria-expanded', String(expand));
        if (expand) {
          const group = unmounted.get(row);
          group
            ?.querySelectorAll('[aria-expanded]')
            .forEach((child) => child.setAttribute('aria-expanded', 'true'));
          if (group) {
            row.append(group);
          }
        } else {
          const group = row.querySelector(':scope > ul[role="group"]');
          if (group) {
            unmounted.set(row, group);
            group.remove();
          }
        }
      });
    },
    { signal: unwire.signal },
  );
}

function expanded(path: string): boolean | null {
  const row = document.getElementById(path);
  return row ? row.getAttribute('aria-expanded') === 'true' : null;
}

function clickChevron(path: string): void {
  document
    .getElementById(path)!
    .querySelector<HTMLElement>(':scope > div > .PRIVATE_TreeView-item-toggle')!
    .click();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await Promise.resolve();
    await nextFrame();
  }
}

const controllers: AutoCollapseController[] = [];

function start(source: ReturnType<typeof createSource>): AutoCollapseController {
  const controller = new AutoCollapseController(source);
  controllers.push(controller);
  controller.start();
  return controller;
}

const DIALOG = 'web/components/home/Dialog';
const DIALOG_FILES = PATHS.slice(0, 2);

beforeEach(() => {
  unwire = new AbortController();
  document.body.innerHTML = fixture;
  wireTree();
});

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.stop());
  unwire.abort();
});

describe('AutoCollapseController', () => {
  it('closes folders that are already complete when the page loads', async () => {
    const source = createSource();
    start(source);
    source.publish(snapshot(DIALOG_FILES));
    await settle();

    expect(expanded(DIALOG)).toBe(false);
    expect(expanded('web/components/home')).toBe(true);
    expect(expanded('web')).toBe(true);
  });

  it('closes a folder when its last file is marked Viewed', async () => {
    const source = createSource();
    start(source);
    source.publish(snapshot([DIALOG_FILES[0]!]));
    await settle();
    expect(expanded(DIALOG)).toBe(true);

    source.publish(snapshot(DIALOG_FILES));
    await settle();
    expect(expanded(DIALOG)).toBe(false);
  });

  it('leaves a complete folder open after it is reopened', async () => {
    const source = createSource();
    start(source);
    source.publish(snapshot(DIALOG_FILES));
    await settle();

    clickChevron(DIALOG);
    await settle();
    source.publish(snapshot([...DIALOG_FILES]));
    await settle();

    expect(expanded(DIALOG)).toBe(true);
  });

  it('reopens a folder when one of its files goes back to unviewed', async () => {
    const source = createSource();
    start(source);
    source.publish(snapshot(DIALOG_FILES));
    await settle();

    source.publish(snapshot([DIALOG_FILES[1]!]));
    await settle();

    expect(expanded(DIALOG)).toBe(true);
  });

  it('closes finished subfolders when their parent is reopened', async () => {
    const source = createSource();
    start(source);
    source.publish(snapshot(PATHS.slice(0, 4)));
    await settle();
    expect(expanded('web')).toBe(false);
    expect(document.getElementById(DIALOG)).toBeNull();

    clickChevron('web');
    await settle();

    expect(expanded('web')).toBe(true);
    expect(expanded('web/components/home')).toBe(false);
  });

  it('clicks only the top-most finished folder, not the ones it hides', async () => {
    const clicked: string[] = [];
    document.addEventListener(
      'click',
      (event) => {
        const row = (event.target as Element).closest('li[role="treeitem"]');
        if (row) {
          clicked.push(row.id);
        }
      },
      { capture: true, signal: unwire.signal },
    );
    const source = createSource();
    start(source);
    source.publish(snapshot(PATHS.slice(0, 4)));
    await settle();

    expect(clicked).toEqual(['web']);
    expect(expanded('web')).toBe(false);
  });

  it('spreads slow chevron clicks over frames', async () => {
    const clicked: string[] = [];
    document.addEventListener(
      'click',
      (event) => {
        const row = (event.target as Element).closest('li[role="treeitem"]');
        if (row) {
          clicked.push(row.id);
          const until = performance.now() + 25;
          while (performance.now() < until) {
            // GitHub re-rendering a large tree.
          }
        }
      },
      { capture: true, signal: unwire.signal },
    );
    document.getElementById('web/components/home/utils')!.setAttribute('aria-expanded', 'true');
    const source = createSource();
    start(source);
    source.publish(snapshot([...DIALOG_FILES, 'web/components/home/utils/format.ts']));

    await nextFrame();
    await Promise.resolve();
    expect(clicked).toEqual([DIALOG]);

    await settle();
    expect(clicked).toEqual([DIALOG, 'web/components/home/utils']);
    expect(expanded(DIALOG)).toBe(false);
    expect(expanded('web/components/home/utils')).toBe(false);
  });

  it('does nothing after the source reports no pull request', async () => {
    const source = createSource();
    start(source);
    source.publish(snapshot(DIALOG_FILES));
    await settle();
    source.publish(null);

    clickChevron('web/components/home');
    await settle();
    clickChevron('web/components/home');
    await settle();

    expect(expanded(DIALOG)).toBe(true);
  });

  it('stops listening when stopped', async () => {
    const source = createSource();
    const controller = start(source);
    controller.stop();
    source.publish(snapshot(DIALOG_FILES));
    await settle();

    expect(expanded(DIALOG)).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  getNativeViewedPath,
  isNativeViewedButton,
  SidebarRenderer,
} from './dom';
import type { PullRequestFilesSnapshot } from '../../shared/types';

const sidebarFixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/sidebar.html'),
  'utf8',
);
const diffFixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/file-diff.html'),
  'utf8',
);
const toolbarFixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/files-toolbar.html'),
  'utf8',
);
const rangeToolbarFixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/files-toolbar-range.html'),
  'utf8',
);

const snapshot: PullRequestFilesSnapshot = {
  ref: { owner: 'acme', repository: 'widgets', number: 42 },
  selection: { kind: 'all' },
  pullRequestId: 'PR_1',
  headOid: 'head',
  savedAt: 1,
  files: [
    {
      path: 'src/index.ts',
      additions: 5,
      deletions: 2,
      viewedState: 'UNVIEWED',
    },
    {
      path: 'src/empty.png',
      additions: 0,
      deletions: 0,
      viewedState: 'VIEWED',
    },
  ],
};

describe('GitHub DOM adapter and renderer', () => {
  it('renders file metadata and stable folder totals idempotently', () => {
    document.body.innerHTML = sidebarFixture;
    const renderer = new SidebarRenderer({
      onRetry: vi.fn(),
      onOpenSetup: vi.fn(),
    });

    expect(renderer.render(snapshot)).toBe(true);
    expect(renderer.render(snapshot)).toBe(true);

    const fileRow = document.getElementById('src/index.ts')!;
    expect(
      fileRow.querySelector('.ght-pr-metadata__counts')?.textContent,
    ).toBe('+5-2');
    expect(fileRow.querySelectorAll('[data-ght-pr-metadata]')).toHaveLength(1);
    const fileIndicator =
      fileRow.querySelector<HTMLInputElement>(
        '.ght-pr-metadata__viewed input',
      )!;
    expect(fileIndicator.checked).toBe(false);
    expect(fileIndicator.disabled).toBe(true);

    const binaryRow = document.getElementById('src/empty.png')!;
    expect(
      binaryRow.querySelector('.ght-pr-metadata__counts')?.textContent,
    ).toBe('—');
    const binaryIndicator =
      binaryRow.querySelector<HTMLInputElement>(
        '.ght-pr-metadata__viewed input',
      )!;
    expect(binaryIndicator.checked).toBe(true);
    expect(binaryIndicator.disabled).toBe(true);
    expect(binaryRow.classList.contains('ght-pr-tree-row--viewed')).toBe(true);
    expect(fileRow.classList.contains('ght-pr-tree-row--viewed')).toBe(false);

    const folder = document.getElementById('src')!;
    expect(
      folder.querySelector('.ght-pr-metadata__counts')?.textContent,
    ).toBe('+5-2');
    expect(
      folder.querySelector('.ght-pr-metadata__progress')?.textContent,
    ).toBe('1/2');

    fileRow.hidden = true;
    renderer.render(snapshot);
    expect(
      folder.querySelector('.ght-pr-metadata__progress')?.textContent,
    ).toBe('1/2');
    expect(folder.classList.contains('ght-pr-tree-row--viewed')).toBe(false);

    renderer.render({
      ...snapshot,
      files: snapshot.files.map((file) => ({
        ...file,
        viewedState: 'VIEWED' as const,
      })),
    });
    expect(folder.classList.contains('ght-pr-tree-row--viewed')).toBe(true);

    renderer.clear();
    expect(binaryRow.classList.contains('ght-pr-tree-row--viewed')).toBe(false);
    expect(folder.classList.contains('ght-pr-tree-row--viewed')).toBe(false);
  });

  it('replaces folder totals when a commit filter shrinks the file set', () => {
    document.body.innerHTML = sidebarFixture;
    const renderer = new SidebarRenderer({
      onRetry: vi.fn(),
      onOpenSetup: vi.fn(),
    });
    const wholePullRequest: PullRequestFilesSnapshot = {
      ...snapshot,
      files: [
        {
          path: 'src/index.ts',
          additions: 20,
          deletions: 4,
          viewedState: 'UNVIEWED',
        },
        {
          path: 'src/empty.png',
          additions: 100,
          deletions: 1,
          viewedState: 'VIEWED',
        },
      ],
    };

    renderer.render(wholePullRequest);

    const folder = document.getElementById('src')!;
    const droppedFile = document.getElementById('src/empty.png')!;
    expect(
      folder.querySelector('.ght-pr-metadata__counts')?.textContent,
    ).toBe('+20-4');
    expect(
      folder.querySelector('.ght-pr-metadata__progress')?.textContent,
    ).toBe('1/2');
    expect(droppedFile.classList.contains('ght-pr-tree-row--viewed')).toBe(
      true,
    );

    renderer.render({
      ...wholePullRequest,
      selection: { kind: 'commit', oid: 'abcdef1' },
      files: [
        {
          path: 'src/index.ts',
          additions: 5,
          deletions: 1,
          viewedState: 'UNVIEWED',
        },
      ],
    });

    expect(
      folder.querySelector('.ght-pr-metadata__counts')?.textContent,
    ).toBe('+5-1');
    expect(
      folder.querySelector('.ght-pr-metadata__progress')?.textContent,
    ).toBe('0/1');
    expect(
      document
        .getElementById('src/index.ts')!
        .querySelector('.ght-pr-metadata__counts')?.textContent,
    ).toBe('+5-1');
    expect(droppedFile.querySelector('[data-ght-pr-metadata]')).toBeNull();
    expect(droppedFile.classList.contains('ght-pr-tree-row--viewed')).toBe(
      false,
    );

    renderer.render({
      ...wholePullRequest,
      selection: { kind: 'commit', oid: 'abcdef1' },
      files: [],
    });

    expect(folder.querySelector('[data-ght-pr-metadata]')).toBeNull();
    expect(folder.classList.contains('ght-pr-tree-row--viewed')).toBe(false);
    expect(
      document.getElementById('src/index.ts')!.querySelector(
        '[data-ght-pr-metadata]',
      ),
    ).toBeNull();
  });

  it('appends combined line progress beside the toolbar viewed meter', () => {
    document.body.innerHTML = toolbarFixture;
    const renderer = new SidebarRenderer({
      onRetry: vi.fn(),
      onOpenSetup: vi.fn(),
    });

    renderer.showLoading();
    const loading = document.querySelector(
      '[data-ght-pr-metadata="toolbar-lines"]',
    );
    expect(loading?.textContent?.replace(/\s+/g, ' ').trim()).toContain(
      '… / … changes',
    );

    expect(renderer.render(snapshot)).toBe(false);
    expect(renderer.render(snapshot)).toBe(false);

    const metadata = document.querySelector(
      '[data-ght-pr-metadata="toolbar-lines"]',
    );
    expect(
      document.querySelectorAll('[data-ght-pr-metadata="toolbar-lines"]'),
    ).toHaveLength(1);
    expect(
      metadata
        ?.querySelector('.ght-pr-toolbar-lines__counts')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    ).toBe('0 / 7 changes');
    expect(
      metadata
        ?.querySelector('.ght-pr-toolbar-lines__ring-value')
        ?.getAttribute('stroke-dashoffset'),
    ).toBe('38');
    expect(metadata?.querySelector('.sr-only')?.textContent).toBe(
      '0 of 7 changes viewed',
    );

    renderer.render({
      ...snapshot,
      files: snapshot.files.map((file) =>
        file.path === 'src/index.ts'
          ? { ...file, viewedState: 'VIEWED' as const }
          : file,
      ),
    });
    expect(
      metadata
        ?.querySelector('.ght-pr-toolbar-lines__counts')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    ).toBe('7 / 7 changes');
    expect(
      metadata
        ?.querySelector('.ght-pr-toolbar-lines__ring-value')
        ?.getAttribute('stroke-dashoffset'),
    ).toBe('0');

    renderer.clear();
    expect(
      document.querySelector('[data-ght-pr-metadata="toolbar-lines"]'),
    ).toBeNull();
  });

  it('renders line progress when a commit range hides native progress', () => {
    document.body.innerHTML = rangeToolbarFixture;
    const renderer = new SidebarRenderer({
      onRetry: vi.fn(),
      onOpenSetup: vi.fn(),
    });

    expect(renderer.render(snapshot)).toBe(false);
    expect(
      document.querySelector(
        '.PullRequestFilesToolbar-module__file-controls ' +
          '[data-ght-pr-metadata="toolbar-lines"]',
      ),
    ).not.toBeNull();
  });

  it('maps native Viewed buttons to full paths', () => {
    document.body.innerHTML = diffFixture;
    const button = document.querySelector<HTMLButtonElement>(
      '[aria-label="Not Viewed"]',
    )!;

    expect(isNativeViewedButton(button)).toBe(true);
    expect(getNativeViewedPath(button)).toBe('src/index.ts');
  });
});

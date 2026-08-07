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

const snapshot: PullRequestFilesSnapshot = {
  ref: { owner: 'acme', repository: 'widgets', number: 42 },
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
      onViewedChange: vi.fn(),
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
    expect(
      fileRow.querySelector<HTMLInputElement>('input')?.checked,
    ).toBe(false);

    const binaryRow = document.getElementById('src/empty.png')!;
    expect(
      binaryRow.querySelector('.ght-pr-metadata__counts')?.textContent,
    ).toBe('—');
    expect(
      binaryRow.querySelector<HTMLInputElement>('input')?.checked,
    ).toBe(true);
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

  it('emits sidebar checkbox changes', () => {
    document.body.innerHTML = sidebarFixture;
    const onViewedChange = vi.fn();
    const renderer = new SidebarRenderer({
      onViewedChange,
      onRetry: vi.fn(),
      onOpenSetup: vi.fn(),
    });
    renderer.render(snapshot);

    const checkbox = document
      .getElementById('src/index.ts')!
      .querySelector<HTMLInputElement>('input')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onViewedChange).toHaveBeenCalledWith('src/index.ts', true);
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

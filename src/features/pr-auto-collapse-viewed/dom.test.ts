import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findFolderRows, isFolderRow, readFolderRow, toggleFolder } from './dom';

const fixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/file-tree-auto-collapse.html'),
  'utf8',
);

beforeEach(() => {
  document.body.innerHTML = fixture;
});

describe('findFolderRows', () => {
  it('finds open and closed folder rows by their full path, skipping files', () => {
    expect(findFolderRows().map(readFolderRow)).toEqual([
      { path: 'web', expanded: true },
      { path: 'web/components/home', expanded: true },
      { path: 'web/components/home/Dialog', expanded: true },
      { path: 'web/components/home/utils', expanded: false },
    ]);
  });

  it('ignores tree items outside the changed-files tree', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<ul role="tree"><li id="elsewhere" role="treeitem" aria-expanded="true"></li></ul>',
    );

    expect(findFolderRows().map((row) => row.id)).not.toContain('elsewhere');
    expect(isFolderRow(document.getElementById('elsewhere')!)).toBe(false);
  });
});

describe('isFolderRow', () => {
  it('accepts folders and rejects files', () => {
    expect(isFolderRow(document.getElementById('web/components/home/utils')!)).toBe(true);
    expect(isFolderRow(document.getElementById('README.md')!)).toBe(false);
  });
});

describe('toggleFolder', () => {
  it('clicks the folder’s own chevron, not a nested folder’s', () => {
    const row = document.getElementById('web/components/home')!;
    const onClick = vi.fn((event: Event) => event.currentTarget);
    for (const toggle of document.querySelectorAll('.PRIVATE_TreeView-item-toggle')) {
      toggle.addEventListener('click', onClick);
    }

    expect(toggleFolder(row)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.results[0]?.value).toBe(
      row.querySelector('.PRIVATE_TreeView-item-toggle'),
    );
  });

  it('reports a row without a chevron', () => {
    expect(toggleFolder(document.getElementById('README.md')!)).toBe(false);
  });
});

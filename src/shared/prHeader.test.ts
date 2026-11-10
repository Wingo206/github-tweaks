import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findHeadBranchMounts, findStickyBarTitleBlocks } from './prHeader';

function fixture(path: string): string {
  return readFileSync(resolve(process.cwd(), `tests/fixtures/${path}.html`), 'utf8');
}

describe('findHeadBranchMounts', () => {
  it.each(['pr-checkout-branch/head-branch', 'pr-sticky-tabs/overview'])(
    'finds the head branch link through the copy control, not the base branch (%s)',
    (path) => {
      document.body.innerHTML = fixture(path);
      const mounts = findHeadBranchMounts(document);
      expect(mounts).toHaveLength(1);
      expect(mounts[0]!.link.textContent).toBe('feature/x');
      expect(mounts[0]!.anchor.getAttribute('aria-label')).toBe('Copy head branch name to clipboard');
    },
  );
});

describe('findStickyBarTitleBlocks', () => {
  it('finds the sticky bar’s title block, not the main header', () => {
    document.body.innerHTML = fixture('pr-sticky-tabs/overview');
    const blocks = findStickyBarTitleBlocks(document);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.closest('[data-testid="diff-comparison-viewer-sticky-header-bar"]')).not.toBeNull();
    expect(blocks[0]!.querySelector('a[href="#top"]')).not.toBeNull();
  });

  it('finds nothing in the classic layout', () => {
    document.body.innerHTML = fixture('classic/pr-sticky-tabs/conversation');
    expect(findStickyBarTitleBlocks(document)).toEqual([]);
  });
});

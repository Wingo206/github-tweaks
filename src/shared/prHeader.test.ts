import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findHeadBranchMounts } from './prHeader';

describe('findHeadBranchMounts', () => {
  it('finds the head branch link through the copy control, not the base branch', () => {
    document.body.innerHTML = readFileSync(
      resolve(process.cwd(), 'tests/fixtures/pr-checkout-branch/head-branch.html'),
      'utf8',
    );
    const mounts = findHeadBranchMounts(document);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]!.link.textContent).toBe('feature/x');
    expect(mounts[0]!.anchor.getAttribute('aria-label')).toBe('Copy head branch name to clipboard');
  });
});

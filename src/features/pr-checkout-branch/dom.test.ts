import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCESSIBLE_NAME,
  clearCheckoutUi,
  createButton,
  findHeadBranchMounts,
  MARKER,
  renderButton,
  syncButtons,
} from './dom';

function fixture(): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures/pr-checkout-branch/head-branch.html'), 'utf8');
}

describe('head branch row', () => {
  it('finds the head branch link through the copy control, not the base branch', () => {
    document.body.innerHTML = fixture();
    const mounts = findHeadBranchMounts(document);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]!.link.textContent).toBe('feature/x');
    expect(mounts[0]!.anchor.getAttribute('aria-label')).toBe('Copy head branch name to clipboard');
  });

  it('inserts one button after the copy tooltip, idempotently, and cleans up', () => {
    document.body.innerHTML = fixture();
    syncButtons(document, createButton);
    const buttons = syncButtons(document, createButton);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.previousElementSibling?.getAttribute('aria-label')).toBe(
      'Copy head branch name to clipboard',
    );
    expect(buttons[0]!.getAttribute('aria-label')).toBe(ACCESSIBLE_NAME);

    clearCheckoutUi();
    expect(document.querySelectorAll(`[${MARKER}]`)).toHaveLength(0);
  });
});

describe('renderButton', () => {
  it('shows where the branch is checked out', () => {
    const button = createButton();
    renderButton(button, ['bagel', 'third-bagel']);
    expect(button.dataset.ghtCobState).toBe('checked-out');
    expect(button.getAttribute('aria-label')).toBe('Checked out in bagel, third-bagel');
    expect(button.textContent).toBe('bagel, third-bagel');

    renderButton(button, []);
    expect(button.dataset.ghtCobState).toBe('idle');
    expect(button.textContent).toBe('');
  });
});

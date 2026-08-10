import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  clearHandbackUi,
  findAssigneesRoot,
  HANDBACK_BUTTON_CLASS,
  HANDBACK_ROOT_ATTRIBUTE,
  readAssigneeLogins,
  syncHandbackUi,
} from './dom';

const assignedFixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/assignees-assigned.html'),
  'utf8',
);
const emptyFixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/assignees-empty.html'),
  'utf8',
);

describe('handback DOM adapter', () => {
  it('reads assignee logins from the assignees block, not reviewers', () => {
    document.body.innerHTML = assignedFixture;
    const root = findAssigneesRoot()!;
    expect(root.getAttribute('data-channel-event-name')).toBe(
      'assignees_updated',
    );
    expect(readAssigneeLogins(root)).toEqual(['reviewer', 'teammate']);
  });

  it('injects a header action like review now / approve now', () => {
    document.body.innerHTML = assignedFixture;
    const root = findAssigneesRoot()!;
    const onHandback = vi.fn();

    syncHandbackUi(root, {
      viewerLogin: 'reviewer',
      authorLogin: 'author',
      uiState: 'idle',
      errorMessage: null,
      onHandback,
    });
    syncHandbackUi(root, {
      viewerLogin: 'reviewer',
      authorLogin: 'author',
      uiState: 'idle',
      errorMessage: null,
      onHandback,
    });

    const mounts = root.querySelectorAll(`[${HANDBACK_ROOT_ATTRIBUTE}]`);
    expect(mounts).toHaveLength(1);

    const mount = mounts[0]!;
    const summary = root.querySelector('#assignees-select-menu > summary');
    expect(summary?.contains(mount)).toBe(true);
    expect(mount.className).toContain('text-normal');
    expect(mount.className).toContain('color-fg-muted');
    expect(mount.textContent).toContain('–');

    const button = mount.querySelector('button')!;
    expect(button.textContent).toBe('reassign author');
    expect(button.className).toContain('btn-link');
    expect(button.className).toContain('Link--muted');
    expect(button.className).toContain('Link--inTextBlock');

    button.click();
    expect(onHandback).toHaveBeenCalledTimes(1);
  });

  it('hides the button for empty assignees and cleans up', () => {
    document.body.innerHTML = emptyFixture;
    const root = findAssigneesRoot()!;

    syncHandbackUi(root, {
      viewerLogin: 'reviewer',
      authorLogin: 'author',
      uiState: 'idle',
      errorMessage: null,
      onHandback: vi.fn(),
    });
    expect(root.querySelector(`[${HANDBACK_ROOT_ATTRIBUTE}]`)).toBeNull();

    document.body.innerHTML = assignedFixture;
    const assignedRoot = findAssigneesRoot()!;
    syncHandbackUi(assignedRoot, {
      viewerLogin: 'reviewer',
      authorLogin: 'author',
      uiState: 'idle',
      errorMessage: null,
      onHandback: vi.fn(),
    });
    clearHandbackUi();
    expect(
      document.querySelector(`[${HANDBACK_ROOT_ATTRIBUTE}]`),
    ).toBeNull();
  });

  it('shows updating and error states', () => {
    document.body.innerHTML = assignedFixture;
    const root = findAssigneesRoot()!;

    syncHandbackUi(root, {
      viewerLogin: 'reviewer',
      authorLogin: 'author',
      uiState: 'updating',
      errorMessage: null,
      onHandback: vi.fn(),
    });
    const button = root.querySelector<HTMLButtonElement>(
      `.${HANDBACK_BUTTON_CLASS}`,
    )!;
    expect(button.textContent).toBe('Updating…');
    expect(button.disabled).toBe(true);

    syncHandbackUi(root, {
      viewerLogin: 'reviewer',
      authorLogin: 'author',
      uiState: 'error',
      errorMessage: 'Couldn’t update assignees',
      onHandback: vi.fn(),
    });
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t update assignees',
    );
    expect(button.disabled).toBe(false);
  });
});

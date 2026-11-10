import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  clearHandbackUi,
  HANDBACK_BUTTON_CLASS,
  HANDBACK_ROOT_ATTRIBUTE,
  overviewAssignees,
  readOverviewAssigneeLogins,
  type HandbackRenderOptions,
} from './dom';

const sidebar = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/pr-handback-assignee/overview-sidebar.html'),
  'utf8',
);

const EMPTY_ASSIGNEES = `<section aria-label="Assignees" data-overview-sidebar-item="true"><h4><button type="button" aria-label="Manage assignees" aria-haspopup="dialog"><span>Assignees</span></button></h4><div><span>No one—<button data-component="Button" type="button" data-variant="link">assign yourself</button></span></div></section>`;

function options(overrides: Partial<HandbackRenderOptions> = {}): HandbackRenderOptions {
  return {
    viewerLogin: 'reviewer',
    authorLogin: 'author',
    uiState: 'idle',
    errorMessage: null,
    onHandback: vi.fn(),
    ...overrides,
  };
}

function root(): HTMLElement {
  return overviewAssignees.findRoot(document)!;
}

describe('Overview Assignees adapter', () => {
  it('finds the Assignees section, not Reviewers, and reads its logins', () => {
    document.body.innerHTML = sidebar;
    expect(root().getAttribute('aria-label')).toBe('Assignees');
    expect(readOverviewAssigneeLogins(root())).toEqual(['reviewer', 'teammate']);
  });

  it('puts one action in the heading, beside GitHub’s heading button rather than inside it', () => {
    document.body.innerHTML = sidebar;
    const onHandback = vi.fn();
    overviewAssignees.sync(root(), options({ onHandback }));
    const result = overviewAssignees.sync(root(), options({ onHandback }));

    expect(result).toEqual({ visible: true, assigneeLogins: ['reviewer', 'teammate'] });
    const mounts = root().querySelectorAll(`[${HANDBACK_ROOT_ATTRIBUTE}]`);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]!.parentElement?.tagName).toBe('H4');
    expect(mounts[0]!.previousElementSibling?.getAttribute('aria-label')).toBe('Manage assignees');
    expect(mounts[0]!.textContent).toBe('– reassign author');

    const picker = vi.fn();
    root().querySelector('button[aria-label="Manage assignees"]')!.addEventListener('click', picker);
    const button = mounts[0]!.querySelector<HTMLButtonElement>(`.${HANDBACK_BUTTON_CLASS}`)!;
    expect(button.getAttribute('aria-label')).toBe('Reassign to author');
    button.click();
    expect(onHandback).toHaveBeenCalledTimes(1);
    expect(picker).not.toHaveBeenCalled();
  });

  it('stays hidden when the viewer is not assigned or is the author', () => {
    document.body.innerHTML = sidebar;
    expect(overviewAssignees.sync(root(), options({ viewerLogin: 'someone' })).visible).toBe(false);
    expect(overviewAssignees.sync(root(), options({ authorLogin: 'reviewer' })).visible).toBe(false);
    expect(root().querySelector(`[${HANDBACK_ROOT_ATTRIBUTE}]`)).toBeNull();

    document.body.innerHTML = EMPTY_ASSIGNEES;
    expect(overviewAssignees.sync(root(), options())).toEqual({ visible: false, assigneeLogins: [] });
  });

  it('shows updating, done, and error states', () => {
    document.body.innerHTML = sidebar;
    overviewAssignees.sync(root(), options({ uiState: 'updating' }));
    const button = root().querySelector<HTMLButtonElement>(`.${HANDBACK_BUTTON_CLASS}`)!;
    expect(button.textContent).toBe('reassigning…');
    expect(button.disabled).toBe(true);

    overviewAssignees.sync(root(), options({ uiState: 'error', errorMessage: 'Couldn’t update assignees' }));
    const alert = root().querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe('Couldn’t update assignees');
    expect(alert.previousElementSibling?.tagName).toBe('H4');
    expect(button.disabled).toBe(false);

    overviewAssignees.sync(root(), options({ uiState: 'done' }));
    expect(root().querySelector(`.${HANDBACK_BUTTON_CLASS}`)).toBeNull();
    expect(root().querySelector('[role="status"]')?.textContent).toBe('reassigned, reload to update');
    expect(root().querySelector('[role="alert"]')).toBeNull();
  });

  it('cleans up', () => {
    document.body.innerHTML = sidebar;
    overviewAssignees.sync(root(), options());
    clearHandbackUi();
    expect(document.querySelector(`[${HANDBACK_ROOT_ATTRIBUTE}]`)).toBeNull();
  });
});

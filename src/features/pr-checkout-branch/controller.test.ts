import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutStatusResult, CloneStatus } from '../../shared/types';
import { CheckoutBranchController, type CheckoutApi } from './controller';
import { MARKER } from './dom';

const route = { owner: 'acme', repository: 'widgets', number: 42 };
const target = { ...route, branch: 'feature/x', fork: false };

function fixture(): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures/pr-checkout-branch/head-branch.html'), 'utf8');
}

const clean: CloneStatus = { path: '/home/me/widgets', branch: 'main', checkedOut: false, blocker: null };
const dirty: CloneStatus = {
  path: '/home/me/widgets-2',
  branch: 'main',
  checkedOut: false,
  blocker: { kind: 'changes', staged: 1, modified: 0, conflicts: 0 },
};

function api(statuses: CheckoutStatusResult[]): CheckoutApi & { [K in keyof CheckoutApi]: ReturnType<typeof vi.fn> } {
  let index = 0;
  return {
    status: vi.fn(async () => statuses[Math.min(index++, statuses.length - 1)]!),
    start: vi.fn(async () => ({ status: 'started' as const })),
    focus: vi.fn(async () => ({ status: 'focused' as const })),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((done) => setTimeout(done, 0));
  }
}

function button(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`button[${MARKER}="button"]`)!;
}

function items(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>(`[${MARKER}="menu"] [data-path]`)];
}

let controller: CheckoutBranchController | null = null;

afterEach(() => {
  controller?.stop();
  controller = null;
  vi.useRealTimers();
});

describe('CheckoutBranchController', () => {
  it('labels the button with the clone that already has the branch', async () => {
    document.body.innerHTML = fixture();
    const fake = api([{ status: 'ok', clones: [{ ...clean, branch: 'feature/x', checkedOut: true }] }]);
    controller = new CheckoutBranchController(route, fake);
    controller.start();
    await settle();

    expect(fake.status).toHaveBeenCalledWith(target);
    expect(button().getAttribute('aria-label')).toBe('Checked out in widgets');

    button().click();
    await settle();
    expect(items().map((item) => item.textContent)).toEqual(['widgetsFocus windowChecked out here']);
    items()[0]!.click();
    await settle();
    expect(fake.focus).toHaveBeenCalledWith('/home/me/widgets');
    expect(document.querySelector(`[${MARKER}="menu"]`)).toBeNull();
  });

  it('starts a checkout in a clean clone and polls until it lands', async () => {
    document.body.innerHTML = fixture();
    const fake = api([
      { status: 'ok', clones: [clean, dirty] },
      { status: 'ok', clones: [clean, dirty] },
      { status: 'ok', clones: [{ ...clean, branch: 'feature/x', checkedOut: true }, dirty] },
    ]);
    controller = new CheckoutBranchController(route, fake);
    controller.start();
    await settle();

    button().click();
    await settle();
    const [available, blocked] = items();
    expect(blocked!.dataset.ghtCobState).toBe('blocked');
    expect(blocked!.textContent).toContain('Uncommitted changes: 1 staged');

    vi.useFakeTimers();
    available!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.start).toHaveBeenCalledWith(target, '/home/me/widgets');
    expect(document.querySelector('.ght-cob-note')?.textContent).toContain('Answer any hook prompts');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(button().getAttribute('aria-label')).toBe('Checked out in widgets');
    expect(document.querySelector('.ght-cob-note')?.textContent).toBe('Checked out in widgets.');
    const calls = fake.status.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.status.mock.calls.length).toBe(calls);
  });

  it('shows companion failures in the menu', async () => {
    document.body.innerHTML = fixture();
    const fake = api([{ status: 'failed', reason: 'companion-offline', message: 'Companion offline.' }]);
    controller = new CheckoutBranchController(route, fake);
    controller.start();
    await settle();

    button().click();
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Companion offline.');
    expect(items()).toHaveLength(0);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.querySelector(`[${MARKER}="menu"]`)!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(document.querySelector(`[${MARKER}="menu"]`)).toBeNull();
  });

  it('removes its UI on stop', async () => {
    document.body.innerHTML = fixture();
    controller = new CheckoutBranchController(route, api([{ status: 'ok', clones: [] }]));
    controller.start();
    await settle();
    button().click();
    controller.stop();
    controller = null;
    expect(document.querySelectorAll(`[${MARKER}]`)).toHaveLength(0);
  });
});

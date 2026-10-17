import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenResult, OpenTarget } from '../../shared/types';
import { OpenInCursorController } from './controller';
import { MARKER } from './dom';

function fixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures/open-in-cursor', name), 'utf8');
}

const ref = { owner: 'acme', repository: 'widgets', number: 42 };

let controller: OpenInCursorController | null = null;

afterEach(() => {
  controller?.stop();
  controller = null;
});

async function nextFrame(): Promise<void> {
  await new Promise((done) => requestAnimationFrame(() => done(undefined)));
  await new Promise((done) => setTimeout(done, 0));
}

describe('OpenInCursorController', () => {
  it('injects the diff menu item for the clicked line and cleans up on stop', async () => {
    document.body.innerHTML = fixture('diff-file-header.html');
    document.querySelector('tbody')!.innerHTML = fixture('diff-line.html');
    const open = vi.fn(async (_target: OpenTarget): Promise<OpenResult> => ({ status: 'opened' }));
    controller = new OpenInCursorController({ kind: 'pull', ref }, open);
    controller.start();
    expect(document.querySelectorAll(`[${MARKER}="file-header"]`)).toHaveLength(1);

    document
      .querySelector<HTMLButtonElement>('td[data-line-number="32"] button[aria-label="More actions"]')!
      .click();
    document.body.insertAdjacentHTML('beforeend', fixture('diff-line-menu.html'));
    await nextFrame();
    expect(document.querySelectorAll(`[${MARKER}="diff-line-menu"]`)).toHaveLength(1);

    controller.stop();
    controller = null;
    expect(document.querySelector(`[${MARKER}]`)).toBeNull();

    document.querySelector('[role="menu"]')!.append(document.createElement('li'));
    await nextFrame();
    expect(document.querySelector(`[${MARKER}]`)).toBeNull();
  });

  it('re-mounts controls that GitHub re-renders away', async () => {
    document.body.innerHTML = fixture('conversation-review-threads.html');
    controller = new OpenInCursorController({ kind: 'pull', ref }, vi.fn());
    controller.start();
    expect(document.querySelectorAll(`[${MARKER}="conversation-thread"]`)).toHaveLength(2);

    document.body.innerHTML = fixture('conversation-review-threads.html');
    await nextFrame();
    expect(document.querySelectorAll(`[${MARKER}="conversation-thread"]`)).toHaveLength(2);
  });

  it('only mounts blob controls on blob routes', () => {
    document.body.innerHTML = fixture('blob-header.html') + fixture('conversation-review-threads.html');
    controller = new OpenInCursorController({ kind: 'blob', owner: 'acme', repository: 'widgets' }, vi.fn());
    controller.start();
    expect(document.querySelectorAll(`[${MARKER}="blob-toolbar"]`)).toHaveLength(1);
    expect(document.querySelectorAll(`[${MARKER}="conversation-thread"]`)).toHaveLength(0);
  });
});

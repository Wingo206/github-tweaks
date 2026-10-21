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
  it('follows the Add comment button as GitHub moves it between lines and cleans up on stop', async () => {
    document.body.innerHTML = fixture('diff-file-header.html');
    const tbody = document.querySelector('tbody')!;
    const open = vi.fn(async (_target: OpenTarget): Promise<OpenResult> => ({ status: 'opened' }));
    controller = new OpenInCursorController({ kind: 'pull', ref }, open);
    controller.start();
    expect(document.querySelectorAll(`[${MARKER}="diff-line"]`)).toHaveLength(0);

    tbody.innerHTML = fixture('diff-line.html');
    await nextFrame();
    expect(document.querySelectorAll(`[${MARKER}="file-header"]`)).toHaveLength(1);
    expect(document.querySelectorAll(`[${MARKER}="diff-line"]`)).toHaveLength(1);

    const addComment = document.querySelector('[data-add-comment-button]')!.parentElement!;
    document.querySelector('td.diff-text-cell[data-line-number="29"][data-diff-side="right"]')!.append(addComment);
    await nextFrame();
    const buttons = document.querySelectorAll<HTMLButtonElement>(`[${MARKER}="diff-line"]`);
    expect(buttons).toHaveLength(1);
    buttons[0]!.click();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ line: 29 }));
    await nextFrame();

    controller.stop();
    controller = null;
    expect(document.querySelector(`[${MARKER}]`)).toBeNull();

    tbody.append(document.createElement('tr'));
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

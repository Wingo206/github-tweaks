import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { OpenResult, OpenTarget } from '../../shared/types';
import {
  ACCESSIBLE_NAME,
  clearOpenInCursorUi,
  MARKER,
  syncBlobLineMenu,
  syncBlobToolbar,
  syncChangesThreads,
  syncConversationThreads,
  syncDiffLineButtons,
  syncFileHeaders,
} from './dom';

function fixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures/open-in-cursor', name), 'utf8');
}

const ref = { owner: 'acme', repository: 'widgets', number: 42 };

function opener(result: OpenResult = { status: 'opened' }) {
  return vi.fn(async (_target: OpenTarget) => result);
}

function renderFileSection(withLines = true): HTMLElement {
  document.body.innerHTML = fixture('diff-file-header.html');
  const section = document.querySelector<HTMLElement>('[role="region"]')!;
  if (withLines) {
    section.querySelector('tbody')!.innerHTML = fixture('diff-line.html');
  }
  return section;
}

function controls(surface: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${MARKER}="${surface}"]`));
}

async function flush(): Promise<void> {
  await new Promise((done) => setTimeout(done, 0));
}

describe('file header', () => {
  it('mounts one button after Copy file name and opens the first added line', async () => {
    renderFileSection();
    const open = opener();
    syncFileHeaders(document, ref, open);
    syncFileHeaders(document, ref, open);

    const [button] = controls('file-header');
    expect(controls('file-header')).toHaveLength(1);
    expect(button!.getAttribute('aria-label')).toBe(ACCESSIBLE_NAME);
    expect(button!.previousElementSibling?.getAttribute('aria-label')).toBe(
      'Copy file name to clipboard',
    );

    button!.click();
    expect(open).toHaveBeenCalledWith({
      kind: 'pr-line',
      ...ref,
      path: 'src/widgets/panel.ts',
      line: 32,
    });
    expect(button!.dataset.ghtOicState).toBe('working');
    await flush();
    expect(button!.dataset.ghtOicState).toBe('opened');
  });

  it('opens line 1 when no lines are rendered yet', () => {
    renderFileSection(false);
    const open = opener();
    syncFileHeaders(document, ref, open);
    controls('file-header')[0]!.click();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ line: 1 }));
  });

  it('falls back to the first right-side line without additions', () => {
    const section = renderFileSection();
    section.querySelectorAll('code.addition').forEach((code) => code.classList.remove('addition'));
    const open = opener();
    syncFileHeaders(document, ref, open);
    controls('file-header')[0]!.click();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ line: 29 }));
  });

  it('skips deleted files', () => {
    const section = renderFileSection();
    section.querySelectorAll('[data-diff-side="right"]').forEach((cell) => cell.remove());
    syncFileHeaders(document, ref, opener());
    expect(controls('file-header')).toHaveLength(0);
  });

  it('shows the failure message and cleans up', async () => {
    renderFileSection();
    syncFileHeaders(
      document,
      ref,
      opener({ status: 'failed', reason: 'no-clone', message: 'nope' }),
    );
    const [button] = controls('file-header');
    button!.click();
    await flush();
    expect(button!.dataset.ghtOicState).toBe('failed');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('No local clone');

    clearOpenInCursorUi();
    expect(document.querySelector(`[${MARKER}]`)).toBeNull();
  });
});

describe('diff line button', () => {
  it('mounts once after the Add comment button and opens that line', async () => {
    renderFileSection();
    const open = opener();
    syncDiffLineButtons(document, ref, open);
    syncDiffLineButtons(document, ref, open);

    const buttons = controls('diff-line');
    expect(buttons).toHaveLength(1);
    const button = buttons[0]!;
    expect(button.getAttribute('aria-label')).toBe(ACCESSIBLE_NAME);
    expect(button.previousElementSibling?.getAttribute('aria-label')).toBe('Add comment');
    expect(button.classList).toContain('prc-Button-ButtonBase-9n-Xk');
    expect(button.classList).toContain('actionBarHeight__6G4Owz');
    expect(button.classList).not.toContain('bgColor-accent-emphasis');
    expect(button.classList).not.toContain('fgColor-onEmphasis');
    expect(button.classList).not.toContain('addCommentButtonNew__zrLl3i');

    const cellClick = vi.fn();
    button.closest('td')!.addEventListener('click', cellClick);
    button.click();
    expect(cellClick).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith({ kind: 'pr-line', ...ref, path: 'src/widgets/panel.ts', line: 32 });
    await flush();
    expect(document.querySelector(`[${MARKER}="toast"]`)?.textContent).toBe('Opened in Cursor');
  });

  it('reports failures in a toast', async () => {
    renderFileSection();
    syncDiffLineButtons(document, ref, opener({ status: 'failed', reason: 'no-clone', message: 'nope' }));
    controls('diff-line')[0]!.click();
    await flush();
    expect(document.querySelector(`[${MARKER}="toast"]`)?.textContent).toContain('No local clone');
  });

  it('ignores Add comment buttons outside a diff line cell', () => {
    document.body.innerHTML =
      '<div><button type="button" aria-label="Add comment" data-add-comment-button="true"></button></div>';
    syncDiffLineButtons(document, ref, opener());
    expect(controls('diff-line')).toHaveLength(0);
  });
});

describe('changes tab review thread', () => {
  it('mounts beside the heading with comment id and DOM fallback', () => {
    renderFileSection();
    document.querySelector('tbody')!.insertAdjacentHTML(
      'beforeend',
      `<tr><td colspan="4">${fixture('changes-review-thread.html')}</td></tr>`,
    );
    const open = opener();
    syncChangesThreads(document, ref, open);
    syncChangesThreads(document, ref, open);

    const buttons = controls('changes-thread');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.previousElementSibling?.tagName).toBe('H2');
    buttons[0]!.click();
    expect(open).toHaveBeenCalledWith({
      kind: 'pr-comment',
      ...ref,
      commentId: '2002',
      fallback: { path: 'src/widgets/panel.ts', line: 108 },
    });
  });
});

describe('conversation tab review threads', () => {
  it('mounts after the path link for expanded and collapsed threads', () => {
    document.body.innerHTML = fixture('conversation-review-threads.html');
    const open = opener();
    syncConversationThreads(document, ref, open);
    syncConversationThreads(document, ref, open);

    const buttons = controls('conversation-thread');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.previousElementSibling?.tagName).toBe('A');

    buttons[0]!.click();
    buttons[1]!.click();
    expect(open.mock.calls.map(([target]) => target)).toEqual([
      { kind: 'pr-comment', ...ref, commentId: '4001', fallback: null },
      { kind: 'pr-comment', ...ref, commentId: '5001', fallback: null },
    ]);
  });

  it('does not toggle the thread when clicked', () => {
    document.body.innerHTML = fixture('conversation-review-threads.html');
    syncConversationThreads(document, ref, opener());
    const toggle = vi.fn();
    document.querySelector('review-thread-collapsible')!.addEventListener('click', toggle);
    controls('conversation-thread')[0]!.click();
    expect(toggle).not.toHaveBeenCalled();
  });
});

describe('blob page', () => {
  it('mounts after the Raw/Copy/Download group and resolves the ref from route data', () => {
    window.history.replaceState(null, '', '/acme/widgets/blob/feature/nested/src/widgets/panel.ts#L9-L15');
    document.body.innerHTML = fixture('blob-header.html');
    const open = opener();
    syncBlobToolbar(document, open);
    syncBlobToolbar(document, open);

    const buttons = controls('blob-toolbar');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.previousElementSibling?.querySelector('[data-testid="raw-button"]')).not.toBeNull();
    buttons[0]!.click();
    expect(open).toHaveBeenCalledWith({
      kind: 'blob',
      owner: 'acme',
      repository: 'widgets',
      ref: { kind: 'branch', name: 'feature/nested' },
      path: 'src/widgets/panel.ts',
      line: 9,
    });
  });

  it('adds an item after View file in GitHub.dev to the line menu', () => {
    window.history.replaceState(null, '', '/acme/widgets/blob/feature/nested/src/widgets/panel.ts#L3');
    document.body.innerHTML = fixture('blob-header.html') + fixture('blob-line-menu.html');
    const menu = document.querySelector<HTMLElement>('[data-testid="highlighted-line-menu"]')!;
    const open = opener();
    syncBlobLineMenu(menu, open);
    syncBlobLineMenu(menu, open);

    const items = controls('blob-line-menu');
    expect(items).toHaveLength(1);
    expect(items[0]!.previousElementSibling?.textContent).toContain('View file in GitHub.dev');
    items[0]!.click();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/widgets/panel.ts', line: 3 }));
  });
});

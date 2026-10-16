import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MERMAID_ERROR_LOG_KEY,
  MERMAID_ERROR_LOG_LIMIT,
  describeMissingDiagram,
  logMermaidViewerFailure,
  readMermaidViewerErrors,
} from './errors';

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Mermaid viewer error log', () => {
  it('prints the failure and appends it to localStorage', () => {
    logMermaidViewerFailure({
      reason: 'request-timeout',
      detail: 'No SVG response within 2500ms.',
    });

    const stored = readMermaidViewerErrors();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      reason: 'request-timeout',
      detail: 'No SVG response within 2500ms.',
      href: location.href,
    });
    expect(stored[0]?.at).toEqual(expect.any(String));
    expect(errorSpy).toHaveBeenCalledWith(
      `[ght-mermaid] fullscreen viewer failed (localStorage["${MERMAID_ERROR_LOG_KEY}"])`,
      stored[0],
    );
  });

  it('keeps only the newest records and ignores corrupt storage', () => {
    localStorage.setItem(MERMAID_ERROR_LOG_KEY, '{');
    for (let index = 0; index < MERMAID_ERROR_LOG_LIMIT + 2; index += 1) {
      logMermaidViewerFailure({ reason: 'empty-svg', detail: `miss-${index}` });
    }

    const stored = readMermaidViewerErrors();
    expect(stored).toHaveLength(MERMAID_ERROR_LOG_LIMIT);
    expect(stored[0]?.detail).toBe('miss-2');
    expect(stored.at(-1)?.detail).toBe(
      `miss-${MERMAID_ERROR_LOG_LIMIT + 1}`,
    );
  });

  it('still returns when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    expect(() =>
      logMermaidViewerFailure({ reason: 'missing-frame' }),
    ).not.toThrow();
  });

  it('describes a viewscreen document that has no diagram svg', () => {
    document.body.innerHTML = `
      <p>Syntax error in graph</p>
      <svg id="icon" class="octicon"></svg>
    `;

    const snapshot = JSON.parse(describeMissingDiagram(document)) as {
      hasDiagram: boolean;
      svgCount: number;
      svgs: Array<{ id: string; className: string }>;
      text: string;
    };

    expect(snapshot.hasDiagram).toBe(false);
    expect(snapshot.svgCount).toBe(1);
    expect(snapshot.svgs).toEqual([{ id: 'icon', className: 'octicon' }]);
    expect(snapshot.text).toContain('Syntax error in graph');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearMermaidLogs,
  collectMermaidLogs,
  mermaidLogFilename,
  summarizeMermaidLogs,
} from './diagnostics';
import { logMermaidViewerFailure } from './errors';
import { traceMermaid } from './trace';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Mermaid log export', () => {
  it('bundles stored errors and trace with page context', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    logMermaidViewerFailure({ reason: 'request-timeout' });
    traceMermaid('warn', 'wired-without-listener', { identity: 'a' });

    expect(collectMermaidLogs()).toMatchObject({
      exportedAt: expect.any(String),
      href: location.href,
      userAgent: navigator.userAgent,
      errors: [{ reason: 'request-timeout' }],
      trace: [{ event: 'wired-without-listener', data: { identity: 'a' } }],
    });
  });

  it('returns empty lists when nothing was recorded', () => {
    expect(collectMermaidLogs()).toMatchObject({ errors: [], trace: [] });
  });

  it('summarizes counts and clears both stores', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    logMermaidViewerFailure({ reason: 'empty-svg' });
    traceMermaid('warn', 'mount-stuck');
    traceMermaid('debug', 'mounted');

    expect(summarizeMermaidLogs(collectMermaidLogs())).toBe(
      '1 error, 1 warning, 2 trace events',
    );

    clearMermaidLogs();
    expect(summarizeMermaidLogs(collectMermaidLogs())).toBe(
      '0 errors, 0 warnings, 0 trace events',
    );
  });

  it('builds a filesystem-safe filename', () => {
    expect(mermaidLogFilename('2026-10-21T18:40:12.345Z')).toBe(
      'ght-mermaid-logs-2026-10-21T18-40-12-345Z.json',
    );
  });
});

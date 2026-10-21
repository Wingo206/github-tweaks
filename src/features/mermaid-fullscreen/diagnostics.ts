import {
  MERMAID_ERROR_LOG_KEY,
  readMermaidViewerErrors,
  type MermaidViewerErrorRecord,
} from './errors';
import {
  MERMAID_TRACE_KEY,
  readMermaidTrace,
  type MermaidTraceRecord,
} from './trace';

export interface MermaidLogExport {
  exportedAt: string;
  href: string;
  userAgent: string;
  errors: MermaidViewerErrorRecord[];
  trace: MermaidTraceRecord[];
}

export function collectMermaidLogs(
  storage: Storage = localStorage,
): MermaidLogExport {
  return {
    exportedAt: new Date().toISOString(),
    href: globalThis.location?.href ?? '',
    userAgent: globalThis.navigator?.userAgent ?? '',
    errors: readMermaidViewerErrors(storage),
    trace: readMermaidTrace(storage),
  };
}

export function clearMermaidLogs(storage: Storage = localStorage): void {
  storage.removeItem(MERMAID_ERROR_LOG_KEY);
  storage.removeItem(MERMAID_TRACE_KEY);
}

export function summarizeMermaidLogs(logs: MermaidLogExport): string {
  const warnings = logs.trace.filter((record) => record.level === 'warn').length;
  const plural = (count: number, noun: string): string =>
    `${count} ${noun}${count === 1 ? '' : 's'}`;
  return `${plural(logs.errors.length, 'error')}, ${plural(warnings, 'warning')}, ${plural(logs.trace.length, 'trace event')}`;
}

export function mermaidLogFilename(exportedAt: string): string {
  return `ght-mermaid-logs-${exportedAt.replace(/[:.]/g, '-')}.json`;
}

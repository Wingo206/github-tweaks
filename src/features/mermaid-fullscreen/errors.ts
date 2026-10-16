export const MERMAID_ERROR_LOG_KEY = 'ght-mermaid-fullscreen-errors';
export const MERMAID_ERROR_LOG_LIMIT = 20;

const DETAIL_LIMIT = 2000;
const PAGE_TEXT_LIMIT = 240;

export type MermaidViewerFailureReason =
  | 'missing-frame'
  | 'request-timeout'
  | 'empty-svg'
  | 'invalid-svg';

export interface MermaidViewerFailure {
  reason: MermaidViewerFailureReason;
  detail?: string;
}

export interface MermaidViewerErrorRecord extends MermaidViewerFailure {
  at: string;
  href: string;
}

function isErrorRecord(value: unknown): value is MermaidViewerErrorRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.at === 'string' &&
    typeof record.href === 'string' &&
    typeof record.reason === 'string' &&
    (record.detail === undefined || typeof record.detail === 'string')
  );
}

export function readMermaidViewerErrors(
  storage: Storage = localStorage,
): MermaidViewerErrorRecord[] {
  try {
    const raw = storage.getItem(MERMAID_ERROR_LOG_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isErrorRecord);
  } catch {
    return [];
  }
}

/** Print a viewer failure and keep the latest records in localStorage. */
export function logMermaidViewerFailure(
  failure: MermaidViewerFailure,
  storage: Storage = localStorage,
): void {
  const record: MermaidViewerErrorRecord = {
    at: new Date().toISOString(),
    href: globalThis.location?.href ?? '',
    reason: failure.reason,
  };
  if (failure.detail) {
    record.detail = failure.detail.slice(0, DETAIL_LIMIT);
  }

  try {
    console.error(
      `[ght-mermaid] fullscreen viewer failed (localStorage["${MERMAID_ERROR_LOG_KEY}"])`,
      record,
    );
  } catch {
    // Logging must not block the error UI.
  }

  try {
    const next = [...readMermaidViewerErrors(storage), record].slice(
      -MERMAID_ERROR_LOG_LIMIT,
    );
    storage.setItem(MERMAID_ERROR_LOG_KEY, JSON.stringify(next));
  } catch (error) {
    try {
      console.error('[ght-mermaid] could not save viewer error', error);
    } catch {
      // Ignore storage failures in restricted contexts.
    }
  }
}

/** Short snapshot of a viewscreen document that never produced svg#diagram. */
export function describeMissingDiagram(doc: Document): string {
  const svgs = Array.from(doc.querySelectorAll('svg'))
    .slice(0, 6)
    .map((svg) => ({
      id: svg.id,
      className: svg.getAttribute('class') ?? '',
    }));
  const text = (doc.body?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PAGE_TEXT_LIMIT);

  return JSON.stringify({
    readyState: doc.readyState,
    svgCount: doc.querySelectorAll('svg').length,
    hasDiagram: doc.querySelector('svg#diagram') !== null,
    svgs,
    text,
  });
}

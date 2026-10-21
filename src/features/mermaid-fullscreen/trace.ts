import { findInlineMermaidFrame } from './bridge';
import {
  NATIVE_FALLBACK_ATTRIBUTE,
  NATIVE_HIDDEN_ATTRIBUTE,
  WIRED_ATTRIBUTE,
  ACTIONS_SELECTOR,
  findActionsRow,
  findAllNativeDetails,
  findNativeDetails,
  findOpenButton,
  findVisibleNativeDetails,
  isRenderError,
} from './dom';

export const MERMAID_TRACE_KEY = 'ght-mermaid-fullscreen-trace';
export const MERMAID_TRACE_LIMIT = 100;

export type MermaidTraceLevel = 'debug' | 'warn';

export interface MermaidTraceRecord {
  at: string;
  href: string;
  level: MermaidTraceLevel;
  event: string;
  data?: Record<string, unknown>;
}

function isTraceRecord(value: unknown): value is MermaidTraceRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.at === 'string' &&
    typeof record.href === 'string' &&
    (record.level === 'debug' || record.level === 'warn') &&
    typeof record.event === 'string'
  );
}

export function readMermaidTrace(
  storage: Storage = localStorage,
): MermaidTraceRecord[] {
  try {
    const raw = storage.getItem(MERMAID_TRACE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isTraceRecord);
  } catch {
    return [];
  }
}

/**
 * Print a lifecycle event (`debug` shows under the Verbose console level) and
 * keep the latest records in localStorage for after-the-fact diagnosis.
 */
export function traceMermaid(
  level: MermaidTraceLevel,
  event: string,
  data?: Record<string, unknown>,
  storage: Storage = localStorage,
): void {
  const record: MermaidTraceRecord = {
    at: new Date().toISOString(),
    href: globalThis.location?.href ?? '',
    level,
    event,
  };
  if (data) {
    record.data = data;
  }

  try {
    const print = level === 'warn' ? console.warn : console.debug;
    print(`[ght-mermaid] ${event}`, data ?? {});
  } catch {
    // Tracing must not affect the viewer.
  }

  try {
    const next = [...readMermaidTrace(storage), record].slice(
      -MERMAID_TRACE_LIMIT,
    );
    storage.setItem(MERMAID_TRACE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

/** Snapshot of the embed pieces the controller depends on. */
export function describeEmbed(embed: HTMLElement): Record<string, unknown> {
  const details = findNativeDetails(embed);
  const frame = findInlineMermaidFrame(embed);
  const button = findOpenButton(embed);
  return {
    identity: embed.dataset.identity ?? null,
    className: embed.className,
    renderError: isRenderError(embed),
    connected: embed.isConnected,
    wired: embed.hasAttribute(WIRED_ATTRIBUTE),
    nativeFallback: embed.hasAttribute(NATIVE_FALLBACK_ATTRIBUTE),
    hasActionsRow: findActionsRow(embed) !== null,
    hasNativeDetails: details !== null,
    nativeHidden: details?.hasAttribute(NATIVE_HIDDEN_ATTRIBUTE) ?? false,
    hasOpenButton: button !== null,
    openButtonVisible: button ? button.getClientRects().length > 0 : false,
    actionsRows: embed.querySelectorAll(ACTIONS_SELECTOR).length,
    nativeControls: findAllNativeDetails(embed).length,
    visibleNativeControls: findVisibleNativeDetails(embed).length,
    hasFrame: frame !== null,
    frameHasWindow: Boolean(frame?.contentWindow),
    renderTargetClass:
      embed.querySelector('.js-render-target')?.className ?? null,
  };
}

const OUTLINE_NODE_LIMIT = 40;

/** Indented tag.class tree of an element, without descending into SVGs. */
export function outlineElement(root: Element, maxDepth = 4): string[] {
  const lines: string[] = [];
  const visit = (element: Element, depth: number): void => {
    if (lines.length >= OUTLINE_NODE_LIMIT) {
      return;
    }
    const classes = Array.from(element.classList).slice(0, 4).join('.');
    lines.push(
      `${'  '.repeat(depth)}${element.localName}${classes ? `.${classes}` : ''}`,
    );
    if (depth >= maxDepth || element.localName === 'svg') {
      return;
    }
    for (const child of Array.from(element.children)) {
      visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return lines;
}

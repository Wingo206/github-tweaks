import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findMermaidEmbeds, mountOpenControl } from './dom';
import {
  MERMAID_TRACE_KEY,
  MERMAID_TRACE_LIMIT,
  describeEmbed,
  readMermaidTrace,
  traceMermaid,
} from './trace';

const fixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/mermaid-embed.html'),
  'utf8',
);

let debugSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Mermaid trace log', () => {
  it('prints by level and appends to localStorage', () => {
    traceMermaid('debug', 'open', { identity: 'a' });
    traceMermaid('warn', 'mount-stuck');

    expect(debugSpy).toHaveBeenCalledWith('[ght-mermaid] open', {
      identity: 'a',
    });
    expect(warnSpy).toHaveBeenCalledWith('[ght-mermaid] mount-stuck', {});
    expect(readMermaidTrace()).toMatchObject([
      { level: 'debug', event: 'open', data: { identity: 'a' } },
      { level: 'warn', event: 'mount-stuck', href: location.href },
    ]);
  });

  it('keeps only the newest records and ignores corrupt storage', () => {
    localStorage.setItem(MERMAID_TRACE_KEY, '{');
    for (let index = 0; index < MERMAID_TRACE_LIMIT + 2; index += 1) {
      traceMermaid('debug', `event-${index}`);
    }

    const stored = readMermaidTrace();
    expect(stored).toHaveLength(MERMAID_TRACE_LIMIT);
    expect(stored[0]?.event).toBe('event-2');
    expect(stored.at(-1)?.event).toBe(`event-${MERMAID_TRACE_LIMIT + 1}`);
  });

  it('still returns when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    expect(() => traceMermaid('warn', 'open-ignored')).not.toThrow();
  });

  it('describes the embed pieces the controller depends on', () => {
    document.body.innerHTML = fixture;
    const embed = findMermaidEmbeds()[0]!;

    expect(describeEmbed(embed)).toMatchObject({
      identity: 'fixture-mermaid-1',
      connected: true,
      wired: false,
      hasActionsRow: true,
      hasNativeDetails: true,
      nativeHidden: false,
      hasOpenButton: false,
      hasFrame: true,
    });

    mountOpenControl(embed);
    expect(describeEmbed(embed)).toMatchObject({
      nativeHidden: true,
      hasOpenButton: true,
    });
  });
});

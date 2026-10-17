import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  LineDecoder,
  normalizeRemote,
  parseOpenRequest,
  parseWindowMessage,
} from './protocol';

describe('normalizeRemote', () => {
  it.each([
    ['git@github.com:Acme/Widgets.git', 'github.com/acme/widgets'],
    ['git@github.com:acme/widgets', 'github.com/acme/widgets'],
    ['ssh://git@github.com/acme/widgets.git', 'github.com/acme/widgets'],
    ['ssh://git@github.com:22/acme/widgets.git', 'github.com/acme/widgets'],
    ['https://github.com/acme/widgets', 'github.com/acme/widgets'],
    ['https://github.com/acme/widgets.git', 'github.com/acme/widgets'],
    ['https://user@github.com/acme/widgets.git/', 'github.com/acme/widgets'],
  ])('normalizes %s', (url, expected) => {
    expect(normalizeRemote(url)).toBe(expected);
  });

  it('rejects non-GitHub remotes', () => {
    expect(normalizeRemote('git@gitlab.com:acme/widgets.git')).toBeNull();
    expect(normalizeRemote('https://github.com/acme')).toBeNull();
    expect(normalizeRemote('https://github.com/acme/widgets/extra')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('compares numerically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.1', '0.1.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0);
  });
});

describe('parseOpenRequest', () => {
  const valid = { repo: 'acme/widgets', path: 'src/a.ts', line: 3, column: 1, ref: null };

  it('accepts a valid request', () => {
    expect(parseOpenRequest(valid)).toEqual(valid);
    expect(parseOpenRequest({ ...valid, ref: { kind: 'branch', name: 'feat/x' } })?.ref).toEqual({
      kind: 'branch',
      name: 'feat/x',
    });
    expect(parseOpenRequest({ ...valid, ref: { kind: 'commit', sha: 'a'.repeat(40) } })).not.toBeNull();
  });

  it.each([
    { ...valid, repo: 'acme' },
    { ...valid, path: '/etc/passwd' },
    { ...valid, path: 'src/../../etc/passwd' },
    { ...valid, path: 'src//a.ts' },
    { ...valid, line: 0 },
    { ...valid, column: 1.5 },
    { ...valid, ref: { kind: 'tag', name: 'v1' } },
    { ...valid, ref: undefined },
    'nope',
  ])('rejects %j', (value) => {
    expect(parseOpenRequest(value)).toBeNull();
  });
});

describe('parseWindowMessage', () => {
  it('parses state messages and rejects malformed folders', () => {
    const folder = { path: '/w', remotes: ['github.com/a/b'], branch: 'main', upstreamBranch: null };
    expect(parseWindowMessage({ type: 'state', folders: [folder], focused: true })).toEqual({
      type: 'state',
      folders: [folder],
      focused: true,
    });
    expect(parseWindowMessage({ type: 'state', folders: [{ path: '/w' }], focused: true })).toBeNull();
    expect(parseWindowMessage({ type: 'opened', requestId: 'r', ok: false })).toBeNull();
    expect(parseWindowMessage({ type: 'opened', requestId: 'r', ok: false, error: 'x' })).not.toBeNull();
  });
});

describe('LineDecoder', () => {
  it('splits chunks on newlines and keeps partial lines', () => {
    const decoder = new LineDecoder();
    expect(decoder.push('{"a":1}\n{"b"')).toEqual([{ a: 1 }]);
    expect(decoder.push(':2}\nnot json\n')).toEqual([{ b: 2 }, undefined]);
  });
});

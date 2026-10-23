import { describe, expect, it } from 'vitest';
import {
  checkoutBlocker,
  compareVersions,
  describeCheckoutBlocker,
  isSafeBranchName,
  LineDecoder,
  normalizeRemote,
  parseBranchStatusRequest,
  parseCheckoutRequest,
  parseFocusRequest,
  parseOpenRequest,
  parseServerMessage,
  parseWindowMessage,
  type FolderState,
  type WorkingTreeState,
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
    const workingTree = { staged: 1, modified: 0, conflicts: 0, rebasing: false };
    const folder = { path: '/w', remotes: ['github.com/a/b'], branch: 'main', upstreamBranch: null, workingTree };
    expect(parseWindowMessage({ type: 'state', folders: [folder], focused: true })).toEqual({
      type: 'state',
      folders: [folder],
      focused: true,
    });
    expect(parseWindowMessage({ type: 'state', folders: [{ path: '/w' }], focused: true })).toBeNull();
    expect(parseWindowMessage({ type: 'opened', requestId: 'r', ok: false })).toBeNull();
    expect(parseWindowMessage({ type: 'opened', requestId: 'r', ok: false, error: 'x' })).not.toBeNull();
    expect(parseWindowMessage({ type: 'checkout-started', requestId: 'r', ok: true })).toEqual({
      type: 'checkout-started',
      requestId: 'r',
      ok: true,
    });
  });

  it('reads folders from older companions as having an unknown working tree', () => {
    const folder = { path: '/w', remotes: ['github.com/a/b'], branch: 'main', upstreamBranch: null };
    const message = parseWindowMessage({ type: 'state', folders: [folder], focused: true });
    expect(message).toMatchObject({ folders: [{ ...folder, workingTree: null }] });
    expect(checkoutBlocker({ ...folder, workingTree: null })).toEqual({ kind: 'outdated' });
  });
});

describe('checkoutBlocker', () => {
  const folder = (workingTree: Partial<WorkingTreeState>): FolderState => ({
    path: '/w',
    remotes: [],
    branch: 'main',
    upstreamBranch: null,
    workingTree: { staged: 0, modified: 0, conflicts: 0, rebasing: false, ...workingTree },
  });

  it('allows clean trees and describes what blocks the rest', () => {
    expect(checkoutBlocker(folder({}))).toBeNull();
    const changes = checkoutBlocker(folder({ modified: 2, staged: 1 }));
    expect(changes).toEqual({ kind: 'changes', staged: 1, modified: 2, conflicts: 0 });
    expect(describeCheckoutBlocker(changes!)).toBe('Uncommitted changes: 1 staged, 2 modified');
    expect(checkoutBlocker(folder({ rebasing: true, modified: 1 }))).toEqual({ kind: 'rebase' });
    expect(describeCheckoutBlocker({ kind: 'rebase' })).toBe('Rebase in progress');
  });
});

describe('isSafeBranchName', () => {
  it.each(['main', 'feat/x', 'niya/in-4737-update-sources', 'v1.2', 'fix#12', 'a+b', 'under_score'])(
    'accepts %s',
    (name) => {
      expect(isSafeBranchName(name)).toBe(true);
    },
  );

  it.each([
    '',
    '-rf',
    'a..b',
    'a//b',
    '/a',
    'a/',
    '.hidden',
    'a/.b',
    'a.',
    'x.lock',
    "it's",
    'a b',
    'a;b',
    '$(x)',
    'a`b',
    'a@{1}',
    'x'.repeat(256),
  ])('rejects %j', (name) => {
    expect(isSafeBranchName(name)).toBe(false);
  });
});

describe('checkout parsers', () => {
  const command = { repo: 'acme/widgets', branch: 'feat/x', pullNumber: 42, fork: false };

  it('accepts valid requests and server messages', () => {
    expect(parseCheckoutRequest({ ...command, folder: '/home/me/widgets' })).toEqual({
      ...command,
      folder: '/home/me/widgets',
    });
    expect(parseServerMessage({ type: 'checkout', requestId: 'r', path: '/home/me/widgets', ...command })).toEqual({
      type: 'checkout',
      requestId: 'r',
      path: '/home/me/widgets',
      ...command,
    });
    expect(parseBranchStatusRequest({ repo: 'acme/widgets', branch: 'feat/x' })).toEqual({
      repo: 'acme/widgets',
      branch: 'feat/x',
    });
    expect(parseFocusRequest({ folder: '/home/me/widgets' })).toEqual({ folder: '/home/me/widgets' });
  });

  it.each([
    { ...command, folder: 'relative/path' },
    { ...command, folder: '/w', branch: 'a;rm -rf' },
    { ...command, folder: '/w', repo: 'acme' },
    { ...command, folder: '/w', pullNumber: 0 },
    { ...command, folder: '/w', fork: 'yes' },
  ])('rejects %j', (value) => {
    expect(parseCheckoutRequest(value)).toBeNull();
  });
});

describe('LineDecoder', () => {
  it('splits chunks on newlines and keeps partial lines', () => {
    const decoder = new LineDecoder();
    expect(decoder.push('{"a":1}\n{"b"')).toEqual([{ a: 1 }]);
    expect(decoder.push(':2}\nnot json\n')).toEqual([{ b: 2 }, undefined]);
  });
});

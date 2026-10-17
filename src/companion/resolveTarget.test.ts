import { describe, expect, it } from 'vitest';
import type { PullRequestContext } from '../github/pullRequestContext';
import { resolveOpenTarget } from './resolveTarget';

const pr = { owner: 'acme', repository: 'widgets', number: 42 };

const context: PullRequestContext = {
  headRefName: 'feature/x',
  threadsByCommentId: new Map([
    ['100', { path: 'src/current.ts', line: 12, originalLine: 10 }],
    ['200', { path: 'src/outdated.ts', line: null, originalLine: 7 }],
  ]),
};

const withContext = async () => context;
const withoutContext = async () => null;

describe('resolveOpenTarget', () => {
  it('passes blob targets through', async () => {
    const ref = { kind: 'commit' as const, sha: 'a'.repeat(40) };
    expect(
      await resolveOpenTarget(
        { kind: 'blob', owner: 'acme', repository: 'widgets', ref, path: 'a.ts', line: 9 },
        withoutContext,
      ),
    ).toEqual({
      ok: true,
      request: { repo: 'acme/widgets', path: 'a.ts', line: 9, column: 1, ref },
    });
  });

  it('adds the head branch to PR lines when context loads', async () => {
    const target = { kind: 'pr-line' as const, ...pr, path: 'src/a.ts', line: 5 };
    expect(await resolveOpenTarget(target, withContext)).toMatchObject({
      ok: true,
      request: { path: 'src/a.ts', line: 5, ref: { kind: 'branch', name: 'feature/x' } },
    });
    expect(await resolveOpenTarget(target, withoutContext)).toMatchObject({
      ok: true,
      request: { ref: null },
    });
  });

  it('resolves comments through the thread index with line ?? originalLine', async () => {
    const base = { kind: 'pr-comment' as const, ...pr, fallback: null };
    expect(await resolveOpenTarget({ ...base, commentId: '100' }, withContext)).toMatchObject({
      request: { path: 'src/current.ts', line: 12 },
    });
    expect(await resolveOpenTarget({ ...base, commentId: '200' }, withContext)).toMatchObject({
      request: { path: 'src/outdated.ts', line: 7 },
    });
  });

  it('uses the DOM fallback when the comment is unknown or context fails', async () => {
    const target = {
      kind: 'pr-comment' as const,
      ...pr,
      commentId: '999',
      fallback: { path: 'src/dom.ts', line: 3 },
    };
    expect(await resolveOpenTarget(target, withContext)).toMatchObject({
      request: { path: 'src/dom.ts', line: 3, ref: { kind: 'branch', name: 'feature/x' } },
    });
    expect(await resolveOpenTarget(target, withoutContext)).toMatchObject({
      request: { path: 'src/dom.ts', line: 3, ref: null },
    });
  });

  it('fails with comment-not-found without a fallback', async () => {
    const target = { kind: 'pr-comment' as const, ...pr, commentId: '999', fallback: null };
    expect(await resolveOpenTarget(target, withContext)).toMatchObject({
      ok: false,
      result: { status: 'failed', reason: 'comment-not-found' },
    });
    expect(await resolveOpenTarget(target, withoutContext)).toMatchObject({ ok: false });
  });
});

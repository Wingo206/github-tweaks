import { describe, expect, it } from 'vitest';
import { checkoutShellCommand, findRemote } from './checkoutCommand';

const command = { repo: 'acme/widgets', branch: 'feat/x', pullNumber: 42, fork: false };

describe('findRemote', () => {
  it('picks the remote that points at the repository, not the first one', () => {
    const remotes = [
      { name: 'sync-other', fetchUrl: 'git@github.com:acme/other.git' },
      { name: 'origin', fetchUrl: 'git@github.com:Acme/Widgets.git' },
    ];
    expect(findRemote(remotes, 'acme/widgets')).toBe('origin');
    expect(findRemote(remotes, 'acme/missing')).toBeNull();
    expect(findRemote([{ name: "bad'name", fetchUrl: 'https://github.com/acme/widgets' }], 'acme/widgets')).toBeNull();
  });
});

describe('checkoutShellCommand', () => {
  it('switches to an existing local branch after fetching', () => {
    expect(checkoutShellCommand(command, { remote: 'origin', branchExists: true })).toBe(
      "git fetch 'origin' 'feat/x' && git switch 'feat/x'",
    );
  });

  it('creates a tracking branch when there is no local branch', () => {
    expect(checkoutShellCommand(command, { remote: 'origin', branchExists: false })).toBe(
      "git fetch 'origin' 'feat/x' && git switch -c 'feat/x' --track 'origin/feat/x'",
    );
  });

  it('uses gh for fork branches', () => {
    expect(checkoutShellCommand({ ...command, fork: true }, { remote: null, branchExists: false })).toBe(
      "gh pr checkout 42 --repo 'acme/widgets'",
    );
  });

  it('refuses without a matching remote', () => {
    expect(() => checkoutShellCommand(command, { remote: null, branchExists: false })).toThrow(
      'No remote points at acme/widgets.',
    );
  });
});

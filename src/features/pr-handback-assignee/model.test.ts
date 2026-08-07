import { describe, expect, it } from 'vitest';
import {
  parsePullRequestUrl,
  shouldShowHandbackButton,
} from './model';

describe('parsePullRequestUrl', () => {
  it('matches conversation and other PR tabs', () => {
    expect(
      parsePullRequestUrl(new URL('https://github.com/acme/widgets/pull/42')),
    ).toEqual({ owner: 'acme', repository: 'widgets', number: 42 });
    expect(
      parsePullRequestUrl(
        new URL('https://github.com/acme/widgets/pull/42/commits'),
      ),
    ).toEqual({ owner: 'acme', repository: 'widgets', number: 42 });
    expect(
      parsePullRequestUrl(
        new URL('https://github.com/acme/widgets/pull/42/changes'),
      ),
    ).toEqual({ owner: 'acme', repository: 'widgets', number: 42 });
  });

  it('rejects non-PR routes', () => {
    expect(
      parsePullRequestUrl(new URL('https://github.com/acme/widgets/issues/42')),
    ).toBeNull();
  });
});

describe('shouldShowHandbackButton', () => {
  it('shows only when viewer is assigned and is not the author', () => {
    expect(
      shouldShowHandbackButton({
        viewerLogin: 'reviewer',
        authorLogin: 'author',
        assigneeLogins: ['reviewer', 'teammate'],
      }),
    ).toBe(true);
  });

  it('hides when viewer is the author', () => {
    expect(
      shouldShowHandbackButton({
        viewerLogin: 'author',
        authorLogin: 'author',
        assigneeLogins: ['author'],
      }),
    ).toBe(false);
  });

  it('hides when viewer is not assigned', () => {
    expect(
      shouldShowHandbackButton({
        viewerLogin: 'reviewer',
        authorLogin: 'author',
        assigneeLogins: ['teammate'],
      }),
    ).toBe(false);
  });

  it('treats logins as case-insensitive', () => {
    expect(
      shouldShowHandbackButton({
        viewerLogin: 'Reviewer',
        authorLogin: 'Author',
        assigneeLogins: ['REVIEWER'],
      }),
    ).toBe(true);
  });
});

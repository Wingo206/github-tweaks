import { describe, expect, it } from 'vitest';
import type { PinnedPerson } from '../../shared/types';
import { isPinned, parsePullRequestUrl, togglePin, userIdFromAvatar, visiblePins } from './model';

const ada: PinnedPerson = { id: '33', login: 'ada', name: 'Ada Lovelace', avatarUrl: '' };
const ben: PinnedPerson = { id: '22', login: 'Ben', name: 'Ben Adey', avatarUrl: '' };

describe('parsePullRequestUrl', () => {
  it('reads owner, repository, and number from pull request urls', () => {
    expect(parsePullRequestUrl(new URL('https://github.com/acme/widgets/pull/42/changes'))).toEqual({
      owner: 'acme',
      repository: 'widgets',
      number: 42,
    });
    expect(parsePullRequestUrl(new URL('https://github.com/acme/widgets/issues/42'))).toBeNull();
  });
});

describe('userIdFromAvatar', () => {
  it('reads user ids and rejects apps and non-https urls', () => {
    expect(userIdFromAvatar('https://avatars.githubusercontent.com/u/33?s=40&v=4')).toBe('33');
    expect(userIdFromAvatar('https://avatars.githubusercontent.com/in/946600?s=40&v=4')).toBeNull();
    expect(userIdFromAvatar('http://avatars.githubusercontent.com/u/33')).toBeNull();
    expect(userIdFromAvatar('')).toBeNull();
  });
});

describe('pin list', () => {
  it('sorts alphabetically and filters by login or name', () => {
    expect(visiblePins([ben, ada], '').map((person) => person.login)).toEqual(['ada', 'Ben']);
    expect(visiblePins([ben, ada], 'love').map((person) => person.login)).toEqual(['ada']);
    expect(visiblePins([ben, ada], 'zzz')).toEqual([]);
  });

  it('toggles a person by login, whatever the case', () => {
    const pinned = togglePin([ada], ben);
    expect(pinned.map((person) => person.login)).toEqual(['ada', 'Ben']);
    expect(isPinned(pinned, 'ben')).toBe(true);
    expect(togglePin(pinned, { ...ben, login: 'BEN', id: '' }).map((person) => person.login)).toEqual(['ada']);
  });
});

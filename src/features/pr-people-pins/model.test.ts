import { describe, expect, it } from 'vitest';
import {
  isUserCheckboxName,
  parsePullRequestUrl,
  togglePin,
  visiblePins,
} from './model';
import type { PinnedPerson } from '../../shared/types';

const ada: PinnedPerson = {
  id: '33',
  login: 'ada',
  name: 'Ada Lovelace',
  avatarUrl: '',
};
const ben: PinnedPerson = {
  id: '22',
  login: 'Ben',
  name: 'Ben Adey',
  avatarUrl: '',
};

describe('parsePullRequestUrl', () => {
  it('reads owner, repository, and number from pull request urls', () => {
    expect(
      parsePullRequestUrl(new URL('https://github.com/acme/widgets/pull/42')),
    ).toEqual({ owner: 'acme', repository: 'widgets', number: 42 });
    expect(
      parsePullRequestUrl(
        new URL('https://github.com/acme/widgets/pull/42/changes'),
      ),
    ).toEqual({ owner: 'acme', repository: 'widgets', number: 42 });
  });

  it('ignores issue pages', () => {
    expect(
      parsePullRequestUrl(new URL('https://github.com/acme/widgets/issues/42')),
    ).toBeNull();
  });
});

describe('pin list', () => {
  it('accepts person checkboxes and rejects team checkboxes', () => {
    expect(isUserCheckboxName('reviewer_user_ids[]')).toBe(true);
    expect(isUserCheckboxName('issue[user_assignee_ids][]')).toBe(true);
    expect(isUserCheckboxName('reviewer_team_ids[]')).toBe(false);
  });

  it('sorts alphabetically and filters by login or name', () => {
    expect(visiblePins([ben, ada], '').map((person) => person.login)).toEqual([
      'ada',
      'Ben',
    ]);
    expect(
      visiblePins([ben, ada], 'love').map((person) => person.login),
    ).toEqual(['ada']);
    expect(visiblePins([ben, ada], 'zzz')).toEqual([]);
  });

  it('toggles a person by id and keeps the list alphabetical', () => {
    const pinned = togglePin([ada], ben);
    expect(pinned.map((person) => person.login)).toEqual(['ada', 'Ben']);
    expect(togglePin(pinned, ada).map((person) => person.id)).toEqual(['22']);
  });
});

import type { PinnedPerson, PullRequestRef } from '../../shared/types';

const USER_CHECKBOX_NAMES = new Set([
  'reviewer_user_ids[]',
  'issue[user_assignee_ids][]',
]);

export function parsePullRequestUrl(url: URL): PullRequestRef | null {
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
  if (!match) {
    return null;
  }

  const [, owner, repository, number] = match;
  if (!owner || !repository || !number) {
    return null;
  }

  return {
    owner: decodeURIComponent(owner),
    repository: decodeURIComponent(repository),
    number: Number(number),
  };
}

export function isUserCheckboxName(name: string): boolean {
  return USER_CHECKBOX_NAMES.has(name);
}

export function sortPins(pins: readonly PinnedPerson[]): PinnedPerson[] {
  return [...pins].sort((left, right) =>
    left.login.localeCompare(right.login, undefined, { sensitivity: 'base' }),
  );
}

export function pinMatchesQuery(person: PinnedPerson, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  return (
    person.login.toLowerCase().includes(needle) ||
    person.name.toLowerCase().includes(needle)
  );
}

export function visiblePins(
  pins: readonly PinnedPerson[],
  query: string,
): PinnedPerson[] {
  return sortPins(pins.filter((person) => pinMatchesQuery(person, query)));
}

export function togglePin(
  pins: readonly PinnedPerson[],
  person: PinnedPerson,
): PinnedPerson[] {
  const exists = pins.some((pin) => pin.id === person.id);
  const next = exists
    ? pins.filter((pin) => pin.id !== person.id)
    : [...pins, person];
  return sortPins(next);
}

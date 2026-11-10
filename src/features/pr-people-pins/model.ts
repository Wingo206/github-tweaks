import type { PinnedPerson, PullRequestRef } from '../../shared/types';

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

/**
 * The numeric user id in a GitHub avatar URL (`/u/<id>`). Apps and bots use
 * other paths, so a missing id also means "not a person".
 */
export function userIdFromAvatar(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.pathname.match(/^\/u\/(\d+)$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function loginKey(login: string): string {
  return login.trim().toLowerCase();
}

export function isPinned(pins: readonly PinnedPerson[], login: string): boolean {
  const key = loginKey(login);
  return pins.some((pin) => loginKey(pin.login) === key);
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

/** Pins or unpins a person by login, keeping the list alphabetical. */
export function togglePin(
  pins: readonly PinnedPerson[],
  person: PinnedPerson,
): PinnedPerson[] {
  const key = loginKey(person.login);
  const next = isPinned(pins, person.login)
    ? pins.filter((pin) => loginKey(pin.login) !== key)
    : [...pins, person];
  return sortPins(next);
}

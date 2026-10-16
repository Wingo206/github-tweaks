import { describe, expect, it } from 'vitest';
import { getPeoplePins, savePeoplePins } from './storage';
import type { PinnedPerson } from '../shared/types';

const ben: PinnedPerson = {
  id: '22',
  login: 'ben',
  name: 'Ben Adey',
  avatarUrl: 'https://avatars.githubusercontent.com/u/22?s=40&v=4',
};
const ada: PinnedPerson = {
  id: '33',
  login: 'ada',
  name: 'Ada Lovelace',
  avatarUrl: '',
};

describe('people pin storage', () => {
  it('stores a per-repository list in alphabetical order', async () => {
    await savePeoplePins('Acme', 'Widgets', [ben, ada]);

    await expect(getPeoplePins('acme', 'widgets')).resolves.toEqual([ada, ben]);
    await expect(getPeoplePins('acme', 'other')).resolves.toEqual([]);
  });

  it('drops teams and unsafe records', async () => {
    await savePeoplePins('acme', 'widgets', [
      ada,
      {
        id: '99',
        login: 'acme/platform',
        name: 'Platform',
        avatarUrl: '',
      },
      {
        id: '5',
        login: 'bad',
        name: 'Bad',
        avatarUrl: 'javascript:alert(1)',
      },
    ]);

    await expect(getPeoplePins('acme', 'widgets')).resolves.toEqual([ada]);
  });
});

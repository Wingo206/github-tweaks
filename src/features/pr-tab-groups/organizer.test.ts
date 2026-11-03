import { describe, expect, it } from 'vitest';
import { NO_GROUP, type TabInfo } from './model';
import { TabGroupOrganizer, type TabGroupsApi } from './organizer';

const PR = 'https://github.com/acme/widgets/pull/42';
const OTHER = 'https://github.com/acme/widgets/pull/43';

type Seed = [url: string, groupId?: number];

/** One window's tab strip, following Chrome's grouping rules. */
class FakeTabStrip implements TabGroupsApi {
  private tabs: TabInfo[];

  constructor(seeds: Seed[], private readonly titles: Record<number, string> = {}) {
    this.tabs = seeds.map(([url, groupId = NO_GROUP], index) => ({
      id: index + 100,
      windowId: 1,
      index,
      groupId,
      pinned: false,
      url,
    }));
  }

  /** `url@group` per tab, in order. */
  layout(): string[] {
    return this.tabs.map((tab) => `${tab.url!.replace(/^https:\/\/github\.com\/acme\/widgets/, '')}@${tab.groupId}`);
  }

  idOf(url: string): number {
    return this.tabs.find((tab) => tab.url === url)!.id;
  }

  async getTab(tabId: number): Promise<TabInfo> {
    const tab = this.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) {
      throw new Error(`No tab ${tabId}`);
    }
    return { ...tab };
  }

  async windowTabs(): Promise<TabInfo[]> {
    return this.tabs.map((tab) => ({ ...tab }));
  }

  async group(tabId: number, groupId: number): Promise<void> {
    const tab = this.take(tabId);
    tab.groupId = groupId;
    const last = this.tabs.findLastIndex((other) => other.groupId === groupId);
    this.tabs.splice(last + 1, 0, tab);
    this.reindex();
  }

  async ungroup(tabId: number): Promise<void> {
    const { groupId } = await this.getTab(tabId);
    const tab = this.take(tabId);
    const last = this.tabs.findLastIndex((other) => other.groupId === groupId);
    tab.groupId = NO_GROUP;
    this.tabs.splice(last === -1 ? tab.index : last + 1, 0, tab);
    this.reindex();
  }

  async move(tabId: number, index: number): Promise<void> {
    const tab = this.take(tabId);
    this.tabs.splice(index, 0, tab);
    const left = this.tabs[index - 1]?.groupId ?? NO_GROUP;
    const right = this.tabs[index + 1]?.groupId ?? NO_GROUP;
    if (left === right) {
      tab.groupId = left;
    } else if (tab.groupId !== left && tab.groupId !== right) {
      tab.groupId = NO_GROUP;
    }
    this.reindex();
  }

  async groupTitle(groupId: number): Promise<string> {
    return this.titles[groupId] ?? '';
  }

  private take(tabId: number): TabInfo {
    const index = this.tabs.findIndex((tab) => tab.id === tabId);
    return this.tabs.splice(index, 1)[0]!;
  }

  private reindex(): void {
    this.tabs.forEach((tab, index) => (tab.index = index));
  }
}

describe('TabGroupOrganizer.autoJoin', () => {
  it('moves the tab beside its pull request inside the existing group', async () => {
    const strip = new FakeTabStrip(
      [[PR, 7], [`${OTHER}`, 7], ['https://github.com/acme/widgets'], [`${PR}/files`]],
      { 7: 'Reviews' },
    );
    const organizer = new TabGroupOrganizer(strip);

    const result = await organizer.autoJoin(strip.idOf(`${PR}/files`), `${PR}/files`);

    expect(result).toEqual({ groupId: 7, groupTitle: 'Reviews', originalIndex: 3 });
    expect(strip.layout()).toEqual(['/pull/42@7', '/pull/42/files@7', '/pull/43@7', '@-1']);
  });

  it('uses the URL from the page, which can be newer than the tab', async () => {
    const strip = new FakeTabStrip([[PR, 7], ['https://github.com/acme/widgets']]);
    const organizer = new TabGroupOrganizer(strip);

    const result = await organizer.autoJoin(strip.idOf('https://github.com/acme/widgets'), `${PR}/checks`);

    expect(result?.groupId).toBe(7);
  });

  it('changes nothing when no group holds the pull request', async () => {
    const strip = new FakeTabStrip([[PR], [`${OTHER}`, 7], [`${PR}/files`]]);
    const before = strip.layout();

    expect(await new TabGroupOrganizer(strip).autoJoin(strip.idOf(`${PR}/files`), `${PR}/files`)).toBeNull();
    expect(strip.layout()).toEqual(before);
  });
});

describe('TabGroupOrganizer.undoJoin', () => {
  it('puts the tab back where it was, ungrouped', async () => {
    const strip = new FakeTabStrip([[PR, 7], ['https://github.com/acme/widgets'], [`${PR}/files`], [`${OTHER}`]]);
    const organizer = new TabGroupOrganizer(strip);
    const tabId = strip.idOf(`${PR}/files`);
    const before = strip.layout();

    const result = await organizer.autoJoin(tabId, `${PR}/files`);
    await organizer.undoJoin(tabId, result!.groupId, result!.originalIndex);

    expect(strip.layout()).toEqual(before);
  });

  it('leaves a tab that has since moved to another group', async () => {
    const strip = new FakeTabStrip([[PR, 8], [`${PR}/files`]]);
    const organizer = new TabGroupOrganizer(strip);

    await organizer.undoJoin(strip.idOf(PR), 7, 1);

    expect(strip.layout()).toEqual(['/pull/42@8', '/pull/42/files@-1']);
  });
});

describe('TabGroupOrganizer.organizeWindow', () => {
  it('fills existing groups and reports what moved', async () => {
    const strip = new FakeTabStrip([
      [PR, 7],
      [`${OTHER}`, 8],
      [`${PR}/files`],
      ['https://github.com/acme/widgets/pull/44'],
      [`${OTHER}/files`],
      [`${PR}/checks`],
    ]);

    const result = await new TabGroupOrganizer(strip).organizeWindow(1);

    expect(result).toEqual({ moved: 3, groups: 2 });
    expect(strip.layout()).toEqual([
      '/pull/42@7',
      '/pull/42/files@7',
      '/pull/42/checks@7',
      '/pull/43@8',
      '/pull/43/files@8',
      '/pull/44@-1',
    ]);
  });
});

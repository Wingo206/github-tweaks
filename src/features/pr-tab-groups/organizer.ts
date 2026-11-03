import type { TabGroupJoinResult, TabGroupOrganizeResult } from '../../shared/types';
import { NO_GROUP, planJoin, planOrganize, type GroupMove, type TabInfo } from './model';

export interface TabGroupsApi {
  getTab(tabId: number): Promise<TabInfo>;
  windowTabs(windowId: number): Promise<TabInfo[]>;
  group(tabId: number, groupId: number): Promise<void>;
  ungroup(tabId: number): Promise<void>;
  move(tabId: number, index: number): Promise<void>;
  groupTitle(groupId: number): Promise<string>;
}

/** Background-side tab grouping. Operations run one at a time. */
export class TabGroupOrganizer {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly api: TabGroupsApi) {}

  /** Joins `tabId`, now showing `url`, to its pull request's existing group. */
  autoJoin(tabId: number, url: string): Promise<TabGroupJoinResult | null> {
    return this.serialize(async () => {
      const tab = { ...(await this.api.getTab(tabId)), url };
      const move = planJoin(tab, await this.api.windowTabs(tab.windowId));
      if (!move) {
        return null;
      }
      await this.apply(move);
      return {
        groupId: move.groupId,
        groupTitle: await this.api.groupTitle(move.groupId),
        originalIndex: tab.index,
      };
    });
  }

  organizeWindow(windowId: number): Promise<TabGroupOrganizeResult> {
    return this.serialize(async () => {
      const moves = planOrganize(await this.api.windowTabs(windowId));
      for (const move of moves) {
        await this.apply(move);
      }
      return {
        moved: moves.length,
        groups: new Set(moves.map((move) => move.groupId)).size,
      };
    });
  }

  /** Reverses an `autoJoin`, unless the tab has since left that group. */
  undoJoin(tabId: number, groupId: number, originalIndex: number): Promise<void> {
    return this.serialize(async () => {
      const tab = await this.api.getTab(tabId);
      if (tab.groupId !== groupId) {
        return;
      }
      await this.api.ungroup(tabId);
      const count = (await this.api.windowTabs(tab.windowId)).length;
      await this.api.move(tabId, Math.min(originalIndex, count - 1));
      // Chrome adds a tab moved inside another group's range to that group.
      if ((await this.api.getTab(tabId)).groupId !== NO_GROUP) {
        await this.api.ungroup(tabId);
      }
    });
  }

  private async apply(move: GroupMove): Promise<void> {
    await this.api.group(move.tabId, move.groupId);
    const [moved, anchor] = await Promise.all([
      this.api.getTab(move.tabId),
      this.api.getTab(move.afterTabId),
    ]);
    if (moved.groupId !== move.groupId || anchor.groupId !== move.groupId) {
      return;
    }
    const index = anchor.index < moved.index ? anchor.index + 1 : anchor.index;
    if (index !== moved.index) {
      await this.api.move(move.tabId, index);
    }
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export function chromeTabGroupsApi(): TabGroupsApi {
  return {
    getTab: async (tabId) => toTabInfo(await browser.tabs.get(tabId)),
    windowTabs: async (windowId) =>
      (await browser.tabs.query({ windowId })).flatMap((tab) =>
        tab.id === undefined ? [] : [toTabInfo(tab)],
      ),
    group: async (tabId, groupId) => {
      await browser.tabs.group({ tabIds: tabId, groupId });
    },
    ungroup: async (tabId) => {
      await browser.tabs.ungroup(tabId);
    },
    move: async (tabId, index) => {
      await browser.tabs.move(tabId, { index });
    },
    groupTitle: async (groupId) => (await browser.tabGroups.get(groupId)).title ?? '',
  };
}

function toTabInfo(tab: Browser.tabs.Tab): TabInfo {
  return {
    id: tab.id ?? -1,
    windowId: tab.windowId,
    index: tab.index,
    groupId: tab.groupId ?? NO_GROUP,
    pinned: tab.pinned,
    url: tab.url || tab.pendingUrl,
  };
}

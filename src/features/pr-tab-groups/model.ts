/** `chrome.tabGroups.TAB_GROUP_ID_NONE` */
export const NO_GROUP = -1;

export interface TabInfo {
  id: number;
  windowId: number;
  index: number;
  groupId: number;
  pinned: boolean;
  url: string | undefined;
}

export interface GroupMove {
  tabId: number;
  groupId: number;
  /** Tab of the same pull request, already in the group, to sit after. */
  afterTabId: number;
}

/**
 * `owner/repo#number`, lowercased, for any page of a pull request on
 * github.com (Conversation, Commits, Checks, Files changed); otherwise null.
 */
export function pullRequestKey(url: string | URL | undefined): string | null {
  if (!url) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return null;
  }
  if (parsed.hostname !== 'github.com') {
    return null;
  }
  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
  if (!match) {
    return null;
  }
  const [, owner, repository, number] = match;
  return `${owner}/${repository}#${Number(number)}`.toLowerCase();
}

/**
 * Where an ungrouped pull request tab belongs: the one group in its window
 * that already holds another page of the same pull request. Never a new
 * group, never a tab the user already grouped, and nothing when tabs of that
 * pull request sit in more than one group.
 */
export function planJoin(tab: TabInfo, windowTabs: readonly TabInfo[]): GroupMove | null {
  if (tab.pinned || tab.groupId !== NO_GROUP) {
    return null;
  }
  const key = pullRequestKey(tab.url);
  if (!key) {
    return null;
  }
  const siblings = windowTabs.filter(
    (other) =>
      other.id !== tab.id &&
      other.windowId === tab.windowId &&
      other.groupId !== NO_GROUP &&
      pullRequestKey(other.url) === key,
  );
  const groupIds = new Set(siblings.map((sibling) => sibling.groupId));
  if (groupIds.size !== 1) {
    return null;
  }
  const last = siblings.reduce((a, b) => (b.index > a.index ? b : a));
  return { tabId: tab.id, groupId: last.groupId, afterTabId: last.id };
}

/**
 * `planJoin` for every tab in a window, in tab-strip order. Several tabs of
 * one pull request line up after each other, keeping their relative order.
 */
export function planOrganize(windowTabs: readonly TabInfo[]): GroupMove[] {
  const anchors = new Map<string, number>();
  const moves: GroupMove[] = [];
  for (const tab of [...windowTabs].sort((a, b) => a.index - b.index)) {
    const move = planJoin(tab, windowTabs);
    if (!move) {
      continue;
    }
    const key = pullRequestKey(tab.url)!;
    moves.push({ ...move, afterTabId: anchors.get(key) ?? move.afterTabId });
    anchors.set(key, tab.id);
  }
  return moves;
}

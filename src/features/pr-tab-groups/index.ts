import { sendBackgroundMessage } from '../../shared/messaging';
import type { TabGroupJoinResult } from '../../shared/types';
import type { Feature, FeatureContext } from '../types';
import { JoinToast } from './dom';
import { pullRequestKey } from './model';
import './styles.css';

const JOINED_KEY = 'ght-tab-groups:joined';

/**
 * Asks the background worker to put this tab into the tab group that already
 * holds its pull request. Each pull request is tried once per page, and after
 * a join (or its Undo) this tab is left alone for that pull request.
 */
export class PrTabGroupsFeature implements Feature {
  readonly id = 'pr-tab-groups';
  private currentKey: string | null = null;
  private toast = new JoinToast(document);
  private stopWaiting: (() => void) | null = null;

  matches({ url }: FeatureContext): boolean {
    return pullRequestKey(url) !== null;
  }

  start({ url }: FeatureContext): void {
    this.sync(url);
  }

  update({ url }: FeatureContext): void {
    this.sync(url);
  }

  stop(): void {
    this.currentKey = null;
    this.stopWaiting?.();
    this.toast.remove();
  }

  private sync(url: URL): void {
    const key = pullRequestKey(url);
    if (!key || key === this.currentKey) {
      return;
    }
    this.currentKey = key;
    if (joinedKeys().includes(key)) {
      return;
    }
    void sendBackgroundMessage<TabGroupJoinResult | null>({
      type: 'tab-groups:auto-join',
      url: url.href,
    })
      .then((result) => {
        if (!result) {
          return;
        }
        rememberJoined(key);
        this.whenVisible(() =>
          this.toast.show(result.groupTitle, () =>
            sendBackgroundMessage<void>({
              type: 'tab-groups:undo',
              groupId: result.groupId,
              originalIndex: result.originalIndex,
            }),
          ),
        );
      })
      .catch((error: unknown) => {
        console.warn('[ght-tab-groups] auto-join failed', error);
      });
  }

  /** Tabs opened in the background show the toast once they come forward. */
  private whenVisible(show: () => void): void {
    this.stopWaiting?.();
    if (document.visibilityState === 'visible') {
      show();
      return;
    }
    const onChange = (): void => {
      if (document.visibilityState === 'visible') {
        this.stopWaiting?.();
        show();
      }
    };
    document.addEventListener('visibilitychange', onChange);
    this.stopWaiting = () => {
      document.removeEventListener('visibilitychange', onChange);
      this.stopWaiting = null;
    };
  }
}

function joinedKeys(): string[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(JOINED_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function rememberJoined(key: string): void {
  try {
    sessionStorage.setItem(JOINED_KEY, JSON.stringify([...joinedKeys(), key]));
  } catch {
    // Storage can be full or blocked; the tab is simply tried again on reload.
  }
}

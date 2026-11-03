import type {
  PageStatus,
  PullRequestChangeSelection,
  PullRequestFilesSnapshot,
  PullRequestRef,
} from '../../shared/types';
import type { Feature, FeatureContext } from '../types';
import { PrSidebarController } from './controller';
import {
  parseChangeSelection,
  parsePullRequestUrl,
  sameChangeSelection,
} from './model';
import './styles.css';

type SnapshotListener = (snapshot: PullRequestFilesSnapshot | null) => void;

export class PrSidebarMetadataFeature implements Feature {
  readonly id = 'pr-sidebar-metadata';
  private controller: PrSidebarController | null = null;
  private snapshot: PullRequestFilesSnapshot | null = null;
  private readonly listeners = new Set<SnapshotListener>();

  matches({ url }: FeatureContext): boolean {
    return url.hostname === 'github.com' && parsePullRequestUrl(url) !== null;
  }

  start({ url }: FeatureContext): void {
    const ref = parsePullRequestUrl(url);
    if (!ref) {
      return;
    }

    this.controller = new PrSidebarController(
      ref,
      parseChangeSelection(url),
      this.publish,
    );
    void this.controller.start();
  }

  update({ url }: FeatureContext): void {
    const ref = parsePullRequestUrl(url);
    const selection = parseChangeSelection(url);
    if (
      !ref ||
      sameView(
        ref,
        selection,
        this.controller?.ref,
        this.controller?.selection,
      )
    ) {
      return;
    }

    this.stop();
    this.controller = new PrSidebarController(ref, selection, this.publish);
    void this.controller.start();
  }

  stop(): void {
    this.controller?.stop();
    this.controller = null;
    this.publish(null);
  }

  /** Calls `listener` now and whenever the displayed files snapshot changes. */
  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private readonly publish = (snapshot: PullRequestFilesSnapshot | null): void => {
    if (snapshot === this.snapshot) {
      return;
    }
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  };

  getStatus(): PageStatus {
    return this.controller?.getStatus() ?? { state: 'idle' };
  }

  retry(): Promise<void> {
    return this.controller?.retry() ?? Promise.resolve();
  }
}

function sameView(
  left: PullRequestRef,
  leftSelection: PullRequestChangeSelection,
  right: PullRequestRef | undefined,
  rightSelection: PullRequestChangeSelection | undefined,
): boolean {
  return (
    !!right &&
    !!rightSelection &&
    left.owner === right.owner &&
    left.repository === right.repository &&
    left.number === right.number &&
    sameChangeSelection(leftSelection, rightSelection)
  );
}

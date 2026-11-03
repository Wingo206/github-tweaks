import { parsePullRequestUrl } from '../pr-sidebar-metadata/model';
import type { Feature, FeatureContext } from '../types';
import { AutoCollapseController, type SnapshotSource } from './controller';

export class PrAutoCollapseViewedFeature implements Feature {
  readonly id = 'pr-auto-collapse-viewed';
  private controller: AutoCollapseController | null = null;

  /** `source` is the sidebar metadata feature, which owns the Viewed states. */
  constructor(private readonly source: SnapshotSource) {}

  matches({ url }: FeatureContext): boolean {
    return url.hostname === 'github.com' && parsePullRequestUrl(url) !== null;
  }

  start(): void {
    this.controller = new AutoCollapseController(this.source);
    this.controller.start();
  }

  stop(): void {
    this.controller?.stop();
    this.controller = null;
  }
}

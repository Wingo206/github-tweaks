import type { Feature, FeatureContext } from '../types';
import { StickyTabsController } from './controller';
import { isPullRequestPage } from './model';
import './styles.css';

export class PrStickyTabsFeature implements Feature {
  readonly id = 'pr-sticky-tabs';
  private controller: StickyTabsController | null = null;

  matches({ url }: FeatureContext): boolean {
    return isPullRequestPage(url);
  }

  start(): void {
    this.controller = new StickyTabsController();
    this.controller.start();
  }

  update(): void {
    this.controller?.sync();
  }

  stop(): void {
    this.controller?.stop();
    this.controller = null;
  }
}

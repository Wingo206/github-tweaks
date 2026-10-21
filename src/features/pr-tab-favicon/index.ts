import type { Feature, FeatureContext } from '../types';
import { PrTabMarker } from './dom';
import { parsePrTab } from './model';

export class PrTabFaviconFeature implements Feature {
  readonly id = 'pr-tab-favicon';
  private marker: PrTabMarker | null = null;

  matches({ url }: FeatureContext): boolean {
    return parsePrTab(url) !== null;
  }

  start({ url }: FeatureContext): void {
    const tab = parsePrTab(url);
    if (!tab) {
      return;
    }
    this.marker = new PrTabMarker(document, tab);
    this.marker.start();
  }

  update({ url }: FeatureContext): void {
    const tab = parsePrTab(url);
    if (tab) {
      this.marker?.setTab(tab);
    }
  }

  stop(): void {
    this.marker?.stop();
    this.marker = null;
  }
}

import type { Feature } from './types';

export class FeatureRunner {
  private activeFeatureIds = new Set<string>();

  constructor(private readonly features: Feature[]) {}

  async sync(url = new URL(window.location.href)): Promise<void> {
    for (const feature of this.features) {
      const shouldRun = feature.matches({ url });
      const isRunning = this.activeFeatureIds.has(feature.id);

      if (shouldRun && !isRunning) {
        await feature.start({ url });
        this.activeFeatureIds.add(feature.id);
      } else if (shouldRun && isRunning) {
        await feature.update?.({ url });
      } else if (!shouldRun && isRunning) {
        feature.stop();
        this.activeFeatureIds.delete(feature.id);
      }
    }
  }

  stop(): void {
    for (const feature of this.features) {
      if (this.activeFeatureIds.has(feature.id)) {
        feature.stop();
      }
    }

    this.activeFeatureIds.clear();
  }
}

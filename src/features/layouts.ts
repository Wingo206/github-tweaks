import type { Feature, FeatureContext } from './types';

/**
 * Runs a feature's separate implementations for GitHub's page layouts
 * together, under the feature's one popup toggle. Each implementation's
 * selectors find nothing on the other layout.
 */
export class LayoutFeatures implements Feature {
  constructor(
    readonly id: string,
    private readonly layouts: readonly Feature[],
  ) {}

  matches(context: FeatureContext): boolean {
    return this.layouts.some((feature) => feature.matches(context));
  }

  async start(context: FeatureContext): Promise<void> {
    for (const feature of this.layouts) {
      await feature.start(context);
    }
  }

  async update(context: FeatureContext): Promise<void> {
    for (const feature of this.layouts) {
      await feature.update?.(context);
    }
  }

  stop(): void {
    for (const feature of this.layouts) {
      feature.stop();
    }
  }
}

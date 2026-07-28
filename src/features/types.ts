export interface FeatureContext {
  url: URL;
}

export interface Feature {
  id: string;
  matches(context: FeatureContext): boolean;
  start(context: FeatureContext): void | Promise<void>;
  update?(context: FeatureContext): void | Promise<void>;
  stop(): void;
}

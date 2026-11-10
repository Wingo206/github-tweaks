import type { Feature, FeatureContext } from '../features/types';
import { startPerfLog, stopPerfLog } from './recorder';

/** The Performance log toggle: records every GitHub page while it is on. */
export class PerfLogFeature implements Feature {
  readonly id = 'perf-log';

  matches({ url }: FeatureContext): boolean {
    return url.hostname === 'github.com';
  }

  start(): void {
    startPerfLog();
  }

  stop(): void {
    stopPerfLog();
  }
}

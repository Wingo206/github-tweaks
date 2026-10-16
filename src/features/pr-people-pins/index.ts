import type { PullRequestRef } from '../../shared/types';
import type { Feature, FeatureContext } from '../types';
import { PeoplePinsController } from './controller';
import { parsePullRequestUrl } from './model';
import './styles.css';

export class PrPeoplePinsFeature implements Feature {
  readonly id = 'pr-people-pins';
  private controller: PeoplePinsController | null = null;

  matches({ url }: FeatureContext): boolean {
    return url.hostname === 'github.com' && parsePullRequestUrl(url) !== null;
  }

  start({ url }: FeatureContext): void {
    const ref = parsePullRequestUrl(url);
    if (!ref) {
      return;
    }

    this.controller = new PeoplePinsController(ref);
    void this.controller.start();
  }

  update({ url }: FeatureContext): void {
    const ref = parsePullRequestUrl(url);
    if (!ref || sameRef(ref, this.controller?.ref)) {
      return;
    }

    this.stop();
    this.controller = new PeoplePinsController(ref);
    void this.controller.start();
  }

  stop(): void {
    this.controller?.stop();
    this.controller = null;
  }
}

function sameRef(
  left: PullRequestRef,
  right: PullRequestRef | undefined,
): boolean {
  return (
    !!right &&
    left.owner === right.owner &&
    left.repository === right.repository &&
    left.number === right.number
  );
}

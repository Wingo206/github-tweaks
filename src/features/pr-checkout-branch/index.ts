import type { Feature, FeatureContext } from '../types';
import { CheckoutBranchController } from './controller';
import { parseRoute, sameRoute } from './model';
import './styles.css';

export class PrCheckoutBranchFeature implements Feature {
  readonly id = 'pr-checkout-branch';
  private controller: CheckoutBranchController | null = null;

  matches({ url }: FeatureContext): boolean {
    return parseRoute(url) !== null;
  }

  start({ url }: FeatureContext): void {
    const route = parseRoute(url);
    if (!route) {
      return;
    }
    this.controller = new CheckoutBranchController(route);
    this.controller.start();
  }

  update({ url }: FeatureContext): void {
    const route = parseRoute(url);
    if (!route || sameRoute(route, this.controller?.route)) {
      return;
    }
    this.stop();
    this.controller = new CheckoutBranchController(route);
    this.controller.start();
  }

  stop(): void {
    this.controller?.stop();
    this.controller = null;
  }
}

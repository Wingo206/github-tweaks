import type { Feature, FeatureContext } from '../types';
import { MermaidFullscreenController } from './controller';
import './styles.css';

export class MermaidFullscreenFeature implements Feature {
  readonly id = 'mermaid-fullscreen';
  private controller: MermaidFullscreenController | null = null;

  matches({ url }: FeatureContext): boolean {
    return url.hostname === 'github.com';
  }

  start(): void {
    this.controller = new MermaidFullscreenController();
    this.controller.start();
  }

  update(): void {
    // Soft navigations keep the same document observer; no restart needed.
  }

  stop(): void {
    this.controller?.stop();
    this.controller = null;
  }
}

import type { Feature, FeatureContext } from '../types';
import { TreeViewportController } from './controller';
import { isPullRequestFilesUrl } from './model';
import './styles.css';

export class PrFileTreeViewportFeature implements Feature {
  readonly id = 'pr-file-tree-viewport';
  private controller: TreeViewportController | null = null;

  matches({ url }: FeatureContext): boolean {
    return isPullRequestFilesUrl(url);
  }

  start(): void {
    this.controller = new TreeViewportController();
    this.controller.start();
  }

  update(): void {
    this.controller?.refresh();
  }

  stop(): void {
    this.controller?.stop();
    this.controller = null;
  }
}

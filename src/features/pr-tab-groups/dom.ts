export const MARKER = 'data-ght-tab-groups';

const SHOW_MS = 8000;
const DONE_MS = 2500;
const FAILED_MS = 6000;

export function describeJoin(groupTitle: string): string {
  return groupTitle
    ? `Added to the “${groupTitle}” tab group`
    : 'Added to this pull request’s tab group';
}

/** Fixed-position notice that this tab joined a group, with Undo. */
export class JoinToast {
  private element: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly doc: Document) {}

  show(groupTitle: string, undo: () => Promise<void>): void {
    this.remove();
    const toast = this.doc.createElement('div');
    toast.className = 'ght-tg-toast';
    toast.setAttribute(MARKER, 'toast');
    toast.setAttribute('role', 'status');

    const text = this.doc.createElement('span');
    text.textContent = describeJoin(groupTitle);

    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'ght-tg-undo';
    button.textContent = 'Undo';
    button.addEventListener('click', () => {
      button.disabled = true;
      clearTimeout(this.timer);
      void undo().then(
        () => this.finish(text, button, 'Removed from the tab group', 'done', DONE_MS),
        (error: unknown) =>
          this.finish(
            text,
            button,
            `Couldn’t undo: ${error instanceof Error ? error.message : 'unknown error'}`,
            'failed',
            FAILED_MS,
          ),
      );
    });

    toast.append(text, button);
    this.doc.body.append(toast);
    this.element = toast;
    this.timer = setTimeout(() => this.remove(), SHOW_MS);
  }

  remove(): void {
    clearTimeout(this.timer);
    this.element?.remove();
    this.element = null;
  }

  private finish(
    text: HTMLElement,
    button: HTMLElement,
    message: string,
    state: 'done' | 'failed',
    duration: number,
  ): void {
    if (!this.element) {
      return;
    }
    text.textContent = message;
    button.remove();
    this.element.dataset.ghtTgState = state;
    this.timer = setTimeout(() => this.remove(), duration);
  }
}

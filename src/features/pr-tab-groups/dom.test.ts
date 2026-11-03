import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeJoin, JoinToast, MARKER } from './dom';

function toast(): HTMLElement | null {
  return document.querySelector(`[${MARKER}="toast"]`);
}

describe('JoinToast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('names the group, or describes an untitled one', () => {
    expect(describeJoin('Reviews')).toBe('Added to the “Reviews” tab group');
    expect(describeJoin('')).toBe('Added to this pull request’s tab group');
  });

  it('shows once and hides on its own', () => {
    const joinToast = new JoinToast(document);
    joinToast.show('Reviews', vi.fn());
    joinToast.show('Reviews', vi.fn());

    expect(document.querySelectorAll(`[${MARKER}="toast"]`)).toHaveLength(1);
    expect(toast()?.getAttribute('role')).toBe('status');
    vi.advanceTimersByTime(8000);
    expect(toast()).toBeNull();
  });

  it('runs Undo and confirms it', async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    new JoinToast(document).show('Reviews', undo);

    toast()!.querySelector('button')!.click();
    await vi.waitFor(() => expect(toast()?.textContent).toBe('Removed from the tab group'));

    expect(undo).toHaveBeenCalledOnce();
    expect(toast()?.querySelector('button')).toBeNull();
    vi.advanceTimersByTime(2500);
    expect(toast()).toBeNull();
  });

  it('reports a failed Undo', async () => {
    new JoinToast(document).show('', vi.fn().mockRejectedValue(new Error('No tab')));

    toast()!.querySelector('button')!.click();
    await vi.waitFor(() => expect(toast()?.textContent).toBe('Couldn’t undo: No tab'));
    expect(toast()?.dataset.ghtTgState).toBe('failed');
  });

  it('removes itself', () => {
    const joinToast = new JoinToast(document);
    joinToast.show('Reviews', vi.fn());
    joinToast.remove();
    expect(toast()).toBeNull();
  });
});

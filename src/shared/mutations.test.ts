import { describe, expect, it } from 'vitest';
import { touches } from './mutations';

function record(changes: () => void): MutationRecord[] {
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  changes();
  const records = observer.takeRecords();
  observer.disconnect();
  return records;
}

describe('touches', () => {
  it('matches changes inside, additions of, and removals of the watched area', () => {
    document.body.innerHTML = '<div class="watched"><span>a</span></div><div class="other"></div>';
    const watched = document.querySelector('.watched')!;

    expect(touches(record(() => watched.firstElementChild!.setAttribute('title', 'x')), '.watched')).toBe(true);
    expect(touches(record(() => (watched.firstElementChild!.firstChild!.textContent = 'b')), '.watched')).toBe(true);
    expect(touches(record(() => document.body.insertAdjacentHTML('beforeend', '<p><i class="watched"></i></p>')), '.watched')).toBe(true);
    expect(touches(record(() => watched.remove()), '.watched')).toBe(true);
  });

  it('ignores changes elsewhere on the page', () => {
    document.body.innerHTML = '<div class="watched"></div><div class="other"></div>';
    expect(
      touches(
        record(() => {
          document.querySelector('.other')!.append(document.createElement('span'));
          document.body.insertAdjacentHTML('beforeend', '<span popover="auto">tip</span>');
        }),
        '.watched',
      ),
    ).toBe(false);
  });
});

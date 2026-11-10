/**
 * Whether any of `records` changed something inside an element matching
 * `selector`, or added or removed such an element.
 *
 * Features watch the whole page, and large pull requests change it often.
 * A feature that re-scans the page on every change keeps the main thread
 * busy, so each one first checks that a change touches the part it uses.
 */
export function touches(records: readonly MutationRecord[], selector: string): boolean {
  for (const record of records) {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (target?.closest(selector)) {
      return true;
    }
    for (const node of record.addedNodes) {
      if (node instanceof Element && (node.matches(selector) || node.querySelector(selector))) {
        return true;
      }
    }
    for (const node of record.removedNodes) {
      if (node instanceof Element && (node.matches(selector) || node.querySelector(selector))) {
        return true;
      }
    }
  }
  return false;
}

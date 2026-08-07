# DevTools capture snippet

The agent customizes `REGIONS` (and optional `RELATED`) from the grill, then
gives the user this script to paste into the **GitHub page** DevTools console
(not the extension worker).

The script copies a JSON packet to the clipboard via `copy()` when available,
and also returns it for inspection.

```js
(() => {
  const REGIONS = {
    // Customize: name → CSS selector for outerHTML capture
    fileTree: '#pr-file-tree',
    // Example related native UI:
    // diffHeader: '[data-diff-header-wrapper]',
  };

  const pickRelated = (root) => {
    // Optional: collect smaller nodes that are not under REGIONS roots.
    // Example: first viewed + first unviewed native Viewed buttons.
    return {};
  };

  const serialize = (el) => {
    if (!el) return null;
    return el.outerHTML;
  };

  const regions = {};
  for (const [name, selector] of Object.entries(REGIONS)) {
    const el = document.querySelector(selector);
    regions[name] = {
      selector,
      found: Boolean(el),
      outerHTML: serialize(el),
    };
  }

  const packet = {
    url: location.href,
    capturedAt: new Date().toISOString(),
    title: document.title,
    regions,
    related: pickRelated(document),
    notes: 'Paste this JSON back into the agent chat (or save as a file).',
  };

  const json = JSON.stringify(packet, null, 2);
  if (typeof copy === 'function') {
    copy(json);
    console.info('GitHub Tweaks capture copied to clipboard.');
  } else {
    console.info('copy() unavailable; use the returned value.');
  }
  return packet;
})();
```

## Agent instructions when customizing

1. Set `REGIONS` to the smallest set of roots that cover the mount point and
   any rows/controls the feature will read or inject into.
2. If the feature syncs with native controls outside that root, implement
   `pickRelated` to grab **one viewed and one unviewed** example (or equivalent
   states), not the entire page.
3. Tell the user to capture **after the page has fully loaded** the relevant UI
   (expand directories, scroll virtualized lists into view if needed).
4. After receiving the packet, sanitize into `tests/fixtures/` before coding
   selectors. Do not commit raw captures that contain private source, repo
   names, tokens, or user content.

## What “good” looks like

- Mount root present (`found: true`) with nested structure intact
- Stable anchors visible: `id`, `role`, `aria-*`, `data-*`, meaningful `href`
- Both states represented when the feature cares about state (e.g. viewed /
  unviewed)
- No need for a full `<html>` document dump

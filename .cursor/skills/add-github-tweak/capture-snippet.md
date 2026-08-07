# DevTools capture snippet

**Default first pass:** the user picks elements in Inspect Element. The agent
does **not** need to invent CSS selectors up front.

Flow:

1. Agent tells the user which logical pieces to select (mount root, one example
   row, related native control in each relevant state, etc.).
2. User selects a node in Elements (`$0`), then runs **Add** in the console.
3. Repeat for each named piece.
4. User runs **Finish** once; paste the JSON back into chat.

Use the GitHub **page** DevTools console, not the extension service worker.

## Add (run once per selected element)

Customize the `name` argument the agent asks for (`mount`, `fileRow`,
`viewedControl`, …).

```js
((name = 'mount') => {
  const el = $0;
  if (!(el instanceof Element)) {
    console.error('Select an element in the Elements panel first ($0).');
    return null;
  }

  const store = (window.__ghtCapture ??= {
    url: location.href,
    title: document.title,
    regions: {},
  });

  const attrs = {};
  for (const attr of el.attributes) {
    attrs[attr.name] = attr.value;
  }

  store.regions[name] = {
    name,
    tagName: el.tagName.toLowerCase(),
    id: el.id || null,
    className: typeof el.className === 'string' ? el.className : null,
    attrs,
    outerHTML: el.outerHTML,
  };

  console.info(`Captured "${name}"`, store.regions[name]);
  return store;
})('mount');
```

## Finish (copy packet)

```js
(() => {
  const store = window.__ghtCapture;
  if (!store || !Object.keys(store.regions || {}).length) {
    console.error('No captures yet. Select an element and run Add first.');
    return null;
  }

  const packet = {
    ...store,
    capturedAt: new Date().toISOString(),
    notes: 'Paste this JSON back into the agent chat (or save as a file).',
  };

  const json = JSON.stringify(packet, null, 2);
  if (typeof copy === 'function') {
    copy(json);
    console.info('GitHub Tweaks capture copied to clipboard.');
  } else {
    console.info('copy() unavailable; use the returned value.');
  }

  delete window.__ghtCapture;
  return packet;
})();
```

## Optional: selector-based recapture

Only after the first packet reveals stable anchors (or the user already knows
them), the agent may emit a follow-up snippet that `querySelector`s named
roots for a tighter dump. Do not start here when the surface is unfamiliar.

## Agent instructions

1. From the grill, list **named pieces** the user should Inspect — not guessed
   CSS selectors. Example: “select the file-tree container”, “one file row”,
   “a native Viewed control that is checked”, “one that is unchecked”.
2. Hand them Add + Finish. Ask them to run Add once per piece with the agreed
   `name`.
3. Capture after the relevant UI is loaded (expand dirs, reveal virtualized
   rows if needed).
4. From the packet, prefer stable anchors in this order: `id` → ARIA/role/label
   → stable `data-*` → stable class **prefix**. Record candidate selectors in
   the fixture/adapter; never rely on hash suffixes.
5. Sanitize into `tests/fixtures/` before coding. Do not commit raw captures
   with private source, repo names, tokens, or user content.

## What “good” looks like

- Mount root and at least one inject target / example row captured
- Related native controls included when the feature syncs with them
- Both states represented when state matters (e.g. viewed / unviewed)
- Attrs/`id` present so the agent can choose selectors without a full page dump

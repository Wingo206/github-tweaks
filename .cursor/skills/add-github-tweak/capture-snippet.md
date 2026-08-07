# HTML dump capture

**Prefer** the [DOM Dump Picker](../dom-dump-picker/SKILL.md) agent loop
(`pnpm dump-receiver` + unpacked `devtools/dom-picker/extension`). Use this
manual path only when the picker/receiver is unavailable.

The agent does **not** invent CSS selectors up front.

Use the GitHub **page** top frame, not the extension service worker and not a
cross-origin iframe (e.g. Mermaid `viewscreen`).

## Manual flow

1. Agent names what the dump must include (controls + mount surface + any
   related native UI), and which UI states matter (closed/open, checked/unchecked).
2. User opens Elements on the **top** `github.com` frame.
3. User selects a node that wraps everything needed, walking **up** until the
   relevant controls and surfaces are inside it.
4. User copies that node’s HTML into a file in the repo (or pastes into chat):
   - Right-click → **Copy** → **Copy outerHTML**, or
   - With `$0` selected, run the one-liner below.
5. Repeat for each distinct UI state when state matters.
6. Agent derives anchors from the dump(s), then sanitizes into `tests/fixtures/`.

## One-liner (optional)

Select the ancestor so `$0` is it, then:

```js
copy($0.outerHTML);
```

Paste/save as something like `dump.html`. Metadata is optional; raw HTML is
enough. If useful, wrap once:

```js
copy({
  url: location.href,
  tagName: $0.tagName,
  id: $0.id || null,
  className: typeof $0.className === 'string' ? $0.className : null,
  attrs: Object.fromEntries([...$0.attributes].map((a) => [a.name, a.value])),
  outerHTML: $0.outerHTML,
});
```

## Layout / CSS fights

When sizing, centering, or overlays look wrong, also dump the broken open state
and paste **Computed** values for the suspect node: `width`, `max-width`,
`height`, `max-height`, `position`, `left`, `top`, `transform`. A screenshot of
Computed is fine. With the picker, enable **Include key computed styles**.

## Agent instructions

1. Prefer starting the picker receiver and asking the user to pick (see
   [dom-dump-picker](../dom-dump-picker/SKILL.md)).
2. From the grill, describe inclusion criteria in plain language — not guessed
   CSS selectors.
3. Capture after the relevant UI is loaded (expand dirs, open dialogs, reveal
   virtualized rows if needed).
4. From the dump, prefer stable anchors in this order: `id` → ARIA/role/label →
   stable `data-*` → stable class **prefix**. Never rely on hash suffixes.
5. Sanitize into `tests/fixtures/` before coding. Do not commit raw dumps with
   private source, repo names, tokens, or user content.

## What “good” looks like

- One generous ancestor that includes the mount root and inject/hijack targets
- Separate dumps for distinct states when state matters (e.g. dialog closed vs
  open)
- Screenshot when placement is non-obvious
- Computed styles when the bug is layout/CSS, not missing markup
- Enough structure for the agent to choose selectors without a full-page dump

---
name: dom-dump-picker
description: >-
  Capture live page HTML via the DOM Dump Picker dev extension and local
  receiver. Use when needing an HTML dump, DOM fixture, selector anchors, or
  layout debugging for GitHub Tweaks (or any page), instead of asking the user
  to Copy outerHTML manually.
---

# DOM Dump Picker

Preferred capture path for this repo. Manual outerHTML is the fallback only if
the picker/receiver is unavailable.

Code lives in `devtools/dom-picker/` (separate unpacked extension + Node
receiver). See that folder’s README for one-time Chrome load steps.

## Agent loop

```text
1. Ensure receiver is running (pnpm dump-receiver)
2. Tell user what to include + which UI state
3. Ask user to Start picking → wheel expand → click
4. Read dumps/latest.html (+ latest.json)
5. Accept or ask for another pick / other state / computed styles
6. Sanitize into tests/fixtures/; delete or ignore raw dumps
```

### 1. Start receiver

If nothing is listening on `17373`:

```bash
pnpm dump-receiver
```

Confirm with `curl -s http://127.0.0.1:17373/health`. Leave it running in the
background while capturing.

Dumps directory: `devtools/dom-picker/dumps/`

- `latest.html` — raw `outerHTML` (read this first)
- `latest.json` — metadata, attrs, optional `computed`
- `<timestamp>.*` — archives of each capture

### 2. Instruct the user

Describe inclusion in plain language (not guessed selectors), e.g. “a container
that includes the Mermaid iframe and the fullscreen control.”

Tell them:

1. Open the page in the **top** frame (not inside a cross-origin iframe).
2. Put the UI in the needed state (dialog open, row expanded, etc.).
3. Extension popup → **Start picking**.
4. Hover · **wheel** until the orange box covers everything needed · **click**.
5. For layout bugs, enable **Include key computed styles** before picking.

### 3. Read and decide

After they confirm capture:

1. `Read` `devtools/dom-picker/dumps/latest.html` (and `.json` if useful).
2. Check that mount root + controls/states are present.
3. If too small / wrong state / missing pieces: ask for another pick (do not
   invent selectors yet).
4. When enough: sanitize into `tests/fixtures/`, derive anchors
   (`id` → ARIA → stable `data-*` → class prefix).

### 4. Multi-state

Repeat the loop per state (`closed` / `open`, viewed / unviewed). Each click
overwrites `latest.*` and also writes a timestamped archive — read `latest`
promptly or note the archive id from the receiver log / JSON `id` field.

## Fallback

If the extension is not loaded or the receiver cannot run, use the manual flow
in [../add-github-tweak/capture-snippet.md](../add-github-tweak/capture-snippet.md).

## Anti-patterns

- Asking for Copy outerHTML when the picker is available
- Coding selectors before a dump exists (unless reusing a fixture)
- Committing raw `dumps/` files
- Capturing inside cross-origin iframes and expecting SVG/HTML from inside them

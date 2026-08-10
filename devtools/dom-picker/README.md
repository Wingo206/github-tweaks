# DOM Dump Picker

Unpacked Chrome extension + local receiver for agent-driven HTML dumps.
Keep this separate from GitHub Tweaks so the product extension stays clean.

## Pieces

| Path | Role |
|------|------|
| `extension/` | Load unpacked in Chrome |
| `receiver/server.mjs` | `POST /dump` → writes `dumps/latest.html` |
| `dumps/` | Disposable captures (gitignored) |

## One-time setup

1. In Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → select
   `devtools/dom-picker/extension`.
2. Pin the extension.

## Capture loop (agent + you)

1. Agent starts the receiver:

```bash
pnpm dump-receiver
```

2. You open the target page (top frame), click the extension → **Start picking**.
3. Hover (orange outline) · **wheel** to expand/shrink ancestor · **click** to
   send · **Esc** to cancel.
4. Agent reads `devtools/dom-picker/dumps/latest.html` (and `.json` for attrs /
   optional computed styles) and asks for another pick if needed.

Optional: check **Include key computed styles** before picking (layout or typography matching).

## Receiver API

- `GET /health`
- `GET /latest` — last packet JSON
- `POST /dump` — body JSON with at least `outerHTML`

Default: `http://127.0.0.1:17373` (`DOM_DUMP_PORT` to override).

## Notes

- Top-frame only (content script cannot read cross-origin iframe internals).
- Do not commit raw dumps; sanitize into `tests/fixtures/` for the product.
- Safe to extract this folder into its own repo later.

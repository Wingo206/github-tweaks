---
name: add-github-tweak
description: >-
  Add a new feature to the GitHub Tweaks Chrome extension. Use when creating a
  new GitHub UI tweak, injecting into GitHub pages, capturing DOM fixtures, or
  scaffolding a feature under src/features/.
---

# Add a GitHub Tweaks feature

Canonical example: `src/features/pr-sidebar-metadata/`.

Follow this order. Do not skip ahead to DOM selectors or scaffolding until the
gates below are satisfied.

## Workflow checklist

```text
Feature progress:
- [ ] 1. Brief grill (UX, data source, injection intent, permissions tradeoff)
- [ ] 2. Emit DevTools capture snippet; wait for packet
- [ ] 3. Sanitize → fixture → stable anchors
- [ ] 4. Scaffold feature directory + register
- [ ] 5. Implement model / dom / controller
- [ ] 6. Tests + docs
- [ ] 7. pnpm check
```

## 1. Brief grill

Interview the user (one decision at a time unless they ask to batch). Cover at
least:

- **UX:** what appears, where, interactive vs read-only, empty/error states
- **Route:** which `github.com` URLs `matches` should accept
- **Data source:** prefer **GitHub GraphQL via the background worker** for
  authoritative data; use the DOM for injection anchors and native-control sync.
  DOM-only is fine for rearranging already-visible UI.
- **Injection intent:** append / prepend / wrap / replace — and the mount root
- **Permissions tradeoff:** if the feature wants new host permissions, API
  scopes, or extension capabilities, surface that explicitly. Present staying
  within current permissions vs expanding them as options (with a
  recommendation and what each costs: install prompt, review surface, token
  scope, attack footprint). Do not silently work around a needed permission,
  and do not add one without this decision.

Token storage and GraphQL stay in the background worker. Never expose the PAT
to content scripts or page JS.

## 2. Capture packet (hard gate)

**Do not write `dom.ts`, selectors, or injection code until a capture packet is
returned — or the user explicitly reuses an existing fixture.**

First pass is **user-driven Inspect Element**, not agent-guessed selectors:

1. From the grill, list the **named pieces** to capture (mount root, example
   row, related native controls / states).
2. Give the user the Add / Finish snippets from
   [capture-snippet.md](capture-snippet.md): they select each node in Elements
   (`$0`), run Add with that name, then Finish to clipboard.
3. Wait for the pasted JSON (or saved files). Derive candidate selectors from
   captured `id` / attrs / structure.
4. Optionally emit a tighter selector-based recapture once anchors are known.
5. Require a screenshot of intended placement when layout matters.

Minimum packet:

- target region `outerHTML` (mount root)
- related native UI if syncing with existing controls
- screenshot when placement is non-obvious
- short injection-intent note from the grill

## 3. Fixtures and selectors

From the capture:

1. Sanitize: strip repo names, code, comments, user data, generated class
   hashes, React IDs, unrelated controls.
2. Keep structural anchors only: IDs, ARIA roles/state/labels, stable `data-*`,
   meaningful links.
3. Write the smallest fixture under `tests/fixtures/` that reproduces the
   integration contract.
4. Prefer selectors in this order: ID → ARIA/role/label → stable `data-*` →
   stable class **prefix**. Never use hash suffixes, React IDs, or `nth-child`.

Injection must be **idempotent** (`data-ght-*` marker), observer-safe, keyboard-
accessible, and fully removable in `stop`.

## 4. Feature layout

```text
src/features/<feature-id>/
  index.ts              # Feature: matches / start / update / stop
  model.ts              # pure domain logic
  model.test.ts
  dom.ts                # selectors, render, cleanup
  dom.test.ts           # against sanitized fixtures
  controller.ts         # optional: observers, messaging, orchestration
  controller.test.ts    # if controller exists
  styles.css            # feature-scoped injected styles (import from index.ts)
tests/fixtures/<...>.html
```

- `<feature-id>` is kebab-case and matches `Feature.id`.
- Skip `controller` only for pure presentational tweaks with no async/API.
- Register in `entrypoints/github.content.ts` via `FeatureRunner`.
- Shared API/GraphQL/cache belongs in `src/github/` and message types in
  `src/shared/types.ts` — not buried as one-off fetch logic in the feature
  unless truly feature-private and non-reusable.
- Styles live in the feature as `styles.css`, imported from `index.ts`, using
  `ght-<short>-*` classes and `data-ght-*` markers.

## 5. Implement

Typical order after fixtures exist:

1. `model.ts` + unit tests
2. `dom.ts` + fixture tests (render, idempotency, cleanup)
3. `controller.ts` if needed (cache/fresh load, observers, optimistic updates)
4. `index.ts` lifecycle wiring
5. Background message types/handlers only when the feature needs API/storage

Soft navigation: `update` must handle same-feature URL changes (e.g. different
PR) without leaking observers or duplicate UI.

## 6. Tests and docs

| Kind | When |
|------|------|
| Unit (`model` / controller logic) | Always when non-trivial logic exists |
| Fixture DOM tests | **Always** for injected UI |
| Playwright e2e | When background messaging, GraphQL, or cross-context behavior is involved |

Update:

- `README.md` — mention the new capability briefly
- `DEVELOPMENT.md` — only if architecture/fixture conventions changed

## 7. Verify

Run `pnpm check` before calling the feature done.

## Anti-patterns

- Inventing CSS selectors before any Inspect/`$0` capture (or existing fixture)
- Depending on GitHub CSS-module hash class names
- Putting the PAT or raw `fetch` to `api.github.com` in a content feature
- Non-idempotent injection (duplicate nodes on re-render)
- Leaving observers/listeners attached after `stop`
- Adding or avoiding permissions without an explicit grill decision

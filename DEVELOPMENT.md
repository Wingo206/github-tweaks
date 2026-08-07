# Development

GitHub Tweaks is a WXT Manifest V3 extension written in TypeScript. Injected
features use vanilla DOM APIs so they remain small and can integrate with
GitHub's existing semantics and theme.

## Prerequisites

- Node.js 20 or newer
- pnpm 10 or newer
- Chrome

Install dependencies and generate WXT's declarations:

```sh
pnpm install
pnpm prepare
```

## Commands

```sh
pnpm dev          # WXT development mode
pnpm build        # production Chrome MV3 build
pnpm zip          # distributable extension archive
pnpm typecheck    # TypeScript checks
pnpm test         # Vitest unit and DOM fixture tests
pnpm test:watch   # Vitest watch mode
pnpm test:e2e     # build and run the mocked Chromium extension flow
pnpm check        # all checks and a final production build
```

The unpacked production extension is written to `.output/chrome-mv3`.

## Local extension workflow

1. Run `pnpm dev`.
2. Open `chrome://extensions` and enable Developer mode.
3. Load WXT's unpacked Chrome output shown in the terminal.
4. Pin the toolbar action and configure a fine-grained PAT in its popup.
5. Open a GitHub PR changed-files page.

WXT reloads the extension as files change. Reload the GitHub tab if a content
script update is not reflected after an extension reload.

## Repository structure

```text
entrypoints/
  background.ts             token-owning API and storage boundary
  github.content.ts         feature runner and GitHub navigation handling
  popup/                    token setup and current-page status
src/
  features/
    types.ts                shared feature lifecycle
    runner.ts               route-aware feature activation
    pr-sidebar-metadata/    model, DOM adapter, controller, and unit tests
  github/                   GraphQL, pull request API, cache, and unit tests
  shared/                   message and domain types
  styles/                   namespaced injected styles
tests/
  setup.ts                  shared Vitest browser and DOM setup
  fixtures/                 minimal sanitized GitHub DOM captures
  e2e/                      unpacked-extension Chromium flow
```

## Architecture

The GitHub page, content script, and background worker are separate trust and
execution contexts:

1. The content feature parses the current PR route and asks the background
   worker for cached metadata.
2. Cached metadata renders immediately when available.
3. The background worker reads the PAT, paginates GitHub GraphQL, stores a
   fresh snapshot, and returns it.
4. The content controller reconciles the snapshot against the current React
   file tree.
5. Sidebar Viewed changes are optimistic. The background worker performs the
   mutation; failures roll back to the last confirmed state.
6. Native GitHub Viewed changes update the same in-memory model and trigger a
   delayed re-fetch without issuing a duplicate mutation.

The token must remain in the background/storage layer. Do not return it from a
message or import token storage into a content feature.

### Adding a feature

Use the project skill [`.cursor/skills/add-github-tweak/`](.cursor/skills/add-github-tweak/)
when starting a new tweak. It defines the grill → DevTools capture → fixture →
scaffold → test workflow, including a console snippet template for HTML dumps.

Canonical layout (see `src/features/pr-sidebar-metadata/`):

```text
src/features/<feature-id>/
  index.ts     # Feature lifecycle
  model.ts     # pure logic
  dom.ts       # selectors and injection
  controller.ts  # optional orchestration / messaging
```

### Feature lifecycle

Each tweak implements `Feature` from `src/features/types.ts`:

- `matches` decides whether the current URL is supported.
- `start` installs observers/listeners and begins work.
- `update` handles matching soft navigation, including a different PR.
- `stop` removes observers, listeners, and injected UI.

Register future features in `entrypoints/github.content.ts`. Keep state and DOM
logic inside the feature directory. Request new manifest permissions only when
the feature cannot work without them.

### Background messages

Cross-context operations are discriminated unions in `src/shared/types.ts`.
Content and popup code call `sendBackgroundMessage`; the background entrypoint
validates the request, owns side effects, and returns a success/error envelope.
Add request and response types before adding a handler.

### DOM integration rules

GitHub's current pull request UI is React-based and many classes contain build
hashes. DOM adapters must:

- prefer IDs, ARIA roles/state, labels, links, and stable `data-*` attributes
- use stable class prefixes only when there is no semantic alternative
- never depend on generated hash suffixes, React IDs, or `nth-child`
- make injection idempotent with a namespaced marker
- disconnect or filter observers around extension-owned mutations
- clean up everything in `stop`
- preserve keyboard access and accessible names

The current tree root is `#pr-file-tree`; file rows map their full path from
the tree item's `id`. Main diff paths come from `data-file-path`, while native
Viewed state comes from a toggle button's `aria-pressed`.

## Testing

Vitest covers pure model logic, GraphQL pagination and mutation selection,
storage/cache behavior through the controller, optimistic rollback, native
Viewed synchronization, and rendering against sanitized markup.

The Playwright test builds and loads the real unpacked extension. It fulfills a
GitHub fixture page and GraphQL calls locally, then verifies metadata rendering
and a Viewed mutation without requiring credentials.

Install the browser once if needed:

```sh
pnpm exec playwright install chromium
```

### Manual private-PR checklist

Before releasing a change:

- open a private PR and verify every file receives counts immediately
- check a PR with more than 100 files to exercise pagination
- toggle Viewed from the sidebar and from GitHub's native control
- confirm folder line counts decrease as descendant files are viewed
- force a mutation failure and confirm optimistic rollback and local feedback
- filter files and confirm directory totals still cover all descendants
- inspect collapsed and expanded directories
- inspect a zero/zero or binary file for the muted dash
- navigate between PR tabs and between PRs without a full reload
- check light and dark GitHub themes
- remove the PAT and confirm the compact setup/retry banner

## Maintaining GitHub DOM fixtures

When GitHub changes the UI:

1. In DevTools, copy the outer HTML for `#pr-file-tree`.
2. Copy representative `data-diff-header-wrapper` elements for one viewed and
   one unviewed file.
3. Remove repository names, code, comments, generated class hashes, unrelated
   controls, and React-generated IDs.
4. Keep only structural anchors used by the adapter: tree roles/levels,
   full-path IDs, diff links, `data-file-path`, and Viewed ARIA state.
5. Update `tests/fixtures` and run `pnpm test`.
6. If selectors changed, update the DOM adapter and fixture together, then run
   `pnpm check`.

Fixtures must not contain private source, repository names, user data, tokens,
or comments. A fixture should be the smallest markup that reproduces the
integration contract.

## Debugging

- **Content script:** open DevTools on the GitHub tab and inspect the page
  console and injected `.ght-pr-*` elements.
- **Background worker:** open `chrome://extensions`, find GitHub Tweaks, and
  inspect its service worker.
- **Popup:** right-click the toolbar popup and choose Inspect.
- **GraphQL:** inspect background-worker network requests. Never log the
  Authorization header or token.
- **Selector breakage:** compare live markup with `tests/fixtures`, focusing on
  semantic anchors before changing selectors.

Production artifacts are generated files and should not be committed.

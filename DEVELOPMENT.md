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
pnpm companion:build    # bundle the Cursor companion to companion/out/
pnpm companion:install  # build, package a .vsix, and install it into Cursor
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
  popup/                    feature toggles, token setup, current-page status
src/
  features/
    types.ts                shared feature lifecycle
    runner.ts               route-aware feature activation
    registry.ts             feature ids, popup labels, default on/off
    flags.ts                persisted on/off toggles (read at page load)
    <feature-id>/           model, DOM, controller, styles.css, tests
  github/                   GraphQL, pull request API, cache, and unit tests
  companion/                background-worker client for the Cursor companion
  shared/                   message and domain types
companion/                  Cursor extension and local server (see below)
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
when starting a new tweak. It defines the grill → HTML dump → fixture →
scaffold → test workflow. Prefer the [DOM Dump Picker](devtools/dom-picker/)
(`pnpm dump-receiver` + unpacked extension); manual outerHTML is documented in
`capture-snippet.md` as a fallback.

Canonical layout (see `src/features/pr-sidebar-metadata/`):

```text
src/features/<feature-id>/
  index.ts       # Feature lifecycle (imports ./styles.css)
  model.ts       # pure logic
  dom.ts         # selectors and injection
  controller.ts  # optional orchestration / messaging
  styles.css     # feature-scoped injected styles
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

Features do not import each other. When one feature needs another's page
state, the owner publishes it on the DOM and the reader observes it. Shared
names live in `src/shared/pageSignals.ts`; for example, Mermaid fullscreen
sets `MERMAID_OPEN_CLASS` on `<html>` while its viewer is open, and pull
request tab icons switch to the diagram badge while it is there. Either
feature keeps working when the other is turned off.

### Background messages

Cross-context operations are discriminated unions in `src/shared/types.ts`.
Content and popup code call `sendBackgroundMessage`; the background entrypoint
validates the request, owns side effects, and returns a success/error envelope.
Add request and response types before adding a handler.

### Cursor companion

Open in Cursor has three parts. The design is in
[`docs/plans/open-in-cursor.md`](docs/plans/open-in-cursor.md).

```text
companion/
  package.json          Cursor extension manifest (not a pnpm workspace package)
  src/protocol.ts       HTTP and window-socket message types (shared with the browser)
  src/extension/        runs in every WSL window: git state, focus, opening files
  src/server/           one Node process: window registry, ranking, launches,
                        PowerShell focus helper, browser HTTP API
  scripts/              esbuild bundle and .vsix install
```

- The browser background worker resolves what was clicked into
  `repo/path/line/ref` and calls `POST /open` on `127.0.0.1:<port>` with the
  pairing token.
- The server ranks connected windows (repo, then branch, then file exists, then
  most recent focus), tells the chosen window to open the file over a Unix
  socket, and raises it with `SetForegroundWindow` through a long-lived
  `powershell.exe` helper.
- The Cursor extension spawns the server when no socket answers. The server
  exits 10 minutes after the last window disconnects, and restarts when a newer
  extension version connects.

Server state lives in `~/.config/github-tweaks-companion/` (`token`,
`clones.json`, `server.log`). After changing companion code, run
`pnpm companion:install` and reload each Cursor window; the first reloaded
window restarts the server with the new version. **GitHub Tweaks: Show
companion status** prints the server version, window count, and this window's
folders, branches, and remotes.

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
and a Viewed mutation without requiring credentials. The Open in Cursor flow
runs against a fake companion HTTP server.

Companion tests run in Vitest's Node environment (`companion/**/*.test.ts`).
The server integration test bundles the server, spawns it on a temporary socket
and port with fake windows, and stubs the focus helper with `--no-focus`.

### Manual Open in Cursor checklist

- three clones of one repository on different branches, with the PR head
  branch checked out in one: the button opens that clone
- click while another Cursor window is focused; the target comes to the front
- target window minimized
- repository not open in any window (the clone launches, then the file opens)
- no Cursor running (the browser uses its cached launch URL)
- wrong pairing token (popup shows "Token rejected")
- server killed mid-session (windows respawn it)
- companion update while windows are open

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

1. Prefer the DOM Dump Picker (`.cursor/skills/dom-dump-picker/`): start
   `pnpm dump-receiver`, pick a generous ancestor on the top frame, then read
   `devtools/dom-picker/dumps/latest.html`. Manual Copy outerHTML is fine too.
2. For stateful UI, dump each relevant state (e.g. viewed and unviewed rows,
   dialog closed and open). For layout bugs, include computed styles.
3. Remove repository names, code, comments, generated class hashes, unrelated
   controls, and React-generated IDs.
4. Keep only structural anchors used by the adapter (IDs, ARIA, stable
   `data-*`, stable class prefixes).
5. Update `tests/fixtures` and run `pnpm test`. Delete disposable dumps.
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

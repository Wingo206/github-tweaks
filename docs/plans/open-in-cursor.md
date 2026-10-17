# Open in Cursor

Open the file and line behind a GitHub view in the right local Cursor window,
in the right clone, with that window brought to the front.

## Goals

- One click from GitHub opens `path:line:column` in Cursor inside the user's
  real workspace, not as a loose file.
- When the same repository is open in several clones, the clone on the
  matching branch wins; otherwise the most recently focused clone wins.
- The chosen Cursor window comes to the front on Windows.
- No separate install step: the Cursor extension starts everything it needs.

## Non-goals

- Selecting ranges, opening diffs, or checking out a specific commit.
- Correcting line drift for outdated comments or left-side (deleted) lines.
  These open the recorded line number in the current file.
- Non-WSL Cursor windows. All participating windows are WSL windows.

## Environment facts this design relies on

Verified during the design spikes:

- Cursor's built-in `cursor://file/...` and `cursor://vscode-remote/...` links
  always open a new window for WSL paths, even when a window already has that
  folder open. They are only useful for launching a window.
- An extension can open a file in its own window (`showTextDocument`), but that
  does not bring the window to the front. The `cursor` CLI through the window's
  own IPC socket behaves the same.
- Windows raises a specific Cursor window when a PowerShell helper calls Win32
  `SetForegroundWindow` (with the Alt-key unlock) from WSL. Window titles look
  like `file - folder [WSL: ubuntu] - Cursor`; the WSL authority is lowercase.

## Architecture

Three parts with one job each:

```text
GitHub page                 WSL                                  Windows
┌──────────────────┐  HTTP  ┌────────────────────┐  Unix socket  ┌──────────────────┐
│ Browser extension│ ─────▶ │ Companion server   │ ◀───────────▶ │ Cursor extension │ x N windows
│ (content + bg)   │        │ (one Node process) │               │ (one per window) │
└──────────────────┘        └─────────┬──────────┘               └──────────────────┘
                                      │ stdin/stdout
                                      ▼
                            powershell.exe helper (Win32 window focus)
```

- **Browser extension:** buttons on GitHub. Content scripts describe *what was
  clicked*; the background worker resolves that into repo, path, line, and ref
  and calls the server. Never knows local paths.
- **Companion server:** standalone Node process in WSL. Knows every connected
  Cursor window, picks the target, relays the open request, and owns Windows
  focus through a long-lived PowerShell helper.
- **Cursor extension:** runs in every WSL window. Reports the window's
  repositories, branches, and focus changes, and opens files when told to.

## Names

| Thing | Value |
|---|---|
| Browser feature id | `open-in-cursor` |
| Cursor extension id | `local.github-tweaks-companion` (publisher `local`, name `github-tweaks-companion`) |
| Cursor extension display name | GitHub Tweaks Companion |
| Command: copy token | `githubTweaksCompanion.copyPairingToken` — "GitHub Tweaks: Copy pairing token" |
| Command: status | `githubTweaksCompanion.showStatus` — "GitHub Tweaks: Show companion status" |
| Setting: port | `githubTweaksCompanion.port`, number, default `17380` |
| Window socket | `$XDG_RUNTIME_DIR/github-tweaks-companion.sock`, else `os.tmpdir()/github-tweaks-companion-<uid>.sock` |
| Config directory | `~/.config/github-tweaks-companion/` (`token`, `clones.json`) |
| Injected marker | `data-ght-open-in-cursor` |
| CSS class prefix | `ght-oic-` |

## Repository layout

```text
companion/                      Cursor extension + server
  package.json                  extension manifest only (not a pnpm workspace package)
  tsconfig.json                 Node + VS Code types
  src/
    protocol.ts                 HTTP and window-socket message types
    extension/
      extension.ts              activate: ensure server, connect, register, commands
      windowState.ts            folders, remotes, branches via vscode.git API
      openFile.ts               open path:line:column
    server/
      main.ts                   entry: args, single-instance lock, socket + HTTP, idle shutdown
      registry.ts               connected windows, focus handles, remembered clones
      ranking.ts                pure target selection
      launches.ts               queued requests and launch de-duplication
      focus.ts                  persistent PowerShell helper
      http.ts                   browser-facing endpoints and auth
      config.ts                 token and clones.json persistence
  scripts/
    build.mjs                   esbuild → companion/out/{extension,server}.js
    install.mjs                 vsce package + cursor --install-extension
src/features/open-in-cursor/    browser feature (standard feature layout)
src/companion/client.ts         background-worker client for the server
src/github/pullRequestContext.ts  head branch + review threads query
```

`companion/src/protocol.ts` is the single source of truth for message shapes.
The browser extension imports its HTTP types by relative path.

### Tooling

- Root dev dependencies: `esbuild`, `@vscode/vsce`, `@types/vscode`,
  `@types/node`.
- Root scripts:
  - `companion:build` → `node companion/scripts/build.mjs`
  - `companion:install` → build, then `node companion/scripts/install.mjs`
  - `typecheck` → `tsc --noEmit && tsc --noEmit -p companion`
- `vitest.config.ts` includes `companion/**/*.test.ts` (Node environment for
  those files).
- `companion/out/` and `*.vsix` are gitignored.

## Companion server

### Startup and lifecycle

- Started as `node companion/out/server.js --port <n> --version <v>` using the
  extension host's `process.execPath` (the Node bundled with the Cursor WSL
  server). No system Node required. The spawning window passes its configured
  port.
- **Single-instance lock:** the window socket. On startup, try to connect; if
  a live server answers, exit 0. If the connect is refused, unlink the stale
  socket file and bind.
- **Browser channel:** HTTP on `127.0.0.1:<port>`. WSL2 localhost forwarding
  exposes it to the Windows browser. If the port is in use, log and exit 1.
- Spawned detached (`detached: true`, `stdio: 'ignore'`, `unref()`), not tied to
  any window.
- **Idle shutdown:** exits 10 minutes after the last window disconnects.
- **Version handshake:** on `hello`, if the window's version is newer than the
  server's (semver), reply `restart` and exit; the window spawns the new
  server. Equal or older window versions continue normally.

### Window protocol

Newline-delimited JSON over the Unix socket.

Window → server:

```ts
type WindowMessage =
  | { type: 'hello'; windowId: string; version: string }
  | { type: 'state'; folders: FolderState[]; focused: boolean }
  | { type: 'opened'; requestId: string; ok: true }
  | { type: 'opened'; requestId: string; ok: false; error: string };

interface FolderState {
  path: string;                  // absolute WSL path of the git root
  remotes: string[];             // normalized "github.com/owner/repo", lowercase
  branch: string | null;         // checked-out local branch
  upstreamBranch: string | null; // tracked remote branch name without the remote prefix
}
```

Server → window:

```ts
type ServerMessage =
  | { type: 'restart' }
  | { type: 'open'; requestId: string; path: string; line: number; column: number };
```

- `windowId` is `<process.pid>-<8 random hex chars>`.
- Windows send `state` after `hello`, and again on repository changes,
  workspace-folder changes, and window focus changes.

### Window registry

Per window: `windowId`, `version`, latest `folders`, `focused`, `focusedAt`
(server timestamp of the last `focused: false → true` transition), and `hwnd`.

**Focus handle capture:** on every `focused: false → true` transition, the
server asks the focus helper for the current foreground window and stores it as
that window's `hwnd`. The window is in front at that moment by definition. A
later transition overwrites it.

**Remembered clones:** every folder ever reported is upserted into
`clones.json` as `{ path, remotes, lastSeenAt }`. Entries whose path no longer
exists are dropped on load.

### Target selection (`ranking.ts`)

Pure function: `(request, windows, fileExists) → candidate | null`.
Candidates are `(window, folder)` pairs.

1. **Repo match (required):** some remote equals `github.com/<repo>`
   (lowercase). Remote URLs are normalized from `git@github.com:o/r.git`,
   `ssh://git@github.com/o/r.git`, and `https://github.com/o/r(.git)`.
   Checking all remotes lets a fork-based clone match upstream.
2. **Branch match:** only when `request.ref` is a branch; matches if equal to
   `branch` or `upstreamBranch`.
3. **File exists:** `join(folder.path, request.path)` exists.
4. **Most recent `focusedAt`** wins; windows never focused sort last.

The same function, with `focusedAt` replaced by `lastSeenAt`, ranks remembered
clones for the launch fallback.

### Open flow

1. Rank connected windows. If a candidate exists, send `open` with the absolute
   path and wait up to **5 seconds** for `opened`.
2. On `ok: true`: `focus.raise(hwnd)` if the window has one, then respond
   `opened`. A failed raise is logged but still returns `opened`.
3. On `ok: false`: respond `error` with reason `open-failed` and the message.
4. On timeout: respond `error` with reason `timeout`.
5. No connected candidate: see [Fallbacks](#fallbacks).

### Focus helper (`focus.ts`)

One `powershell.exe -NoProfile -NonInteractive -Command -` process, started
lazily and restarted if it exits. On start it compiles an `Add-Type` helper,
then reads one command per line and writes one result line:

- `foreground` → decimal window handle of `GetForegroundWindow()`.
- `raise <hwnd>` → `IsWindow` check, `ShowWindow(SW_RESTORE)` if minimized,
  Alt-key unlock, `SetForegroundWindow`; prints `ok` or `failed <reason>`.

Commands are serialized; each has a 2-second timeout.

### Browser HTTP API

Every request must have `Authorization: Bearer <token>`, and any `Origin`
header must start with `chrome-extension://`; otherwise `401`. A missing
`Origin` is accepted because Chrome omits it on extension GETs; a web page
cannot send `Authorization` cross-origin without an `Origin`-bearing preflight. No CORS headers are
served (the extension's host permission bypasses CORS).

- `GET /health` → `{ ok: true, version, windows: number }`
- `POST /open` with `OpenRequest`, returns `OpenResponse` (HTTP 200 for every
  outcome below; 400 for malformed input).

```ts
type Ref = { kind: 'branch'; name: string } | { kind: 'commit'; sha: string };

interface OpenRequest {
  repo: string;     // "owner/repo"
  path: string;     // repo-relative, no leading slash
  line: number;     // 1-based
  column: number;   // 1-based
  ref: Ref | null;
}

type OpenResponse =
  | { status: 'opened'; folder: string; matchedBranch: boolean; launchUrl: string | null }
  | { status: 'launch'; folder: string; launchUrl: string }
  | { status: 'launching'; folder: string }
  | { status: 'no-clone'; repo: string }
  | { status: 'error'; reason: 'open-failed' | 'timeout'; message: string };
```

**Pairing token:** 32 random bytes, hex, generated on first server start and
stored in `~/.config/github-tweaks-companion/token` (mode `0600`).

### Fallbacks

**Repo remembered but not open in any window** (server side, `launches.ts`):

1. Rank remembered clones. If none: `no-clone`.
2. If a launch for that folder was issued in the last 60 seconds, replace its
   queued request with this one and respond `launching`.
3. Otherwise queue the request for that folder, record the launch, and respond
   `launch` with `launchUrl` =
   `cursor://vscode-remote/wsl+<distro>/<folder>`, where `<distro>` is
   `WSL_DISTRO_NAME` lowercased (passed by the spawning window as
   `--distro`).
4. When a window's `state` includes the queued folder, deliver the queued
   request through the normal open flow (no HTTP response is waiting; result
   is logged). Queued requests expire after 60 seconds.

**Server not running** (browser side, `client.ts`):

1. `POST /open` fails to connect.
2. Look up `repo` in the browser's `repo → { folder, launchUrl }` cache, which
   is updated from every `opened`, `launch`, and `launching` response. If
   missing, report `companion-offline`.
3. Open the cached `launchUrl`, then retry `POST /open` every second for up to
   30 seconds.

**Per click, the browser opens a launch URL at most once.** During retries, a
`launch` response is treated like `launching` (keep retrying), and `opened`,
`no-clone`, or `error` end the loop.

## Cursor extension

- `extensionKind: ["workspace"]`, `activationEvents: ["onStartupFinished"]`,
  `engines.vscode: "^1.80.0"`, `extensionDependencies: ["vscode.git"]`.
- **Activation:** connect to the socket. On failure, spawn the server with
  `--port`, `--version`, and `--distro`, then retry with backoff
  (100 ms doubling to 2 s, up to 10 s total). On `restart`, respawn and
  reconnect the same way. On unexpected disconnect, reconnect the same way.
- **Window state:** from `vscode.git` `getAPI(1)`: for each repository,
  `rootUri.fsPath`, `state.HEAD?.name`, `state.HEAD?.upstream?.name`,
  `state.remotes[].fetchUrl` (normalized as in ranking). Subscribe to
  `onDidOpenRepository`, `onDidCloseRepository`, and each repository's
  `state.onDidChange`; send `state` debounced by 250 ms. Send immediately on
  `window.onDidChangeWindowState`.
- **Open:** `openTextDocument(path)` then `showTextDocument` with the cursor at
  `line:column` clamped to the document, `preserveFocus: false`, and
  `revealInCenterIfOutsideViewport`. Reply `opened` with `ok: false` and the
  error message on failure (for example, file missing).
- **Commands:**
  - Copy pairing token: read the token file, copy it to the clipboard, and
    show a confirmation.
  - Show status: an output channel listing server version, connected window
    count, and this window's folders, remotes, and branches.

## Browser extension

### Messages

Added to `src/shared/types.ts`:

```ts
type OpenTarget =
  | { kind: 'pr-line'; owner: string; repository: string; number: number;
      path: string; line: number }
  | { kind: 'pr-comment'; owner: string; repository: string; number: number;
      commentId: string; fallback: { path: string; line: number } | null }
  | { kind: 'blob'; owner: string; repository: string;
      ref: Ref | null; path: string; line: number };
```

- `open-in-cursor` with `{ target: OpenTarget }` → `OpenResult`:

  ```ts
  type OpenResult =
    | { status: 'opened' }
    | { status: 'failed'; reason:
        | 'not-paired' | 'companion-offline' | 'no-clone'
        | 'comment-not-found' | 'open-failed' | 'timeout';
        message: string };
  ```

- `companion-status` → `{ connected: true; version: string; windows: number }`
  or `{ connected: false; reason: 'not-paired' | 'offline' | 'unauthorized' }`.

### Background resolution

The background worker turns an `OpenTarget` into an `OpenRequest`
(`column` is always 1):

- **`pr-line`:** `ref` = PR head branch from the PR context query; if the query
  fails (no PAT, network), `ref` = `null` and the open proceeds.
- **`pr-comment`:** look up `commentId` in the PR context's thread index.
  Found: `path` = thread `path`, `line` = `line ?? originalLine`. Not found or
  query failed: use `fallback` if present, else fail with `comment-not-found`.
- **`blob`:** pass through.

**PR context query** (`src/github/pullRequestContext.ts`), paginated, cached in
memory per PR for 60 seconds:

```graphql
query($owner: String!, $repository: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repository) {
    pullRequest(number: $number) {
      headRefName
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          path line originalLine
          comments(first: 100) { nodes { databaseId } }
        }
      }
    }
  }
}
```

Indexed by `String(databaseId)` for every comment in every thread.

**Companion client** (`src/companion/client.ts`): reads port and token from
storage, calls the server, runs the fallback loop above, maintains the
`repo → { folder, launchUrl }` cache in `browser.storage.local`, and maps
`OpenResponse` to `OpenResult`. Opening a launch URL uses `browser.tabs.update`
on the sender's tab with the `cursor://` URL (the browser hands it to Cursor
and the page stays put).

Token, port, and cache live in `browser.storage.local` beside the PAT and are
never sent to content scripts.

### Permissions

Add `http://127.0.0.1/*` to `host_permissions` (matches any port). Chrome
prompts once on update. No new GitHub token scopes.

### Popup

New "Cursor companion" section: port (default 17380), pairing token field
(saved on change, masked), and a status line from `companion-status`:
"Connected · v0.1.0 · 3 windows", "Not paired: run GitHub Tweaks: Copy pairing
token in Cursor", "Companion offline: open a Cursor window", or
"Token rejected".

### Button surfaces

`owner`, `repository`, and `number` come from the URL for every PR surface.

| Surface | Mount | Target |
|---|---|---|
| Diff line | Menu item in the line's "More actions" menu | `pr-line` |
| File header | Icon button before the Viewed control in `[data-diff-header-wrapper]` | `pr-line` |
| Review thread, changes tab | Icon in the thread heading row (beside "Comment on lines R107 to R108") | `pr-comment` with DOM fallback |
| Review thread, conversation tab | Icon in the `review-thread-collapsible` header row, after the path link | `pr-comment`, no fallback |
| Blob toolbar | Button group item after the Raw / Copy / Download group (`[data-testid="raw-button"]`) | `blob` |
| Blob line menu | Item in `[data-testid="highlighted-line-menu"]` after "View file in GitHub.dev" | `blob` |

Rules per surface:

- **Diff line menu.** The menu is a portal with no reliable link back to its
  line. A capture-phase `click` listener records the line cell
  (`td[data-line-number][data-diff-side]`) whose
  `button[aria-label="More actions"][aria-haspopup="true"]` was clicked. When
  a `[role="menu"]` appears containing an item labeled
  `Add comment on line <L|R><n>`, inject only if `<L|R><n>` matches the
  recorded cell's side and `data-line-number`. Path comes from the enclosing
  file section (`[role="region"][id^="diff-"]`): its header's
  `[data-file-path]` button. Either side opens that line number.
- **File header.** Line = first `td[data-diff-side="right"]` in that file whose
  `code` has class `addition`; else first `td[data-diff-side="right"]`; else
  1. If the file has rendered cells but none on the right side (deleted file),
  no button.
- **Review thread, changes tab.** `commentId` from the first comment element's
  `id="r<digits>"`. Fallback path from the enclosing file section's
  `data-file-path`; fallback line from the heading's last `R<n>` (or `L<n>`).
- **Review thread, conversation tab.** `commentId` from the first
  `id="discussion_r<digits>"` inside the thread, else the first entry of
  `data-hidden-comment-ids`. No DOM fallback: paths are truncated and collapsed
  threads do not render code.
- **Blob pages.** Line from the hash: `#L9` or `#L9-L15` → 9; no hash → 1.
  Ref and path from the URL `/blob/<rest>`:
  - First segment is 40 hex characters → `{ kind: 'commit' }`, path is the rest.
  - Otherwise use `payload.codeViewBlobLayoutRoute.refInfo.name` and `.path`
    from `script[data-target="react-app.embeddedData"]` if the URL rest equals
    `<name>/<path>`. `refType: "branch"` gives a branch ref; anything else uses
    `currentOid` as a commit.
  - Otherwise treat the first segment as the branch and the rest as the path.
    A wrong guess surfaces as `open-failed` (file missing).
- **Injection.** Idempotent via `data-ght-open-in-cursor`; menus are observed
  on open; all listeners and injected nodes removed in `stop`; keyboard
  accessible with the accessible name "Open in Cursor".
- **Button states:** idle; working (spinner, disabled); opened (check icon for
  1.5 s); failed (inline message for 5 s, text per `OpenResult.reason`).

### Fixtures

Cut from the captured dumps into `tests/fixtures/open-in-cursor/`, sanitized
per `DEVELOPMENT.md`:

- `diff-line.html` — one right-side cell with its action bar
- `diff-line-menu.html` — the line "More actions" menu
- `diff-file-header.html` — file header with path, diffstat, Viewed
- `changes-review-thread.html` — inline thread with heading and comment id
- `conversation-review-threads.html` — one expanded and one collapsed resolved
  thread
- `blob-header.html` — Raw / Copy / Download toolbar
- `blob-line-menu.html` — highlighted-line menu

The blob fixture also needs the page's embedded route data; capture it while
building that surface.

## Testing

- **Unit (Vitest):** remote normalization; ranking (branch vs upstream,
  file-exists, focus tie-break, no candidates, remembered clones); launch
  de-duplication and expiry; protocol parsing; version comparison; blob URL
  parsing; PR context indexing and `line ?? originalLine`; background
  resolution including fallbacks; client fallback loop (launch once, retry,
  terminal statuses).
- **Fixture DOM tests:** every surface: mount, idempotency, target extraction,
  diff-menu cross-check rejection, deleted-file header, cleanup in `stop`.
- **Server integration test:** spawn the server on a temp socket and port with
  two fake windows; assert routing, 5-second timeout, `open-failed`, queued
  launch delivery, `launching` de-duplication, 401 on bad token or origin,
  version `restart`, and idle shutdown (shortened by a test flag). Focus
  helper stubbed.
- **Playwright e2e:** extend the existing mocked flow with a fake companion
  HTTP server; click a review-thread button and assert the `POST /open`
  payload.
- **Manual checklist:** three bagel clones on different branches with the PR
  head branch matching one; click while another window is focused; minimized
  target; repo not open in any window; no Cursor running; wrong token; server
  killed mid-session; extension update while windows are open.

## Build order

1. **Verify the two remaining environment assumptions** (throwaway):
   - Windows Chrome reaches a server bound to `127.0.0.1:17380` in WSL, and
     Cursor's automatic port forwarding does not interfere.
   - A persistent PowerShell helper answers `foreground` and `raise` quickly,
     including restoring a minimized window.
2. **Tooling:** dev dependencies, `companion/` skeleton, build/install scripts,
   typecheck and Vitest config.
3. **Companion server:** protocol, registry, ranking, launches, focus helper,
   HTTP API with auth, lock, idle shutdown. Unit and integration tests.
   Exercise with `curl`.
4. **Cursor extension:** spawn/connect, git state, focus reporting, open,
   commands. Manual test with `curl` against three clones.
5. **Browser plumbing:** permission, message types, PR context query,
   companion client, popup section.
6. **Surfaces**, one at a time with fixtures and tests: review threads (both
   tabs), diff line menu, file header, blob toolbar and line menu.
7. **Docs and cleanup:** README and DEVELOPMENT updates, `pnpm check`, remove
   the focus spike (`cursor --uninstall-extension local.focus-spike`,
   `~/focus-spike`), `/tmp/open-in-cursor-test.html`, and raw dumps.

## Risks

- **GitHub markup drift** in menus and thread headers. Mitigated by
  test-ID/ARIA anchors, fixtures, the diff-menu cross-check, and the API lookup
  for threads.
- **Focus-stealing rules** could tighten in a Windows update. The helper is
  isolated in `focus.ts`; worst case the file still opens and the window
  flashes in the taskbar.
- **WSL networking modes** (NAT vs mirrored) change localhost forwarding.
  Step 1 verifies the current setup; the port is configurable.
- **Blob branch names containing `/`** depend on page data not yet captured;
  the fallback guess fails visibly rather than opening the wrong file.

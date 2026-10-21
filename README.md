# GitHub Tweaks

A personal Chrome extension for focused improvements to the GitHub interface.
The project is intentionally organized as small, independent features so more
tweaks can be added without turning the content script into one large DOM
patch.

## Features

Every feature is on by default. Turn individual features off or on from the
**Features** section of the toolbar popup; changes apply after reloading the
GitHub tab.

### Pull request sidebar metadata

On a pull request's changed-files page, GitHub Tweaks adds:

- per-file additions and deletions (`+X -Y`) to the file tree
- a read-only Viewed indicator synchronized with GitHub's native control
- dimmed file rows after they are marked Viewed, including completed folders
- remaining unviewed line counts and `viewed/total` progress on directory rows
- `X / N changes` line progress with a circular meter beside the sticky file viewed control
- commit- and commit-range-specific counts when the Changes selector is filtered
- immediate cached results followed by a fresh GitHub API update

The feature supports GitHub's `/pull/:number/changes` and legacy
`/pull/:number/files` routes on `github.com`.

### Mermaid fullscreen viewer

Anywhere GitHub renders a Mermaid diagram, GitHub Tweaks replaces the native
fullscreen control with its own button and modal (~90% of the viewport). The
viewer clones GitHub's complete rendered SVG from its
`viewscreen.githubusercontent.com` frame, then adds free mouse pan (left or
middle drag), wheel zoom toward the cursor, and custom scrollbars when zoomed
in. Close with Esc, the close button, or the backdrop. If the SVG cannot be
loaded, the modal offers Retry or Show native viewer for that diagram. The
failure is also printed in the page console and appended to
`localStorage['ght-mermaid-fullscreen-errors']`.

### Hand back PR assignee

On pull request pages, when you are assigned and are not the author, GitHub
Tweaks adds a **reassign author** action beside Assignees (same style as
Refined GitHub’s “review now” / “approve now”). One click removes you as an
assignee (leaving other assignees alone), assigns the author if needed, then
refreshes GitHub's Assignees partial so the list shows GitHub's values.

### Pinned people

On pull request pages, each person in the Reviewers and Assignees menus has a
pin. Pins are stored per repository in extension storage and listed
alphabetically under **Pinned** at the top of both menus, including people who
are not in that menu yet. The row still selects them through GitHub's own
control. The menu's search box filters the pinned rows along with the rest of
the list. Pins are for people.

### Open in Cursor

Opens the file and line behind a GitHub view in your local Cursor window,
inside the matching clone, and brings that window to the front. Buttons appear:

- beside the blue **+** (add comment) button when you hover a diff line, and in
  each file header (before **Viewed**), on the Files changed tab
- in each review thread heading on the Files changed and Conversation tabs
- in a file page's toolbar (after Raw / Copy / Download) and its highlighted
  line menu

When a repository is cloned more than once, the clone checked out on the PR's
head branch wins; otherwise the most recently focused window wins. If the
clone isn't open, Cursor opens it and then the file.

This needs the **GitHub Tweaks Companion** Cursor extension, which runs in
every WSL Cursor window and starts a small local server on demand:

```sh
pnpm companion:install
```

Reload each Cursor window, run **GitHub Tweaks: Copy pairing token** from the
command palette, and paste the token into the **Cursor companion** section of
the toolbar popup. The current version supports WSL Cursor windows on Windows.

### Pull request tab icons

Each pull request tab gets its own favicon badge and title prefix, so several
tabs of the same PR are easy to tell apart in the tab strip. The favicon stays
GitHub's Octocat, with a colored page icon in the corner where GitHub normally
shows CI status:

- **Conversation** — blue speech bubbles, `Conversation · …`
- **Commits** (including a single commit's diff) — purple commit dot,
  `Commits · …`
- **Checks** — orange checklist, `Checks · …`
- **Files changed** (`/files` and `/changes`) — green file diff, `Files · …`

The favicon follows the system light or dark theme. Other GitHub pages keep
the normal favicon.

## Install for local use

Requirements: Node.js 20 or newer, pnpm, Chrome, and a GitHub fine-grained
personal access token.

```sh
pnpm install
pnpm build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `.output/chrome-mv3`.
5. Pin GitHub Tweaks and open its toolbar popup.
6. Save a fine-grained GitHub personal access token.

The token must target the resource owner containing the repositories you use
and grant **Pull requests: read and write** plus **Contents: read**. The
Contents permission supplies per-commit and commit-range statistics. Version 1
supports one token and one resource owner at a time.

## Privacy and permissions

The token is stored in `chrome.storage.local`, which is private to the
extension but is not an operating-system secrets vault. It is sent only to
`https://api.github.com/graphql` by the extension background worker and is
never exposed to GitHub page scripts or the content script.

The extension requests access only to:

- `https://github.com/*` to enhance pull request pages and Mermaid embeds
- `https://api.github.com/*` to read changed-file metadata and hand back PR
  assignees
- `http://127.0.0.1/*` to reach the local Cursor companion server (any port)
- extension-local storage for the token, pull request metadata cache,
  per-repository pinned people, and the companion pairing token

The companion server listens only on `127.0.0.1`. It rejects requests without
the pairing token or from a web page origin, and it never receives the GitHub
token.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for architecture, commands, tests,
debugging, selector conventions, and fixture maintenance.

For agent-assisted DOM captures, load the unpacked
[DOM Dump Picker](devtools/dom-picker/) and run `pnpm dump-receiver`.

## Direction

Future tweaks should remain narrowly scoped, default to minimal permissions,
and use the shared feature lifecycle and background-message boundaries. New
ideas will be documented as they become concrete rather than committed to in
advance.

## License

[MIT](LICENSE)

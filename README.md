# GitHub Tweaks

A personal Chrome extension for focused improvements to the GitHub interface.
The project is intentionally organized as small, independent features so more
tweaks can be added without turning the content script into one large DOM
patch.

## Features

### Pull request sidebar metadata

On a pull request's changed-files page, GitHub Tweaks adds:

- per-file additions and deletions (`+X -Y`) to the file tree
- a Viewed checkbox synchronized with GitHub's native Viewed control
- dimmed file rows after they are marked Viewed, including completed folders
- remaining unviewed line counts and `viewed/total` progress on directory rows
- immediate cached results followed by a fresh GitHub API update

The feature supports GitHub's `/pull/:number/changes` and legacy
`/pull/:number/files` routes on `github.com`.

### Mermaid fullscreen viewer

Anywhere GitHub renders a Mermaid diagram, the native fullscreen dialog is
expanded to about 90% of the viewport with free mouse pan (left or middle
drag), wheel zoom toward the cursor, and custom scrollbars for position when
zoomed in. Close with Esc or GitHub's close button.

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
and grant **Pull requests: read and write**. Version 1 supports one token and
one resource owner at a time.

## Privacy and permissions

The token is stored in `chrome.storage.local`, which is private to the
extension but is not an operating-system secrets vault. It is sent only to
`https://api.github.com/graphql` by the extension background worker and is
never exposed to GitHub page scripts or the content script.

The extension requests access only to:

- `https://github.com/*` to enhance pull request pages and Mermaid embeds
- `https://api.github.com/*` to read changed-file metadata and update Viewed
  state
- extension-local storage for the token and pull request metadata cache

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

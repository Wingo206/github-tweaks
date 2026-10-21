export type PrTab = 'conversation' | 'commits' | 'checks' | 'files';

export const PR_TABS: readonly PrTab[] = ['conversation', 'commits', 'checks', 'files'];

const SUBPATH_TABS: Record<string, PrTab> = {
  commits: 'commits',
  checks: 'checks',
  files: 'files',
  changes: 'files',
};

const TITLE_LABELS: Record<PrTab, string> = {
  conversation: 'Conversation',
  commits: 'Commits',
  checks: 'Checks',
  files: 'Files',
};

/**
 * GitHub's 32×32 Octocat with the bottom-right corner cut away, as in its CI
 * status favicons (`favicon-failure.svg`), leaving x ≥ 12, y ≥ 14 free.
 */
const OCTOCAT_PATH =
  'M0 16C0 7.16 7.16 0 16 0C24.1626 0 30.8929 6.10479 31.8764 14H26.1444C25.9339 12.7632 25.3856 11.7226 24.6 10.86C24.76 10.46 25.32 8.82 24.44 6.62C24.44 6.62 23.1 6.18 20.04 8.26C18.76 7.9 17.4 7.72 16.04 7.72C14.68 7.72 13.32 7.9 12.04 8.26C8.98 6.2 7.64 6.62 7.64 6.62C6.76 8.82 7.32 10.46 7.48 10.86C6.46 11.98 5.84 13.42 5.84 15.16C5.84 20.6387 8.82119 22.3187 12 22.8976V25.2442C11.0224 25.6632 8.83035 26.2166 7.44 23.88C7.14 23.4 6.24 22.22 4.98 22.24C3.64 22.26 4.44 23 5 23.3C5.68 23.68 6.46 25.1 6.64 25.56C6.95947 26.4585 7.99655 28.1743 12 27.4437V30.6814C11.8951 31.0116 11.5751 31.2911 10.94 31.18C4.58 29.06 0 23.08 0 16Z';

/** 16×16 Octicon paths (MIT, primer/octicons). */
const ICON_PATHS: Record<PrTab, string> = {
  conversation:
    'M1.75 1h8.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 10.25 10H7.061l-2.574 2.573A1.458 1.458 0 0 1 2 11.543V10h-.25A1.75 1.75 0 0 1 0 8.25v-5.5C0 1.784.784 1 1.75 1ZM1.5 2.75v5.5c0 .138.112.25.25.25h1a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h3.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13 2a.25.25 0 0 0-.25-.25h-.5a.75.75 0 0 1 0-1.5h.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 14.25 12H14v1.543a1.458 1.458 0 0 1-2.487 1.03L9.22 12.28a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l2.22 2.22v-2.19a.75.75 0 0 1 .75-.75h1a.25.25 0 0 0 .25-.25Z',
  commits:
    'M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z',
  checks:
    'M2.5 1.75v11.5c0 .138.112.25.25.25h3.17a.75.75 0 0 1 0 1.5H2.75A1.75 1.75 0 0 1 1 13.25V1.75C1 .784 1.784 0 2.75 0h8.5C12.216 0 13 .784 13 1.75v7.736a.75.75 0 0 1-1.5 0V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13.274 9.537v-.001l-4.557 4.45a.75.75 0 0 1-1.055-.008l-1.943-1.95a.75.75 0 0 1 1.062-1.058l1.419 1.425 4.026-3.932a.75.75 0 1 1 1.048 1.074ZM4.75 4h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM4 7.75A.75.75 0 0 1 4.75 7h2a.75.75 0 0 1 0 1.5h-2A.75.75 0 0 1 4 7.75Z',
  files:
    'M1 1.75C1 .784 1.784 0 2.75 0h7.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073ZM8 3.25a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0V7h-1.5a.75.75 0 0 1 0-1.5h1.5V4A.75.75 0 0 1 8 3.25Zm-3 8a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z',
};

/**
 * `/owner/repo/pull/42` → conversation; `/files`, `/changes`, `/commits`, and
 * `/checks` (with any trailing range or SHA) → their tab; anything else → null.
 */
export function parsePrTab(url: URL): PrTab | null {
  if (url.hostname !== 'github.com') {
    return null;
  }
  const match = url.pathname.match(/^\/[^/]+\/[^/]+\/pull\/\d+(?:\/([^/]+)(?:\/.*)?)?\/?$/);
  if (!match) {
    return null;
  }
  const subpath = match[1];
  if (!subpath) {
    return 'conversation';
  }
  return SUBPATH_TABS[subpath] ?? null;
}

export function renderFavicon(tab: PrTab): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<style>.mark{fill:#24292e}.badge{fill:#0969da}' +
    '@media (prefers-color-scheme:dark){.mark{fill:#fff}.badge{fill:#4493f8}}</style>' +
    `<path class="mark" d="${OCTOCAT_PATH}"/>` +
    `<path class="badge" transform="translate(16 16)" d="${ICON_PATHS[tab]}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function prefixTitle(title: string, tab: PrTab): string {
  return `${TITLE_LABELS[tab]} · ${title}`;
}

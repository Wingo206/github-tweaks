import { describe, expect, it } from 'vitest';
import { PR_TABS, parsePrTab, prefixTitle, renderFavicon } from './model';

describe('parsePrTab', () => {
  it.each([
    ['/acme/widgets/pull/42', 'conversation'],
    ['/acme/widgets/pull/42/', 'conversation'],
    ['/acme/widgets/pull/42/commits', 'commits'],
    ['/acme/widgets/pull/42/commits/b9d2bd8f0fc13e83ddd3fbb042971a4722eaf967', 'commits'],
    ['/acme/widgets/pull/42/checks', 'checks'],
    ['/acme/widgets/pull/42/files', 'files'],
    ['/acme/widgets/pull/42/files/', 'files'],
    ['/acme/widgets/pull/42/files/abc123..def456', 'files'],
    ['/acme/widgets/pull/42/changes', 'files'],
  ])('%s → %s', (path, tab) => {
    expect(parsePrTab(new URL(`https://github.com${path}`))).toBe(tab);
  });

  it.each([
    '/acme/widgets/pull/42/unknown',
    '/acme/widgets/pulls',
    '/acme/widgets/issues/42',
    '/acme/widgets/pull/new/main',
  ])('ignores %s', (path) => {
    expect(parsePrTab(new URL(`https://github.com${path}`))).toBeNull();
  });

  it('ignores other hosts', () => {
    expect(parsePrTab(new URL('https://gist.github.com/acme/widgets/pull/42'))).toBeNull();
  });
});

describe('renderFavicon', () => {
  it('renders the Octocat with a distinct corner badge per tab', () => {
    const hrefs = PR_TABS.map(renderFavicon);
    expect(new Set(hrefs).size).toBe(PR_TABS.length);
    for (const href of hrefs) {
      expect(href.startsWith('data:image/svg+xml,')).toBe(true);
      const svg = decodeURIComponent(href);
      expect(svg).toContain('<path class="mark" d="M0 16C0 7.16');
      expect(svg).toContain('<path class="badge" transform="translate(16 16)"');
      expect(svg).toContain('prefers-color-scheme:dark');
    }
  });
});

describe('prefixTitle', () => {
  it('prefixes the tab label', () => {
    expect(prefixTitle('Fix it · Pull Request #42', 'files')).toBe('Files · Fix it · Pull Request #42');
    expect(prefixTitle('Fix it', 'conversation')).toBe('Conversation · Fix it');
  });
});

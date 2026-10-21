import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ORIGINAL_HREF, ORIGINAL_TYPE, PrTabMarker } from './dom';
import { renderFavicon } from './model';

const fixture = readFileSync(resolve(process.cwd(), 'tests/fixtures/pr-tab-favicon-head.html'), 'utf8');
const TITLE = 'Add widget support by octo · Pull Request #42 · acme/widgets';
const SVG_ICON = 'https://github.githubassets.com/favicons/favicon.svg';
const PNG_ICON = 'https://github.githubassets.com/favicons/favicon.png';

let marker: PrTabMarker | null = null;

function iconLinks(): HTMLLinkElement[] {
  return Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
}

function hrefs(): string[] {
  return iconLinks().map((link) => link.getAttribute('href') ?? '');
}

function start(tab: Parameters<typeof renderFavicon>[0]): PrTabMarker {
  marker = new PrTabMarker(document, tab);
  marker.start();
  return marker;
}

async function flush(): Promise<void> {
  await new Promise((done) => setTimeout(done, 0));
}

beforeEach(() => {
  document.head.innerHTML = fixture;
});

afterEach(() => {
  marker?.stop();
  marker = null;
});

describe('PrTabMarker', () => {
  it('replaces both GitHub favicons and prefixes the title', async () => {
    start('files');
    await flush();

    expect(hrefs()).toEqual([renderFavicon('files'), renderFavicon('files')]);
    expect(iconLinks().every((link) => link.type === 'image/svg+xml')).toBe(true);
    expect(document.title).toBe(`Files · ${TITLE}`);
    expect(document.head.querySelector('link[rel="mask-icon"]')!.getAttribute('href')).toContain(
      'pinned-octocat',
    );
  });

  it('switches tab without stacking prefixes or losing the originals', async () => {
    const tabMarker = start('conversation');
    tabMarker.setTab('commits');
    await flush();

    expect(hrefs()).toEqual([renderFavicon('commits'), renderFavicon('commits')]);
    expect(document.title).toBe(`Commits · ${TITLE}`);
    expect(iconLinks().map((link) => link.getAttribute(ORIGINAL_HREF))).toEqual([PNG_ICON, SVG_ICON]);
  });

  it('re-applies after GitHub rewrites the favicon or title', async () => {
    start('checks');
    await flush();

    const svgLink = iconLinks()[1]!;
    svgLink.setAttribute('href', 'https://github.githubassets.com/favicons/favicon-success.svg');
    document.title = 'Renamed PR · Pull Request #42 · acme/widgets';
    await flush();

    expect(svgLink.getAttribute('href')).toBe(renderFavicon('checks'));
    expect(svgLink.getAttribute(ORIGINAL_HREF)).toBe(
      'https://github.githubassets.com/favicons/favicon-success.svg',
    );
    expect(document.title).toBe('Checks · Renamed PR · Pull Request #42 · acme/widgets');
  });

  it('re-applies when the favicon links are replaced', async () => {
    start('files');
    await flush();

    document.head.innerHTML = fixture;
    await flush();

    expect(hrefs()).toEqual([renderFavicon('files'), renderFavicon('files')]);
    expect(document.title).toBe(`Files · ${TITLE}`);
  });

  it('restores GitHub’s latest favicon, type, and title on stop', async () => {
    const tabMarker = start('files');
    await flush();
    iconLinks()[1]!.setAttribute('href', 'https://github.githubassets.com/favicons/favicon-failure.svg');
    await flush();

    tabMarker.stop();
    marker = null;

    expect(hrefs()).toEqual([PNG_ICON, 'https://github.githubassets.com/favicons/favicon-failure.svg']);
    expect(iconLinks().map((link) => link.type)).toEqual(['image/png', 'image/svg+xml']);
    expect(iconLinks().some((link) => link.hasAttribute(ORIGINAL_HREF) || link.hasAttribute(ORIGINAL_TYPE))).toBe(
      false,
    );
    expect(document.title).toBe(TITLE);

    iconLinks()[0]!.setAttribute('href', 'https://example.test/icon.png');
    await flush();
    expect(iconLinks()[0]!.getAttribute('href')).toBe('https://example.test/icon.png');
  });

  it('leaves a title it did not set when stopping', async () => {
    const tabMarker = start('commits');
    await flush();
    document.title = 'Issues · acme/widgets';

    tabMarker.stop();
    marker = null;

    expect(document.title).toBe('Issues · acme/widgets');
  });
});

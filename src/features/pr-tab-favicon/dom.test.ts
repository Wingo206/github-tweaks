import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MERMAID_OPEN_CLASS } from '../../shared/pageSignals';
import { ORIGINAL_HREF, ORIGINAL_TYPE, PrTabMarker } from './dom';
import { renderFavicon, type PrTab } from './model';

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

function start(tab: PrTab): PrTabMarker {
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
  document.documentElement.classList.remove(MERMAID_OPEN_CLASS);
});

describe('PrTabMarker', () => {
  it('replaces both GitHub favicons and leaves the title alone', async () => {
    start('files');
    await flush();

    expect(hrefs()).toEqual([renderFavicon('files'), renderFavicon('files')]);
    expect(iconLinks().every((link) => link.type === 'image/svg+xml')).toBe(true);
    expect(document.title).toBe(TITLE);
    expect(document.head.querySelector('link[rel="mask-icon"]')!.getAttribute('href')).toContain(
      'pinned-octocat',
    );
  });

  it('switches tab without losing the originals', async () => {
    const tabMarker = start('conversation');
    tabMarker.setTab('commits');
    await flush();

    expect(hrefs()).toEqual([renderFavicon('commits'), renderFavicon('commits')]);
    expect(iconLinks().map((link) => link.getAttribute(ORIGINAL_HREF))).toEqual([PNG_ICON, SVG_ICON]);
  });

  it('re-applies after GitHub rewrites the favicon', async () => {
    start('checks');
    await flush();

    const svgLink = iconLinks()[1]!;
    svgLink.setAttribute('href', 'https://github.githubassets.com/favicons/favicon-success.svg');
    await flush();

    expect(svgLink.getAttribute('href')).toBe(renderFavicon('checks'));
    expect(svgLink.getAttribute(ORIGINAL_HREF)).toBe(
      'https://github.githubassets.com/favicons/favicon-success.svg',
    );
  });

  it('re-applies when the favicon links are replaced', async () => {
    start('files');
    await flush();

    document.head.innerHTML = fixture;
    await flush();

    expect(hrefs()).toEqual([renderFavicon('files'), renderFavicon('files')]);
  });

  it('restores GitHub’s latest favicon and type on stop', async () => {
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

    iconLinks()[0]!.setAttribute('href', 'https://example.test/icon.png');
    await flush();
    expect(iconLinks()[0]!.getAttribute('href')).toBe('https://example.test/icon.png');
  });

  it('shows the diagram badge while the Mermaid viewer is open', async () => {
    const tabMarker = start('conversation');
    await flush();

    document.documentElement.classList.add(MERMAID_OPEN_CLASS);
    await flush();
    expect(hrefs()).toEqual([renderFavicon('diagram'), renderFavicon('diagram')]);
    expect(document.title).toBe(TITLE);
    expect(iconLinks().map((link) => link.getAttribute(ORIGINAL_HREF))).toEqual([PNG_ICON, SVG_ICON]);

    tabMarker.setTab('files');
    await flush();
    expect(hrefs()).toEqual([renderFavicon('diagram'), renderFavicon('diagram')]);

    document.documentElement.classList.remove(MERMAID_OPEN_CLASS);
    await flush();
    expect(hrefs()).toEqual([renderFavicon('files'), renderFavicon('files')]);
  });

  it('starts in diagram mode when the viewer is already open, and restores on stop', async () => {
    document.documentElement.classList.add(MERMAID_OPEN_CLASS);
    const tabMarker = start('conversation');
    await flush();
    expect(hrefs()).toEqual([renderFavicon('diagram'), renderFavicon('diagram')]);

    tabMarker.stop();
    marker = null;
    expect(hrefs()).toEqual([PNG_ICON, SVG_ICON]);
  });
});

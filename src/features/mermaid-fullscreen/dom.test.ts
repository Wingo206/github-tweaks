import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestRenderedSvg } from './bridge';
import { MERMAID_ERROR_LOG_KEY, readMermaidViewerErrors } from './errors';
import {
  MODAL_ATTRIBUTE,
  MermaidModal,
  NATIVE_FALLBACK_ATTRIBUTE,
  NATIVE_HIDDEN_ATTRIBUTE,
  OPEN_BUTTON_ATTRIBUTE,
  OPEN_CLASS,
  STAGE_CLASS,
  VIEWPORT_CLASS,
  WIRED_ATTRIBUTE,
  clearWiredMarkers,
  findAllNativeDetails,
  findMermaidEmbeds,
  findNativeDetails,
  findOpenButton,
  getSvgIntrinsicSize,
  markWired,
  mountOpenControl,
  parseRenderedSvg,
  showNativeOpenControl,
  unmountOpenControl,
} from './dom';
import { MermaidFullscreenController } from './controller';
import { readMermaidTrace } from './trace';

vi.mock('./bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bridge')>();
  return {
    ...actual,
    requestRenderedSvg: vi.fn(),
  };
});

const fixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/mermaid-embed.html'),
  'utf8',
);
const svgFixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/mermaid-svg.html'),
  'utf8',
);
const svgHtmlLabelFixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/mermaid-svg-html-label.html'),
  'utf8',
);

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.className = '';
  clearWiredMarkers();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('mermaid DOM helpers', () => {
  it('finds embeds and mounts an open control while hiding the native one', () => {
    document.body.innerHTML = fixture;

    const embeds = findMermaidEmbeds();
    expect(embeds).toHaveLength(1);

    const details = findNativeDetails(embeds[0]!);
    expect(details).toBeInstanceOf(HTMLDetailsElement);

    const button = mountOpenControl(embeds[0]!);
    expect(button?.getAttribute('aria-label')).toBe('Open dialog');
    expect(button?.hasAttribute(OPEN_BUTTON_ATTRIBUTE)).toBe(true);
    expect(details?.hasAttribute(NATIVE_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(details?.hidden).toBe(true);
    expect(findOpenButton(embeds[0]!)).toBe(button);

    const second = mountOpenControl(embeds[0]!);
    expect(second).toBe(button);

    unmountOpenControl(embeds[0]!);
    showNativeOpenControl(details!);
    expect(findOpenButton(embeds[0]!)).toBeNull();
    expect(details?.hidden).toBe(false);
  });

  it('marks wiring idempotently on the embed', () => {
    document.body.innerHTML = fixture;
    const embed = findMermaidEmbeds()[0]!;
    markWired(embed);
    markWired(embed);
    expect(embed.getAttribute(WIRED_ATTRIBUTE)).toBe('true');
    clearWiredMarkers();
    expect(embed.hasAttribute(WIRED_ATTRIBUTE)).toBe(false);
  });

  it('parses a complete SVG and preserves its intrinsic canvas', () => {
    const svg = parseRenderedSvg(svgFixture);
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(getSvgIntrinsicSize(svg!)).toEqual({
      width: 2759.15625,
      height: 2389.515625,
    });
    expect(svg?.querySelector('marker')).toBeTruthy();
    expect(svg?.querySelector('foreignObject')).toBeTruthy();
  });

  it('parses serialized Mermaid HTML labels with void elements', () => {
    const svg = parseRenderedSvg(svgHtmlLabelFixture);

    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg?.querySelector('foreignObject p')?.textContent).toBe(
      'First lineSecond line',
    );
  });
});

describe('MermaidModal', () => {
  it('opens on body with loading, then shows a cloned SVG viewport', () => {
    const onClose = vi.fn();
    const modal = new MermaidModal({
      onClose,
      onRetry: vi.fn(),
      onShowNative: vi.fn(),
    });

    expect(document.querySelector(`[${MODAL_ATTRIBUTE}]`)).toBeTruthy();
    expect(document.documentElement.classList.contains(OPEN_CLASS)).toBe(true);
    expect(modal.state).toBe('loading');
    expect(document.body.textContent).toContain('Loading diagram');

    expect(modal.showSvg(svgFixture)).toBe(true);
    expect(modal.state).toBe('ready');
    const svg = document.querySelector(`.${VIEWPORT_CLASS} svg`);
    expect(svg).toBeTruthy();
    expect(svg?.parentElement?.classList.contains(STAGE_CLASS)).toBe(true);
    expect(svg?.parentElement?.style.width).toBe('2759.15625px');
    expect(document.querySelector('.ght-mermaid-scrollbar--x')).toBeTruthy();

    modal.teardown();
    expect(document.querySelector(`[${MODAL_ATTRIBUTE}]`)).toBeNull();
    expect(document.documentElement.classList.contains(OPEN_CLASS)).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes via Escape, close button, and backdrop', () => {
    const onClose = vi.fn();
    const modal = new MermaidModal({
      onClose,
      onRetry: vi.fn(),
      onShowNative: vi.fn(),
    });

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    modal.teardown();
    onClose.mockClear();

    const again = new MermaidModal({
      onClose,
      onRetry: vi.fn(),
      onShowNative: vi.fn(),
    });
    document
      .querySelector<HTMLElement>('[aria-label="Close dialog"]')!
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    document
      .querySelector<HTMLElement>('.ght-mermaid-modal__backdrop')!
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    expect(onClose).toHaveBeenCalledTimes(1);
    again.teardown();
  });

  it('shows retry and native-fallback actions on error', () => {
    const onRetry = vi.fn();
    const onShowNative = vi.fn();
    const modal = new MermaidModal({
      onClose: vi.fn(),
      onRetry,
      onShowNative,
    });

    modal.showError();
    expect(modal.state).toBe('error');

    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '.ght-mermaid-modal__error-actions button',
      ),
    );
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Retry',
      'Show native viewer',
    ]);

    buttons[0]!.click();
    buttons[1]!.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onShowNative).toHaveBeenCalledTimes(1);
    modal.teardown();
  });

  it('zooms toward the cursor on wheel with free transform', () => {
    const modal = new MermaidModal({
      onClose: vi.fn(),
      onRetry: vi.fn(),
      onShowNative: vi.fn(),
    });
    modal.showSvg(svgFixture);

    const viewport = document.querySelector<HTMLElement>(`.${VIEWPORT_CLASS}`)!;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 400,
      right: 800,
      width: 800,
      height: 400,
      toJSON() {
        return {};
      },
    });

    viewport.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -100,
        clientX: 200,
        clientY: 100,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(modal.currentTransform.scale).toBeGreaterThan(1);
    const stage = document.querySelector<HTMLElement>(`.${STAGE_CLASS}`)!;
    const scale = modal.currentTransform.scale;
    expect(stage.style.width).toBe(`${2759.15625 * scale}px`);
    expect(stage.style.height).toBe(`${2389.515625 * scale}px`);
    expect(stage.style.transform).toContain('translate(');
    expect(stage.style.transform).not.toContain('scale(');
    modal.teardown();
  });
});

describe('MermaidFullscreenController', () => {
  it('opens the owned modal with the GitHub SVG and cleans up on close', async () => {
    document.body.innerHTML = fixture;
    vi.mocked(requestRenderedSvg).mockResolvedValue({
      ok: true,
      svg: svgFixture,
    });
    const controller = new MermaidFullscreenController();
    controller.start();

    const embed = findMermaidEmbeds()[0]!;
    expect(embed.hasAttribute(WIRED_ATTRIBUTE)).toBe(true);
    const button = findOpenButton(embed)!;
    expect(button).toBeTruthy();
    expect(findNativeDetails(embed)?.hidden).toBe(true);

    button.click();

    await vi.waitFor(() => {
      expect(document.querySelector(`[${MODAL_ATTRIBUTE}]`)).toBeTruthy();
      expect(document.querySelector(`.${VIEWPORT_CLASS} svg`)).toBeTruthy();
    });

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(document.querySelector(`[${MODAL_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector(`.${VIEWPORT_CLASS}`)).toBeNull();

    controller.stop();
    expect(embed.hasAttribute(WIRED_ATTRIBUTE)).toBe(false);
    expect(findOpenButton(embed)).toBeNull();
    expect(findNativeDetails(embed)?.hidden).toBe(false);
  });

  it('retries after an SVG failure and can fall back to the native control', async () => {
    document.body.innerHTML = fixture;
    vi.mocked(requestRenderedSvg)
      .mockResolvedValueOnce({
        ok: false,
        reason: 'empty-svg',
        detail: 'Viewscreen returned no SVG.',
      })
      .mockResolvedValueOnce({ ok: true, svg: svgFixture });

    const controller = new MermaidFullscreenController();
    controller.start();

    const embed = findMermaidEmbeds()[0]!;
    findOpenButton(embed)!.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Could not load the diagram');
    });
    expect(readMermaidViewerErrors()).toMatchObject([
      {
        reason: 'empty-svg',
        detail: 'Viewscreen returned no SVG.',
      },
    ]);

    document
      .querySelectorAll<HTMLButtonElement>(
        '.ght-mermaid-modal__error-actions button',
      )[0]!
      .click();

    await vi.waitFor(() => {
      expect(document.querySelector(`.${VIEWPORT_CLASS} svg`)).toBeTruthy();
    });

    vi.mocked(requestRenderedSvg).mockResolvedValue({
      ok: false,
      reason: 'request-timeout',
      detail: 'No SVG response within 2500ms.',
    });
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    findOpenButton(embed)!.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Could not load the diagram');
    });

    document
      .querySelectorAll<HTMLButtonElement>(
        '.ght-mermaid-modal__error-actions button',
      )[1]!
      .click();

    expect(embed.hasAttribute(NATIVE_FALLBACK_ATTRIBUTE)).toBe(true);
    expect(findOpenButton(embed)).toBeNull();
    expect(findNativeDetails(embed)?.hidden).toBe(false);
    expect(document.querySelector(`[${MODAL_ATTRIBUTE}]`)).toBeNull();

    controller.stop();
  });

  it('logs a rejected SVG payload', async () => {
    document.body.innerHTML = fixture;
    vi.mocked(requestRenderedSvg).mockResolvedValue({
      ok: true,
      svg: '<p>not a diagram</p>',
    });
    const controller = new MermaidFullscreenController();
    controller.start();

    findOpenButton(findMermaidEmbeds()[0]!)!.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Could not load the diagram');
    });
    expect(readMermaidViewerErrors()[0]).toMatchObject({
      reason: 'invalid-svg',
      detail: 'Expected a single <svg> element, received 1 starting with <p>.',
    });
    expect(localStorage.getItem(MERMAID_ERROR_LOG_KEY)).toBeTruthy();

    controller.stop();
  });

  it('traces open, load, and render metrics', async () => {
    document.body.innerHTML = fixture;
    vi.mocked(requestRenderedSvg).mockResolvedValue({
      ok: true,
      svg: svgFixture,
    });
    const controller = new MermaidFullscreenController();
    controller.start();

    findOpenButton(findMermaidEmbeds()[0]!)!.click();

    await vi.waitFor(() => {
      expect(readMermaidTrace().map((record) => record.event)).toContain(
        'rendered',
      );
    });
    const events = readMermaidTrace().map((record) => record.event);
    expect(events).toEqual(['mounted', 'start', 'click', 'open', 'rendered']);
    expect(readMermaidTrace()[2]?.data).toMatchObject({
      onOurButton: true,
      listening: true,
      identity: 'fixture-mermaid-1',
    });
    expect(readMermaidTrace().at(-1)?.data).toMatchObject({
      identity: 'fixture-mermaid-1',
      viewBox: expect.any(String),
      contentWidth: 2759.15625,
      svgLength: svgFixture.length,
    });

    controller.stop();
  });

  it('warns when a wired embed has no listener, as after a page snapshot restore', () => {
    document.body.innerHTML = fixture;
    const embed = findMermaidEmbeds()[0]!;
    mountOpenControl(embed);
    markWired(embed);

    const controller = new MermaidFullscreenController();
    controller.start();

    findOpenButton(embed)!.click();

    const warnings = readMermaidTrace().filter(
      (record) => record.level === 'warn',
    );
    expect(warnings).toMatchObject([
      {
        event: 'wired-without-listener',
        data: { identity: 'fixture-mermaid-1', hasOpenButton: true },
      },
      {
        event: 'click',
        data: { onOurButton: true, listening: false },
      },
    ]);

    controller.stop();
  });

  it('warns when an embed never gets an actions row', () => {
    vi.useFakeTimers();
    document.body.innerHTML = fixture;
    document.querySelector('.js-render-block-actions')!.remove();

    const controller = new MermaidFullscreenController();
    controller.start();
    vi.advanceTimersByTime(3000);

    const stuck = readMermaidTrace().find(
      (record) => record.event === 'mount-stuck',
    );
    expect(stuck).toMatchObject({
      level: 'warn',
      data: { hasActionsRow: false, hasNativeDetails: false },
    });
    expect(stuck?.data?.outline).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^section\.js-render-needs-enrichment/),
        expect.stringMatching(/^\s+div\.js-render-enrichment-target$/),
      ]),
    );

    controller.stop();
  });

  it('re-hides a native control GitHub rebuilds next to our button', () => {
    document.body.innerHTML = fixture;
    const controller = new MermaidFullscreenController();
    controller.start();

    const embed = findMermaidEmbeds()[0]!;
    const button = findOpenButton(embed)!;
    const rebuilt = findNativeDetails(embed)!.cloneNode(true) as HTMLDetailsElement;
    rebuilt.removeAttribute(NATIVE_HIDDEN_ATTRIBUTE);
    rebuilt.hidden = false;
    findNativeDetails(embed)!.replaceWith(rebuilt);
    controller['scan']();

    expect(rebuilt.hasAttribute(NATIVE_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(findOpenButton(embed)).toBe(button);
    expect(
      readMermaidTrace().find(
        (record) => record.event === 'native-control-reshown',
      ),
    ).toMatchObject({
      level: 'warn',
      data: { visibleNativeControls: 1, reshown: 1, moved: false },
    });

    controller.stop();
  });

  it('moves our working button into a toolbar GitHub rebuilt', async () => {
    document.body.innerHTML = fixture;
    vi.mocked(requestRenderedSvg).mockResolvedValue({
      ok: true,
      svg: svgFixture,
    });
    const controller = new MermaidFullscreenController();
    controller.start();

    const embed = findMermaidEmbeds()[0]!;
    const button = findOpenButton(embed)!;
    const template = document.createElement('template');
    template.innerHTML = fixture;
    const freshRow = template.content.querySelector<HTMLElement>(
      '.js-render-block-actions',
    )!;
    embed.querySelector('.js-render-enrichment-target')!.prepend(freshRow);
    controller['scan']();

    expect(button.parentElement).toBe(freshRow);
    expect(
      freshRow.querySelector('details')!.hasAttribute(NATIVE_HIDDEN_ATTRIBUTE),
    ).toBe(true);
    expect(
      readMermaidTrace().find(
        (record) => record.event === 'native-control-reshown',
      )?.data,
    ).toMatchObject({ actionsRows: 2, reshown: 1, moved: true });

    button.click();
    await vi.waitFor(() => {
      expect(document.querySelector(`.${VIEWPORT_CLASS} svg`)).toBeTruthy();
    });

    controller.stop();
    expect(
      findAllNativeDetails(embed).every((details) => !details.hidden),
    ).toBe(true);
  });

  it('only notes, without warning, when GitHub failed to render the diagram', () => {
    document.body.innerHTML = fixture;
    const controller = new MermaidFullscreenController();
    controller.start();

    const embed = findMermaidEmbeds()[0]!;
    embed.classList.add('render-error');
    findOpenButton(embed)!.remove();
    controller['scan']();

    expect(
      readMermaidTrace().find(
        (record) => record.event === 'open-button-removed',
      ),
    ).toMatchObject({ level: 'debug', data: { renderError: true } });

    controller.stop();
  });
});

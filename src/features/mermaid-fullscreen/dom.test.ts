import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ENHANCED_ATTRIBUTE,
  MermaidDialogEnhancer,
  STAGE_CLASS,
  VIEWPORT_CLASS,
  WIRED_ATTRIBUTE,
  clearWiredMarkers,
  enhanceOpenDialog,
  findFullscreenDialog,
  findFullscreenRenderTarget,
  findMermaidDetails,
  findMermaidEmbeds,
  findOpenButton,
  markWired,
} from './dom';
import { MermaidFullscreenController } from './controller';

const fixture = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/mermaid-embed.html'),
  'utf8',
);

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.className = '';
  clearWiredMarkers();
});

describe('mermaid DOM helpers', () => {
  it('finds embed details and fullscreen render target', () => {
    document.body.innerHTML = fixture;

    const embeds = findMermaidEmbeds();
    expect(embeds).toHaveLength(1);

    const button = findOpenButton(embeds[0]!);
    expect(button?.getAttribute('aria-label')).toBe('Open dialog');

    const details = findMermaidDetails(embeds[0]!);
    expect(details).toBeInstanceOf(HTMLDetailsElement);

    const dialog = findFullscreenDialog(details!);
    expect(dialog?.getAttribute('aria-label')).toBe(
      'mermaid rendered container',
    );

    const target = findFullscreenRenderTarget(dialog!);
    expect(target?.dataset.identity).toBe('fixture-mermaid-1-fullscreen');
    expect(target?.querySelector('iframe')?.getAttribute('name')).toBe(
      'fixture-mermaid-1-fullscreen',
    );
  });

  it('marks wiring idempotently', () => {
    document.body.innerHTML = fixture;
    const details = findMermaidDetails(findMermaidEmbeds()[0]!)!;
    markWired(details);
    markWired(details);
    expect(details.getAttribute(WIRED_ATTRIBUTE)).toBe('true');
    clearWiredMarkers();
    expect(details.hasAttribute(WIRED_ATTRIBUTE)).toBe(false);
  });
});

describe('MermaidDialogEnhancer', () => {
  it('wraps the native render target, portals the dialog to body, and restores on teardown', () => {
    document.body.innerHTML = fixture;
    const details = findMermaidDetails(findMermaidEmbeds()[0]!)!;
    const dialog = findFullscreenDialog(details)!;
    const target = findFullscreenRenderTarget(dialog)!;
    const originalParent = target.parentElement!;
    const originalDialogParent = dialog.parentElement!;

    const enhancer = new MermaidDialogEnhancer(details, dialog, target);

    expect(dialog.hasAttribute(ENHANCED_ATTRIBUTE)).toBe(true);
    expect(dialog.classList.contains('ght-mermaid-enhanced')).toBe(true);
    expect(dialog.parentElement).toBe(document.body);
    expect(target.closest(`.${VIEWPORT_CLASS}`)).toBeTruthy();
    expect(target.parentElement?.classList.contains(STAGE_CLASS)).toBe(true);
    expect(target.style.height).toBe('100%');
    expect(document.querySelector('.ght-mermaid-scrollbar--x')).toBeTruthy();
    expect(document.querySelector('.ght-mermaid-scrollbar--y')).toBeTruthy();
    expect(
      document.documentElement.classList.contains('ght-mermaid-enhanced-open'),
    ).toBe(true);

    enhancer.teardown();

    expect(dialog.hasAttribute(ENHANCED_ATTRIBUTE)).toBe(false);
    expect(dialog.parentElement).toBe(originalDialogParent);
    expect(target.parentElement).toBe(originalParent);
    expect(document.querySelector(`.${VIEWPORT_CLASS}`)).toBeNull();
    expect(
      document.documentElement.classList.contains('ght-mermaid-enhanced-open'),
    ).toBe(false);
  });

  it('closes via Escape and the native close button', () => {
    document.body.innerHTML = fixture;
    const details = findMermaidDetails(findMermaidEmbeds()[0]!)!;
    details.open = true;
    const dialog = findFullscreenDialog(details)!;
    const target = findFullscreenRenderTarget(dialog)!;

    const viaEscape = new MermaidDialogEnhancer(details, dialog, target);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(details.open).toBe(false);
    viaEscape.teardown();

    details.open = true;
    const viaButton = new MermaidDialogEnhancer(details, dialog, target);
    dialog
      .querySelector<HTMLElement>('[data-close-dialog]')!
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    expect(details.open).toBe(false);
    viaButton.teardown();
  });

  it('zooms toward the cursor on wheel with free transform', () => {
    document.body.innerHTML = fixture;
    const details = findMermaidDetails(findMermaidEmbeds()[0]!)!;
    const dialog = findFullscreenDialog(details)!;
    const target = findFullscreenRenderTarget(dialog)!;
    const enhancer = new MermaidDialogEnhancer(details, dialog, target);

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

    expect(enhancer.currentTransform.scale).toBeGreaterThan(1);
    const stage = document.querySelector<HTMLElement>(`.${STAGE_CLASS}`)!;
    expect(stage.style.transform).toContain('scale(');
    enhancer.teardown();
  });

  it('enhanceOpenDialog is idempotent while already enhanced', () => {
    document.body.innerHTML = fixture;
    const details = findMermaidDetails(findMermaidEmbeds()[0]!)!;
    const first = enhanceOpenDialog(details);
    const second = enhanceOpenDialog(details);
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    first?.teardown();
  });
});

describe('MermaidFullscreenController', () => {
  it('enhances when the native details dialog opens and cleans up on close', async () => {
    document.body.innerHTML = fixture;
    const controller = new MermaidFullscreenController();
    controller.start();

    const details = findMermaidDetails(findMermaidEmbeds()[0]!)!;
    expect(details.hasAttribute(WIRED_ATTRIBUTE)).toBe(true);

    details.open = true;
    details.dispatchEvent(new Event('toggle'));

    await vi.waitFor(() => {
      expect(document.querySelector(`[${ENHANCED_ATTRIBUTE}]`)).toBeTruthy();
    });

    details.open = false;
    details.dispatchEvent(new Event('toggle'));

    expect(document.querySelector(`[${ENHANCED_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector(`.${VIEWPORT_CLASS}`)).toBeNull();
    expect(findFullscreenDialog(details)).toBeTruthy();

    controller.stop();
    expect(details.hasAttribute(WIRED_ATTRIBUTE)).toBe(false);
  });
});

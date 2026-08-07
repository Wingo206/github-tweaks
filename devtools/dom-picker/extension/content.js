/* Injected on demand. Re-inject safe. */
(() => {
  const GLOBAL_KEY = '__ghtDomDumpPicker';
  const ROOT_ID = 'ght-dom-dump-root';
  const COMPUTED_KEYS = [
    'width',
    'max-width',
    'height',
    'max-height',
    'position',
    'left',
    'top',
    'right',
    'bottom',
    'transform',
    'display',
    'overflow',
    'overflow-x',
    'overflow-y',
    'z-index',
    'box-sizing',
  ];

  if (window[GLOBAL_KEY]?.stop) {
    window[GLOBAL_KEY].stop();
  }

  let depth = 0;
  let hovered = null;
  let includeComputed = false;
  let active = false;
  let root = null;
  let box = null;
  let label = null;

  function ensureUi() {
    document.getElementById(ROOT_ID)?.remove();
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('data-ght-dom-dump', '1');
    box = document.createElement('div');
    box.className = 'ght-dom-dump-box';
    label = document.createElement('div');
    label.className = 'ght-dom-dump-label';
    root.append(box, label);
    document.documentElement.append(root);
  }

  function teardownUi() {
    document.getElementById(ROOT_ID)?.remove();
    root = box = label = null;
    document.documentElement.classList.remove('ght-dom-dump-picking');
  }

  function unbind() {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
  }

  function describe(el) {
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  }

  function ancestorAt(el, n) {
    let node = el;
    for (let i = 0; i < n && node.parentElement; i += 1) {
      node = node.parentElement;
    }
    return node;
  }

  function maxDepth(el) {
    let n = 0;
    let node = el;
    while (node.parentElement) {
      n += 1;
      node = node.parentElement;
    }
    return n;
  }

  function paint(target) {
    if (!box || !label || !(target instanceof Element)) {
      if (box) box.style.display = 'none';
      if (label) label.style.display = 'none';
      return;
    }
    const rect = target.getBoundingClientRect();
    box.style.display = 'block';
    box.style.top = `${rect.top}px`;
    box.style.left = `${rect.left}px`;
    box.style.width = `${Math.max(rect.width, 2)}px`;
    box.style.height = `${Math.max(rect.height, 2)}px`;

    label.className = 'ght-dom-dump-label';
    label.style.display = 'block';
    label.textContent = `${describe(target)}  ·  depth ${depth}  ·  wheel ± · click capture · Esc`;
    const top = rect.top > 28 ? rect.top - 24 : rect.bottom + 6;
    label.style.top = `${top}px`;
    label.style.left = `${Math.max(8, rect.left)}px`;
  }

  function currentTarget() {
    if (!(hovered instanceof Element)) {
      return null;
    }
    return ancestorAt(hovered, depth);
  }

  function onMove(event) {
    if (!active) return;
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || (root && root.contains(el))) return;
    if (el !== hovered) {
      hovered = el;
      depth = Math.min(depth, maxDepth(el));
    }
    paint(currentTarget());
  }

  function onWheel(event) {
    if (!active || !(hovered instanceof Element)) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.deltaY > 0 ? 1 : -1;
    depth = Math.max(0, Math.min(maxDepth(hovered), depth + delta));
    paint(currentTarget());
  }

  function collectAttrs(el) {
    const attrs = {};
    for (const attr of el.attributes) {
      attrs[attr.name] = attr.value;
    }
    return attrs;
  }

  function collectComputed(el) {
    const style = getComputedStyle(el);
    const out = {};
    for (const key of COMPUTED_KEYS) {
      out[key] = style.getPropertyValue(key);
    }
    return out;
  }

  async function onClick(event) {
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    const target = currentTarget();
    if (!(target instanceof Element) || !label) return;

    const rect = target.getBoundingClientRect();
    const payload = {
      url: location.href,
      title: document.title,
      tagName: target.tagName.toLowerCase(),
      id: target.id || null,
      className: typeof target.className === 'string' ? target.className : null,
      attrs: collectAttrs(target),
      depth,
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
      computed: includeComputed ? collectComputed(target) : null,
      outerHTML: target.outerHTML,
    };

    label.textContent = 'Sending…';
    const result = await chrome.runtime.sendMessage({
      type: 'ght-dom-dump-submit',
      payload,
    });

    if (result?.ok) {
      label.textContent = `Captured → dumps/latest.html (${result.byteLength} bytes)`;
      label.classList.add('ght-dom-dump-ok');
      setTimeout(() => stop(), 900);
    } else {
      label.textContent = `Failed: ${result?.error || 'unknown error'}`;
      label.classList.add('ght-dom-dump-err');
    }
  }

  function onKey(event) {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      stop();
    }
  }

  function stop() {
    active = false;
    unbind();
    teardownUi();
  }

  function start(options = {}) {
    stop();
    includeComputed = Boolean(options.includeComputed);
    active = true;
    depth = 0;
    hovered = null;
    ensureUi();
    document.documentElement.classList.add('ght-dom-dump-picking');
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    label.style.display = 'block';
    label.textContent = 'Move over an element…';
    label.style.top = '12px';
    label.style.left = '12px';
  }

  function onMessage(message, _sender, sendResponse) {
    if (message?.type === 'ght-dom-dump-start') {
      start(message);
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type === 'ght-dom-dump-stop') {
      stop();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  }

  if (window[GLOBAL_KEY]?.onMessage) {
    chrome.runtime.onMessage.removeListener(window[GLOBAL_KEY].onMessage);
  }

  chrome.runtime.onMessage.addListener(onMessage);
  window[GLOBAL_KEY] = { start, stop, onMessage };
})();

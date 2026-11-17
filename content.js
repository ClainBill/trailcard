// Runs on every page. Reports light interaction signals to the background
// worker, which decides whether to keep them (pause / blocklist apply there).
(() => {
  const send = (msg) => {
    try {
      if (chrome.runtime?.id) chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {
      /* extension was reloaded; this page's script is orphaned */
    }
  };

  const meta = (sel) => document.querySelector(sel)?.getAttribute('content') || '';

  send({
    type: 'page-meta',
    image: meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'),
    description: (meta('meta[property="og:description"]') || meta('meta[name="description"]')).slice(0, 300),
  });

  document.addEventListener(
    'click',
    (e) => {
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!a) return;
      const text = (a.innerText || a.getAttribute('aria-label') || a.title || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      if (text) send({ type: 'link-click', text });
    },
    true
  );

  // ----- "Flashcard" chip next to highlighted text -----

  let chipEnabled = true;
  let chip = null;
  let chipText = '';

  try {
    chrome.storage.local.get('settings').then((o) => (chipEnabled = o.settings?.selectionChip ?? true));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      chipEnabled = changes.settings.newValue?.selectionChip ?? true;
      if (!chipEnabled) hideChip();
    });
  } catch {
    /* orphaned script */
  }

  function currentSelection() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const active = document.activeElement;
    if (active && (/^(INPUT|TEXTAREA)$/.test(active.tagName) || active.isContentEditable)) return null;
    const text = String(sel).replace(/\s+/g, ' ').trim();
    if (text.length < 3 || text.length > 1500) return null;
    // Anchor to the last visible line of the highlight. The range's overall box can be
    // far larger than what is highlighted when it spans hidden or out-of-flow elements.
    const range = sel.getRangeAt(sel.rangeCount - 1);
    const lines = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const rect = lines.at(-1) || range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { text, rect };
  }

  function buildChip() {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;display:none;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent =
      'button{all:initial;display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;' +
      'background:#4f46e5;color:#fff;font:600 13px/1.2 system-ui,-apple-system,sans-serif;cursor:pointer;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.28);white-space:nowrap}' +
      'button:hover{background:#4338ca}button:focus-visible{outline:2px solid #fff;outline-offset:1px}' +
      'i{width:10px;height:10px;border-radius:3px;background:#fff;opacity:.9}';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Create a Trailcard flashcard from the highlighted text';
    btn.append(document.createElement('i'), 'Flashcard');
    // Keep the page's selection alive when the chip is pressed.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      send({ type: 'create-from-selection', text: chipText });
      hideChip();
    });
    root.append(style, btn);
    document.documentElement.append(host);
    return host;
  }

  function hideChip() {
    if (chip) chip.style.display = 'none';
  }

  function showChip() {
    if (!chipEnabled || !chrome.runtime?.id) return hideChip();
    const found = currentSelection();
    if (!found) return hideChip();
    chip ||= buildChip();
    chipText = found.text;
    const { rect } = found;
    const below = rect.bottom + 8;
    const top = below + 34 > innerHeight ? Math.max(4, rect.top - 38) : below;
    const left = Math.min(Math.max(8, rect.right - 48), innerWidth - 120);
    chip.style.top = `${top}px`;
    chip.style.left = `${left}px`;
    chip.style.display = 'block';
  }

  document.addEventListener('mouseup', (e) => {
    if (chip && e.composedPath().includes(chip)) return;
    setTimeout(showChip, 10);
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') hideChip();
    else if (e.shiftKey || e.key === 'Shift') setTimeout(showChip, 10);
  });
  document.addEventListener('selectionchange', () => {
    if (getSelection()?.isCollapsed) hideChip();
  });
  document.addEventListener('scroll', hideChip, true);

  document.addEventListener('copy', () => {
    const text = String(getSelection()).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (text.length > 2) send({ type: 'copy', text });
  });
})();

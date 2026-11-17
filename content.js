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

  document.addEventListener('copy', () => {
    const text = String(getSelection()).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (text.length > 2) send({ type: 'copy', text });
  });
})();

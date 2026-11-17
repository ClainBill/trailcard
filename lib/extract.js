// Injected into the active tab with chrome.scripting.executeScript, so it must
// be fully self-contained: no imports, no references to outer scope.
export function extractPage() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const meta = (sel) => document.querySelector(sel)?.getAttribute('content') || '';
  const isHttp = (u) => /^https?:\/\//.test(u || '');

  const root =
    document.querySelector('article, main, [role="main"], #mw-content-text, #content') || document.body;

  const infobox = [];
  for (const row of document.querySelectorAll('table.infobox tr, .infobox tr')) {
    const th = row.querySelector('th');
    const td = row.querySelector('td');
    if (th && td) infobox.push([clean(th.innerText).slice(0, 60), clean(td.innerText).slice(0, 240)]);
    if (infobox.length >= 30) break;
  }

  const headings = [...root.querySelectorAll('h1, h2')]
    .map((h) => clean(h.innerText))
    .filter(Boolean)
    .slice(0, 14);

  const seen = new Set();
  const images = [];
  const add = (src, alt, area) => {
    if (!isHttp(src) || seen.has(src)) return;
    seen.add(src);
    images.push({ src, alt: clean(alt).slice(0, 140), area });
  };
  const og = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]');
  if (og) add(new URL(og, location.href).href, document.title, Infinity);
  for (const img of document.images) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w < 120 || h < 120 || w / h > 4 || h / w > 4) continue;
    const rect = img.getBoundingClientRect();
    if (rect.width < 60 || rect.height < 60) continue;
    const caption = img.closest('figure')?.querySelector('figcaption')?.innerText;
    add(img.currentSrc || img.src, caption || img.alt, rect.width * rect.height);
  }
  images.sort((a, b) => b.area - a.area);

  return {
    url: location.href,
    title: document.title,
    lang: document.documentElement.lang || '',
    selection: clean(String(getSelection())).slice(0, 1500),
    description: clean(meta('meta[property="og:description"]') || meta('meta[name="description"]')).slice(0, 400),
    headings,
    infobox,
    text: clean(root.innerText).slice(0, 9000),
    images: images.slice(0, 8).map(({ src, alt }) => ({ src, alt })),
  };
}

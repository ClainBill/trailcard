// Helpers for turning raw browsing events into a "trail" the card builder can read.

const SEARCH_ENGINES = [
  { name: 'Google', host: /(^|\.)google\.[a-z.]+$/, path: /^\/search/, param: 'q' },
  { name: 'Bing', host: /(^|\.)bing\.com$/, path: /^\/search/, param: 'q' },
  { name: 'DuckDuckGo', host: /(^|\.)duckduckgo\.com$/, path: /^\/$/, param: 'q' },
  { name: 'Yahoo', host: /search\.yahoo\.com$/, path: /^\/search/, param: 'p' },
  { name: 'Brave', host: /search\.brave\.com$/, path: /^\/search/, param: 'q' },
  { name: 'Kagi', host: /(^|\.)kagi\.com$/, path: /^\/search/, param: 'q' },
  { name: 'Ecosia', host: /(^|\.)ecosia\.org$/, path: /^\/search/, param: 'q' },
  { name: 'YouTube', host: /(^|\.)youtube\.com$/, path: /^\/results/, param: 'search_query' },
  { name: 'Wikipedia', host: /(^|\.)wikipedia\.org$/, path: /^\/w\/index\.php/, param: 'search' },
  { name: 'IMDb', host: /(^|\.)imdb\.com$/, path: /^\/find/, param: 'q' },
  { name: 'Amazon', host: /(^|\.)amazon\.[a-z.]+$/, path: /^\/s/, param: 'k' },
];

export function parseSearch(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  for (const e of SEARCH_ENGINES) {
    if (e.host.test(u.hostname) && e.path.test(u.pathname)) {
      const query = (u.searchParams.get(e.param) || '').trim();
      if (query) return { engine: e.name, query };
    }
  }
  return null;
}

export function isTrackable(url, settings) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return !(settings.blocklist || []).some((p) => p.trim() && host.includes(p.trim().toLowerCase()));
}

// Query strings can carry tokens and personal data, so they never leave the device.
export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return '';
  }
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Events inside the context window, plus the last few regardless of age so a
// long read of a single page still has its lead-up.
export function selectTrail(events, windowMinutes, now = Date.now()) {
  const cutoff = now - windowMinutes * 60_000;
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const tail = sorted.slice(-5);
  const inWindow = sorted.filter((e) => e.ts >= cutoff);
  const merged = [...new Map([...tail, ...inWindow].map((e) => [e.id, e])).values()];
  return merged.sort((a, b) => a.ts - b.ts).slice(-40);
}

// Compact form sent to the model.
export function trailForPrompt(trail, now = Date.now()) {
  return trail.map((e) => {
    const out = { minutes_ago: Math.round((now - e.ts) / 60_000) };
    if (e.kind === 'copy') return { ...out, action: 'copied_text', text: e.text, page: e.title };
    if (e.search) {
      return { ...out, action: 'search', engine: e.search.engine, query: e.search.query };
    }
    out.action = 'visit';
    out.title = e.title;
    out.url = safeUrl(e.url);
    if (e.via) out.clicked_link_text = e.via;
    if (e.dwellMs > 3000) out.seconds_on_page = Math.round(e.dwellMs / 1000);
    return out;
  });
}

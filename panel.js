import { EXT, get, getSettings, saveSettings, getNotes, saveNote, onStoreChange } from './lib/store.js';
import { selectTrail, trailForPrompt, isTrackable, hostOf } from './lib/trail.js';
import { suggestCard } from './lib/ai.js';
import { draftFromAI, heuristicDraft, noteFromDraft } from './lib/cards.js';
import { extractPage } from './lib/extract.js';
import { renderEditor } from './lib/editor.js';
import { h, timeAgo, toDataUrl } from './lib/dom.js';
import { demoContext, demoSuggestion } from './lib/demo.js';

const view = document.getElementById('view');
let screen = 'home';
let ctx = null; // context captured for the card being created

function openApp(hash) {
  const url = EXT ? chrome.runtime.getURL(`app.html#${hash}`) : `app.html#${hash}`;
  if (EXT) chrome.tabs.create({ url });
  else window.open(url, '_blank');
}
document.getElementById('open-guide').onclick = () => openApp('guide');
document.getElementById('open-library').onclick = () => openApp('library');
document.getElementById('open-settings').onclick = () => openApp('settings');

// fresh = ask the background worker to bring time-on-page up to date first.
// That writes to storage, so only the create flow uses it: doing it from the
// home screen would re-trigger the home screen's own storage listener forever.
async function loadEvents(fresh = false) {
  if (!EXT) return demoContext().events;
  if (!fresh) return get('events', []);
  try {
    return (await chrome.runtime.sendMessage({ type: 'get-trail' })).events;
  } catch {
    return get('events', []);
  }
}

// ---------- Home ----------

function trailItem(e) {
  if (e.kind === 'copy') {
    return h('li', { class: 'trail-item' }, h('span', { class: 'trail-kind' }, 'Copied'), h('span', { class: 'trail-text' }, `“${e.text}”`));
  }
  if (e.search) {
    return h('li', { class: 'trail-item' }, h('span', { class: 'trail-kind search' }, 'Search'), h('span', { class: 'trail-text' }, e.search.query));
  }
  return h(
    'li',
    { class: 'trail-item' },
    h('span', { class: 'trail-kind' }, hostOf(e.url)),
    h('span', { class: 'trail-text' }, e.title),
    h('span', { class: 'trail-time' }, timeAgo(e.ts))
  );
}

let refresh;
let flashUntil = 0;
let flashText = '';

async function home(message) {
  screen = 'home';
  if (message) {
    flashText = message;
    flashUntil = Date.now() + 8000;
  }
  const flash = Date.now() < flashUntil ? flashText : '';
  const [settings, notes, events] = await Promise.all([getSettings(), getNotes(), loadEvents()]);
  if (screen !== 'home') return;
  const now = Date.now();
  const due = notes.filter((n) => n.srs.due <= now).length;
  const trail = selectTrail(events, settings.windowMinutes).reverse().slice(0, 8);

  view.replaceChildren(
    flash && h('div', { class: 'flash', role: 'status' }, flash),
    !settings.tourSeen &&
      h(
        'div',
        { class: 'notice tour-invite' },
        h('span', null, 'New here? See how Trailcard works in about a minute.'),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn small primary', onclick: () => openApp('guide') }, 'Take the tour'),
          h(
            'button',
            {
              class: 'btn small',
              onclick: async () => {
                await saveSettings({ tourSeen: true });
                home();
              },
            },
            'No thanks'
          )
        )
      ),
    h(
      'section',
      { class: 'hero' },
      h('button', { class: 'btn primary big', id: 'create', onclick: () => create() }, 'Create Flashcard'),
      h('p', { class: 'hint center' }, 'Builds a card from this page and what led you here.')
    ),
    h(
      'section',
      { class: 'tile review-tile' },
      h('div', null, h('div', { class: 'tile-num' }, String(due)), h('div', { class: 'tile-label' }, due === 1 ? 'card due' : 'cards due')),
      h(
        'button',
        { class: 'btn', onclick: () => openApp(due ? 'review' : 'practice'), disabled: !notes.length },
        due ? 'Review now' : notes.length ? 'Review ahead' : 'No cards yet'
      )
    ),
    h(
      'section',
      null,
      h(
        'div',
        { class: 'section-head' },
        h('h2', null, 'Recent trail'),
        h(
          'label',
          { class: 'toggle' },
          h('input', {
            type: 'checkbox',
            checked: !settings.paused,
            onchange: async (e) => {
              await saveSettings({ paused: !e.target.checked });
              home();
            },
          }),
          settings.paused ? 'Paused' : 'Tracking'
        )
      ),
      settings.paused
        ? h('p', { class: 'hint' }, 'Tracking is paused. Nothing you browse is recorded until you turn it back on.')
        : trail.length
          ? h('ul', { class: 'trail' }, trail.map(trailItem))
          : h('p', { class: 'hint' }, 'Nothing yet. Search for something or open a page and it will show up here.'),
      h('p', { class: 'hint privacy' }, 'Your trail stays on this device and clears after 24 hours. It is only sent to Claude when you click Create Flashcard.')
    )
  );
}

// ---------- Create ----------

async function gatherContext(tabId) {
  const settings = await getSettings();
  if (!EXT) {
    const demo = demoContext();
    return finishContext(settings, demo.events, demo.page);
  }
  // ?tab=<id> pins the panel to a tab, for when it is opened as an ordinary page (tests).
  const pinned = tabId || Number(new URLSearchParams(location.search).get('tab'));
  const [tab] = pinned ? [await chrome.tabs.get(pinned)] : await chrome.tabs.query({ active: true, currentWindow: true });
  const events = await loadEvents(true);
  const readable = tab?.url && /^https?:/.test(tab.url);
  if (readable && !isTrackable(tab.url, settings)) {
    const err = new Error(`${hostOf(tab.url)} is on your blocklist, so Trailcard won't read it. You can change that in Settings.`);
    err.blocked = true;
    throw err;
  }
  let page = { url: readable ? tab.url : '', title: tab?.title || '', images: [] };
  if (readable) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
      if (result) page = result;
    } catch {
      /* some pages (web store, PDFs) can't be scripted: fall back to title + trail */
    }
  }
  return finishContext(settings, events, page);
}

function finishContext(settings, events, page) {
  const trail = selectTrail(events, settings.windowMinutes);
  const images = [];
  const seen = new Set();
  const add = (src, alt, from) => {
    if (!src || seen.has(src)) return;
    seen.add(src);
    images.push({ src, alt, from });
  };
  for (const img of page.images || []) add(img.src, img.alt, 'current page');
  for (const e of [...trail].reverse()) if (e.image) add(e.image, e.title, `earlier page: ${e.title}`);
  return { trail, page, images: images.slice(0, 12) };
}

function loading(message) {
  screen = 'loading';
  clearTimeout(refresh);
  view.replaceChildren(
    h('div', { class: 'loading' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, message))
  );
}

// highlight: { tabId, text } when the card was started from highlighted text.
async function create(hint, highlight) {
  loading(hint ? 'Rethinking the card…' : highlight ? 'Reading your highlight…' : 'Reading your trail…');
  const settings = await getSettings();
  let draft;
  let notice = '';
  try {
    if (!ctx || hint === undefined) {
      ctx = await gatherContext(highlight?.tabId);
      if (highlight) {
        ctx.page.selection = highlight.text;
        ctx.fromSelection = true;
      }
    }
  } catch (e) {
    ctx = null;
    return problem(e.message || 'Could not read this page.');
  }

  try {
    let out;
    if (!EXT && !settings.apiKey) {
      await new Promise((r) => setTimeout(r, 500));
      out = demoSuggestion;
    } else {
      loading(hint ? 'Rethinking the card…' : ctx.fromSelection ? 'Building a card from your highlight…' : 'Working out what you want to remember…');
      out = await suggestCard({ settings, ...ctx, hint });
    }
    draft = draftFromAI(out, ctx.images);
  } catch (e) {
    draft = heuristicDraft(ctx.page, ctx.trail, ctx.images);
    notice =
      e.kind === 'no-key'
        ? 'Add a Claude API key in Settings to get cards built from your whole trail. This one is a basic card from the page.'
        : `${e.message} Here is a basic card from the page instead.`;
  }
  editor(draft, notice);
}

function problem(message) {
  screen = 'problem';
  view.replaceChildren(
    h('div', { class: 'empty' }, h('p', null, message), h('button', { class: 'btn', onclick: () => home() }, 'Back'))
  );
}

function editor(draft, notice) {
  screen = 'editor';
  const mount = h('div');
  view.replaceChildren(
    h('h2', { class: 'screen-title' }, 'New flashcard'),
    notice &&
      h(
        'div',
        { class: 'notice' },
        notice,
        ' ',
        h('button', { class: 'link', onclick: () => openApp('settings') }, 'Open Settings')
      ),
    mount
  );
  renderEditor(mount, {
    draft,
    images: ctx.images,
    onCancel: () => {
      ctx = null;
      home();
    },
    onRegenerate: (hint) => create(hint),
    onSave: async (clean) => {
      for (const f of clean.fields) if (f.type === 'image') f.value = await toDataUrl(f.value);
      // Kept with the card so later questions can follow the same interest.
      const context = {
        summary: draft.summary || '',
        trail: trailForPrompt(ctx.trail),
        selected_text: ctx.page.selection || '',
        page_excerpt: (ctx.page.text || '').slice(0, 4000),
      };
      await saveNote(noteFromDraft(clean, { url: ctx.page.url, title: ctx.page.title }, Date.now(), context));
      ctx = null;
      home('Card saved. It is ready in your review queue.');
    },
  });
}

// Keep the home screen live as the user browses, without disturbing an edit.
onStoreChange(() => {
  if (screen !== 'home') return;
  clearTimeout(refresh);
  refresh = setTimeout(() => screen === 'home' && home(), 400);
});

// A highlight sent from a page (the Flashcard chip or the right-click menu).
async function checkPending() {
  if (!EXT) return false;
  const { pending } = await chrome.storage.session.get('pending');
  if (!pending) return false;
  // With several windows open, only the panel in the highlight's own window takes it.
  try {
    const [tab, win] = await Promise.all([chrome.tabs.get(pending.tabId), chrome.windows.getCurrent()]);
    if (tab.windowId !== win.id) return false;
  } catch {
    /* the tab is gone; fall through and clear the stale highlight */
  }
  await chrome.storage.session.remove('pending');
  if (Date.now() - pending.ts > 60_000) return false;
  create(undefined, pending);
  return true;
}

if (EXT) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.pending?.newValue) checkPending();
  });
}

checkPending().then((started) => started || home());

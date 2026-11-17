import { get, set, getSettings, getNotes, isNoteKey } from './lib/store.js';
import { parseSearch, isTrackable } from './lib/trail.js';

const MAX_EVENTS = 400;
const MAX_AGE = 24 * 3600_000;
const DWELL_CAP = 10 * 60_000; // one stretch of attention never counts for more than this
const CLICK_TTL = 20_000;

// The worker handles events concurrently; every read-modify-write goes through
// this queue so they can't interleave.
let chain = Promise.resolve();
const serial = (fn) => {
  const run = chain.then(fn);
  chain = run.catch((err) => console.warn('[trailcard]', err));
  return run;
};

const session = {
  get: async (key, fallback) => (await chrome.storage.session.get(key))[key] ?? fallback,
  set: (key, value) => chrome.storage.session.set({ [key]: value }),
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function flushDwell(events, now) {
  const active = await session.get('active', null);
  if (!active) return;
  const ev = events.find((e) => e.id === active.id);
  if (ev) ev.dwellMs = (ev.dwellMs || 0) + Math.min(now - active.since, DWELL_CAP);
  await session.set('active', { id: active.id, since: now });
}

async function setActive(events, id, now) {
  await flushDwell(events, now);
  await session.set('active', id ? { id, since: now } : null);
}

const latestVisit = (events, tabId) =>
  events.findLast((e) => e.tabId === tabId && e.kind === 'visit');

function prune(events, now) {
  return events.filter((e) => now - e.ts < MAX_AGE).slice(-MAX_EVENTS);
}

async function recordVisit(tab) {
  if (!tab?.url) return null;
  const settings = await getSettings();
  const now = Date.now();
  const events = await get('events', []);

  if (settings.paused || !isTrackable(tab.url, settings)) {
    if (tab.active) await setActive(events, null, now);
    await set('events', events);
    return null;
  }

  let ev = latestVisit(events, tab.id);
  if (ev && ev.url === tab.url) {
    if (tab.title) ev.title = tab.title;
  } else {
    ev = {
      id: uid(),
      kind: 'visit',
      ts: now,
      tabId: tab.id,
      url: tab.url,
      title: tab.title || tab.url,
      dwellMs: 0,
    };
    const search = parseSearch(tab.url);
    if (search) ev.search = search;
    const clicks = await session.get('clicks', {});
    const click = clicks[tab.id] ?? clicks[tab.openerTabId];
    if (click && now - click.ts < CLICK_TTL) ev.via = click.text;
    events.push(ev);
  }
  if (tab.active) await setActive(events, ev.id, now);
  await set('events', prune(events, now));
  return ev;
}

async function focusTab(tabId) {
  const events = await get('events', []);
  const ev = tabId == null ? null : latestVisit(events, tabId);
  await setActive(events, ev?.id ?? null, Date.now());
  await set('events', events);
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.title || change.status === 'complete') serial(() => recordVisit(tab));
});

chrome.tabs.onActivated.addListener(({ tabId }) => serial(() => focusTab(tabId)));

chrome.windows.onFocusChanged.addListener((windowId) =>
  serial(async () => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return focusTab(null);
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    return focusTab(tab?.id ?? null);
  })
);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tab = sender.tab;

  if (msg.type === 'get-trail') {
    serial(async () => {
      const events = await get('events', []);
      await flushDwell(events, Date.now());
      await set('events', events);
      return events;
    }).then((events) => sendResponse({ events }), () => sendResponse({ events: [] }));
    return true;
  }

  if (!tab) return;

  if (msg.type === 'create-from-selection') {
    startFromSelection(tab, msg.text);
    return;
  }

  if (msg.type === 'link-click') {
    serial(async () => {
      const clicks = await session.get('clicks', {});
      clicks[tab.id] = { text: msg.text, ts: Date.now() };
      await session.set('clicks', clicks);
    });
  } else if (msg.type === 'page-meta') {
    serial(async () => {
      const ev = await recordVisit(tab);
      if (!ev || (!msg.image && !msg.description)) return;
      const events = await get('events', []);
      const stored = events.find((e) => e.id === ev.id);
      if (!stored) return;
      if (msg.image) stored.image = msg.image;
      if (msg.description) stored.description = msg.description;
      await set('events', events);
    });
  } else if (msg.type === 'copy') {
    serial(async () => {
      const settings = await getSettings();
      if (settings.paused || !isTrackable(tab.url, settings)) return;
      const now = Date.now();
      const events = await get('events', []);
      events.push({ id: uid(), kind: 'copy', ts: now, tabId: tab.id, url: tab.url, title: tab.title, text: msg.text });
      await set('events', prune(events, now));
    });
  }
});

// Opens the side panel and leaves the highlighted text for it to pick up.
// sidePanel.open must run straight from the user's click, so nothing is awaited first.
function startFromSelection(tab, text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  if (clean) session.set('pending', { tabId: tab.id, text: clean, ts: Date.now() });
  try {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  } catch {
    /* the panel could not be opened from here; the highlight waits for it */
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'tc-selection' && tab) startFromSelection(tab, info.selectionText);
});

async function updateBadge() {
  const now = Date.now();
  const due = (await getNotes()).filter((n) => n.srs.due <= now).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
  await chrome.action.setBadgeText({ text: due ? String(due) : '' });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some(isNoteKey)) updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => alarm.name === 'badge' && updateBadge());

function init() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.alarms.create('badge', { periodInMinutes: 15 });
  chrome.contextMenus.removeAll(() =>
    chrome.contextMenus.create({ id: 'tc-selection', title: 'Create flashcard from “%s”', contexts: ['selection'] })
  );
  updateBadge();
}

chrome.runtime.onInstalled.addListener(init);

// First install only: open the guided tour.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('app.html#guide') });
});
chrome.runtime.onStartup.addListener(init);

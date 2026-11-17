// Storage layer. Uses chrome.storage.local inside the extension and falls back
// to localStorage when the pages are opened outside it (preview / demo mode).

export const EXT = !!globalThis.chrome?.runtime?.id;
const NOTE_PREFIX = 'n:';

export const DEFAULT_SETTINGS = {
  provider: 'auto',
  ollamaModel: '',
  ollamaUrl: 'http://localhost:11434',
  apiKey: '',
  model: 'claude-opus-5-5',
  autoGrow: false,
  tourSeen: false,
  selectionChip: true,
  paused: false,
  windowMinutes: 30,
  retention: 0.9,
  blocklist: [
    'mail.google.com',
    'accounts.google.com',
    'outlook.',
    'paypal.com',
    'bank',
    '1password.com',
    'lastpass.com',
    'bitwarden.com',
  ],
};

export async function get(key, fallback) {
  if (EXT) {
    const out = await chrome.storage.local.get(key);
    return out[key] ?? fallback;
  }
  const raw = localStorage.getItem(key);
  return raw == null ? fallback : JSON.parse(raw);
}

export async function set(key, value) {
  if (EXT) return chrome.storage.local.set({ [key]: value });
  localStorage.setItem(key, JSON.stringify(value));
}

export async function remove(key) {
  if (EXT) return chrome.storage.local.remove(key);
  localStorage.removeItem(key);
}

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await get('settings', {})) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await set('settings', next);
  return next;
}

// Each note lives under its own key so saving one card never rewrites the rest.
export async function getNotes() {
  let all;
  if (EXT) {
    all = await chrome.storage.local.get(null);
  } else {
    all = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(NOTE_PREFIX)) all[k] = JSON.parse(localStorage.getItem(k));
    }
  }
  return Object.entries(all)
    .filter(([k]) => k.startsWith(NOTE_PREFIX))
    .map(([, v]) => v)
    .sort((a, b) => b.created - a.created);
}

export const saveNote = (note) => set(NOTE_PREFIX + note.id, note);
export const deleteNote = (id) => remove(NOTE_PREFIX + id);
export const isNoteKey = (key) => key.startsWith(NOTE_PREFIX);

export function onStoreChange(fn) {
  if (EXT) chrome.storage.onChanged.addListener((changes, area) => area === 'local' && fn(Object.keys(changes)));
  else window.addEventListener('storage', (e) => fn([e.key]));
}

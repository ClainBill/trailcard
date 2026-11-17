import { get, set, getSettings, saveSettings, getNotes, saveNote, deleteNote, DEFAULT_SETTINGS } from './lib/store.js';
import { schedule, previewIntervals, formatInterval } from './lib/fsrs.js';
import { pickQuestion, recordAnswer, substitute, isMastered, applyGrowth, MAX_GROWTHS } from './lib/cards.js';
import { MODELS, PROVIDERS, OLLAMA_URL, growCard, chromeAIStatus, downloadChromeAI, ollamaStatus, resolveProvider } from './lib/ai.js';
import { renderEditor } from './lib/editor.js';
import { h, dueText, toDataUrl } from './lib/dom.js';
import { hostOf } from './lib/trail.js';
import { renderTutorial } from './lib/tutorial.js';

const view = document.getElementById('view');
let onKey = null;

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  onKey?.(e);
});

// ---------- Growing cards ----------

let toastTimer;
function toast(message) {
  let el = document.getElementById('toast');
  if (!el) document.body.append((el = h('div', { id: 'toast', class: 'toast', role: 'status' })));
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 6000);
}

// Asks the AI for more questions and appends them. Re-reads the note before
// saving so a review graded in the meantime is not overwritten.
async function grow(noteId) {
  const settings = await getSettings();
  const find = async () => (await getNotes()).find((n) => n.id === noteId);
  const { out } = await growCard({ settings, note: await find() });
  const fresh = await find();
  if (!fresh) return { added: 0 };
  const result = applyGrowth(fresh, out);
  if (result.added) await saveNote(result.note);
  return result;
}

const RETRY_GROW_AFTER = 24 * 3600_000;

function shouldAutoGrow(note, settings, now) {
  return (
    settings.autoGrow &&
    settings.provider !== 'none' &&
    (note.grown || 0) < MAX_GROWTHS &&
    now - (note.growTried || 0) > RETRY_GROW_AFTER &&
    isMastered(note)
  );
}

function route() {
  const [name, arg] = location.hash.slice(1).split('=');
  const practice = name === 'practice';
  const tab = practice ? 'review' : ['review', 'library', 'settings', 'guide'].includes(name) ? name : 'review';
  for (const a of document.querySelectorAll('.tabs a')) {
    a.classList.toggle('active', a.dataset.tab === tab);
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  onKey = null;
  if (practice) review({ ahead: true, id: arg });
  else ({ review, library, settings, guide })[tab]();
}
window.addEventListener('hashchange', route);

// ---------- Guide ----------

function guide() {
  saveSettings({ tourSeen: true });
  renderTutorial(view, {
    onOpenSettings: () => (location.hash = 'settings'),
    onFinish: () => (location.hash = 'review'),
  });
}

// ---------- Review ----------

const GRADES = [
  { grade: 1, label: 'Again', cls: 'again' },
  { grade: 2, label: 'Hard', cls: 'hard' },
  { grade: 3, label: 'Good', cls: 'good' },
  { grade: 4, label: 'Easy', cls: 'easy' },
];

// ahead: review cards before they are due (all of them soonest-first, or one by id).
// Grades still count. The scheduler allows for a card being reviewed early, so it
// gains little from an early pass and is simply rescheduled from today.
async function review({ ahead = false, id } = {}) {
  const settings = await getSettings();
  const all = await getNotes();
  const byDue = (a, b) => a.srs.due - b.srs.due;
  const queue = id
    ? all.filter((n) => n.id === id)
    : ahead
      ? [...all].sort(byDue)
      : all.filter((n) => n.srs.due <= Date.now()).sort(byDue);
  let done = 0;

  const field = (note, key) => note.fields.find((f) => f.key === key);

  function cues(note, keys) {
    const fields = keys.map((k) => field(note, k)).filter(Boolean);
    const images = fields.filter((f) => f.type === 'image');
    const texts = fields.filter((f) => f.type === 'text');
    return [
      images.length ? h('div', { class: 'cue-images' }, images.map((f) => h('img', { src: f.value, alt: f.label }))) : null,
      texts.length
        ? h('div', { class: 'cue-chips' }, texts.map((f) => h('span', { class: 'chip' }, h('b', null, f.label), ' ', f.value)))
        : null,
    ];
  }

  function finished() {
    onKey = null;
    const upcoming = all.map((n) => n.srs.due).filter((d) => d > Date.now()).sort((a, b) => a - b)[0];
    view.replaceChildren(
      h(
        'div',
        { class: 'empty' },
        h('h1', null, all.length ? 'All caught up' : 'No cards yet'),
        all.length
          ? h('p', null, done ? `You reviewed ${done} ${done === 1 ? 'card' : 'cards'}. ` : '', upcoming ? `Next card: ${dueText(upcoming).toLowerCase()}.` : '')
          : h('p', null, 'Open the Trailcard side panel on any page and click Create Flashcard. Your first card will show up here.'),
        all.length
          ? h(
              'div',
              { class: 'row' },
              h('button', { class: 'btn primary', onclick: () => review({ ahead: true }) }, 'Review ahead anyway'),
              h('a', { class: 'btn', href: '#library' }, 'Browse library')
            )
          : null,
        all.length ? h('p', { class: 'hint' }, 'Reviewing early still counts: each card is rescheduled from today.') : null
      )
    );
  }

  function show(note) {
    const { index, question } = pickQuestion(note);
    const intervals = previewIntervals(note.srs, Date.now(), settings.retention);
    let revealed = false;

    async function grade(g) {
      const now = Date.now();
      let next = recordAnswer(note, index, g);
      next = { ...next, srs: schedule(note.srs, g, now, settings.retention) };
      const growing = shouldAutoGrow(next, settings, now);
      if (growing) next.growTried = now;
      await saveNote(next);
      if (growing) {
        // Runs in the background; the review carries on.
        grow(next.id).then(
          ({ added }) => added && toast(`Mastered “${next.title}”. Added ${added} new ${added === 1 ? 'question' : 'questions'}; it comes back tomorrow.`),
          (e) => e.kind !== 'no-ai' && toast(`Could not add questions to “${next.title}”: ${e.message}`)
        );
      }
      Object.assign(all.find((n) => n.id === note.id) || {}, next);
      if (g === 1) queue.push(next); // missed cards come back before the session ends
      else done += 1;
      advance();
    }

    function render() {
      const answers = question.answerKeys.map((k) => field(note, k)).filter(Boolean);
      const total = done + queue.length + 1;
      view.replaceChildren(
        h(
          'div',
          { class: 'review' },
          h(
            'div',
            { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done },
            h('div', { class: 'progress-bar', style: `width:${(done / total) * 100}%` })
          ),
          h('div', { class: 'progress-text' }, ahead ? 'Reviewing ahead of schedule · ' : '', `${queue.length + 1} left`),
          h(
            'article',
            { class: 'card' },
            cues(note, question.cueKeys),
            h('h1', { class: 'prompt' }, substitute(question.prompt, note)),
            revealed
              ? [
                  h(
                    'div',
                    { class: 'answer' },
                    answers.map((f) =>
                      h('div', { class: 'answer-item' }, h('div', { class: 'answer-label' }, f.label), h('div', { class: 'answer-value' }, f.value))
                    )
                  ),
                  h(
                    'dl',
                    { class: 'facts' },
                    note.fields
                      .filter((f) => f.type === 'text' && !question.answerKeys.includes(f.key))
                      .map((f) => [h('dt', null, f.label), h('dd', null, f.value)])
                  ),
                  note.source?.url &&
                    h('a', { class: 'source', href: note.source.url, target: '_blank', rel: 'noreferrer' }, `From ${hostOf(note.source.url)}`),
                ]
              : null
          ),
          revealed
            ? h(
                'div',
                { class: 'grades' },
                GRADES.map(({ grade: g, label, cls }) =>
                  h(
                    'button',
                    { class: `grade ${cls}`, onclick: () => grade(g) },
                    h('span', { class: 'grade-label' }, label),
                    h('span', { class: 'grade-interval' }, formatInterval(intervals[g - 1])),
                    h('kbd', null, String(g))
                  )
                )
              )
            : h('button', { class: 'btn primary big reveal', onclick: reveal }, 'Show answer', h('kbd', null, 'Space'))
        )
      );
    }

    function reveal() {
      revealed = true;
      render();
    }

    onKey = (e) => {
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        reveal();
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        grade(Number(e.key));
      }
    };
    render();
  }

  function advance() {
    const note = queue.shift();
    if (note) show(note);
    else finished();
  }
  advance();
}

// ---------- Library ----------

async function library() {
  let notes = await getNotes();
  let query = '';
  let openId = null;
  let editingId = null;
  let confirmId = null;
  let growingId = null;
  const list = h('div', { class: 'library-list' });

  const matches = (n) => {
    if (!query) return true;
    const hay = [n.title, ...(n.tags || []), ...n.fields.filter((f) => f.type === 'text').flatMap((f) => [f.label, f.value])]
      .join(' ')
      .toLowerCase();
    return query.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  };

  function item(n) {
    const thumb = n.fields.find((f) => f.type === 'image');
    const open = openId === n.id;
    if (editingId === n.id) {
      const mount = h('div', { class: 'library-item editing' });
      renderEditor(mount, {
        draft: structuredClone({ title: n.title, tags: n.tags, fields: n.fields, questions: n.questions }),
        saveLabel: 'Save changes',
        onCancel: () => {
          editingId = null;
          renderList();
        },
        onSave: async (clean) => {
          for (const f of clean.fields) if (f.type === 'image') f.value = await toDataUrl(f.value);
          const changed = JSON.stringify(clean.questions) !== JSON.stringify(n.questions);
          const next = { ...n, title: clean.title, fields: clean.fields, questions: clean.questions };
          if (changed) Object.assign(next, { qstats: {}, lastQ: -1 });
          await saveNote(next);
          notes = notes.map((x) => (x.id === n.id ? next : x));
          editingId = null;
          renderList();
        },
      });
      return mount;
    }
    return h(
      'div',
      { class: 'library-item' + (open ? ' open' : '') },
      h(
        'button',
        {
          class: 'library-row',
          'aria-expanded': String(open),
          onclick: () => {
            openId = open ? null : n.id;
            confirmId = null;
            renderList();
          },
        },
        thumb ? h('img', { class: 'thumb', src: thumb.value, alt: '' }) : h('div', { class: 'thumb empty' }),
        h(
          'div',
          { class: 'library-main' },
          h('div', { class: 'library-title' }, n.title),
          h('div', { class: 'library-sub' }, n.fields.filter((f) => f.type === 'text').map((f) => f.value).join(' · '))
        ),
        h('div', { class: 'library-due' + (n.srs.due <= Date.now() ? ' is-due' : '') }, dueText(n.srs.due))
      ),
      open &&
        h(
          'div',
          { class: 'library-detail' },
          h(
            'dl',
            { class: 'facts' },
            n.fields.filter((f) => f.type === 'text').map((f) => [h('dt', null, f.label), h('dd', null, f.value)])
          ),
          h('p', { class: 'hint' }, `${n.questions.length} quiz questions · reviewed ${n.srs.reps} times`, n.source?.url ? ` · from ${hostOf(n.source.url)}` : ''),
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn small primary', onclick: () => (location.hash = `practice=${n.id}`) }, 'Review now'),
            h(
              'button',
              {
                class: 'btn small',
                disabled: growingId === n.id,
                title: 'Ask the AI for up to 3 more questions on this topic',
                onclick: async () => {
                  growingId = n.id;
                  renderList();
                  try {
                    const { added, note } = await grow(n.id);
                    if (added) notes = notes.map((x) => (x.id === n.id ? note : x));
                    toast(added ? `Added ${added} new ${added === 1 ? 'question' : 'questions'}.` : 'Claude had nothing solid to add to this card.');
                  } catch (e) {
                    toast(e.kind === 'no-ai' || e.kind === 'off' ? 'Set up an AI option in Settings first.' : e.message);
                  }
                  growingId = null;
                  renderList();
                },
              },
              growingId === n.id ? 'Adding…' : 'Add questions'
            ),
            h(
              'button',
              {
                class: 'btn small',
                onclick: () => {
                  editingId = n.id;
                  renderList();
                },
              },
              'Edit'
            ),
            confirmId === n.id
              ? h(
                  'button',
                  {
                    class: 'btn small danger',
                    onclick: async () => {
                      await deleteNote(n.id);
                      notes = notes.filter((x) => x.id !== n.id);
                      renderList();
                    },
                  },
                  'Delete permanently'
                )
              : h(
                  'button',
                  {
                    class: 'btn small',
                    onclick: () => {
                      confirmId = n.id;
                      renderList();
                    },
                  },
                  'Delete'
                )
          )
        )
    );
  }

  function renderList() {
    const shown = notes.filter(matches);
    list.replaceChildren(
      ...(shown.length
        ? shown.map(item)
        : [h('p', { class: 'hint' }, notes.length ? 'No cards match that search.' : 'No cards yet. Create one from the side panel on any page.')])
    );
  }

  view.replaceChildren(
    h(
      'div',
      { class: 'page' },
      h(
        'div',
        { class: 'section-head' },
        h('h1', null, `Library`),
        h('span', { class: 'hint' }, `${notes.length} ${notes.length === 1 ? 'card' : 'cards'}`)
      ),
      h('input', {
        class: 'input',
        type: 'search',
        placeholder: 'Search cards',
        'aria-label': 'Search cards',
        oninput: (e) => {
          query = e.target.value.trim();
          renderList();
        },
      }),
      list
    )
  );
  renderList();
}

// ---------- Settings ----------

async function settings() {
  let s = await getSettings();
  const status = h('span', { class: 'hint', role: 'status' });
  let timer;
  const save = async (patch) => {
    s = await saveSettings(patch);
    status.textContent = 'Saved';
    clearTimeout(timer);
    timer = setTimeout(() => (status.textContent = ''), 1500);
  };

  const row = (label, hint, control) =>
    h('label', { class: 'setting' }, h('div', null, h('div', { class: 'setting-label' }, label), hint && h('div', { class: 'hint' }, hint)), control);

  async function exportCards() {
    const blob = new Blob([JSON.stringify({ trailcard: 1, notes: await getNotes() }, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `trailcard-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importCards(file) {
    try {
      const data = JSON.parse(await file.text());
      const notes = (data.notes || []).filter((n) => n?.id && Array.isArray(n.fields) && n.srs);
      for (const n of notes) await saveNote(n);
      status.textContent = `Imported ${notes.length} cards`;
    } catch {
      status.textContent = 'That file could not be read as a Trailcard export.';
    }
  }

  // ----- AI provider section -----
  const aiSection = h('div', { class: 'ai-section' });
  const extId = globalThis.chrome?.runtime?.id || '<extension id>';
  const code = (text) =>
    h('div', { class: 'code-row' }, h('code', null, text), h('button', { class: 'btn small', onclick: () => navigator.clipboard?.writeText(text).then(() => (status.textContent = 'Copied')) }, 'Copy'));
  const badge = (ok, text) => h('span', { class: 'badge ' + (ok ? 'ok' : 'off') }, text);

  async function renderAI() {
    const [chrome, ollama, active] = await Promise.all([chromeAIStatus(), ollamaStatus(s.ollamaUrl || OLLAMA_URL), resolveProvider(s)]);
    const p = s.provider || 'auto';

    const chromeCard = h(
      'div',
      { class: 'ai-card' },
      h('div', { class: 'ai-card-head' }, h('b', null, 'Chrome built-in AI'), badge(chrome === 'available', { available: 'Ready', downloadable: 'Needs download', downloading: 'Downloading', unavailable: 'Not supported here', unsupported: 'Not in this Chrome' }[chrome])),
      h('p', { class: 'hint' }, 'Free and private: a small model that Chrome runs on your computer. No install, but it needs a capable machine (Google lists 16 GB of RAM, or a graphics chip with more than 4 GB, plus 22 GB of free disk).'),
      chrome === 'downloadable' || chrome === 'downloading'
        ? h(
            'div',
            { class: 'row' },
            h(
              'button',
              {
                class: 'btn small primary',
                onclick: async (e) => {
                  const btn = e.currentTarget;
                  btn.disabled = true;
                  btn.textContent = 'Starting download…';
                  try {
                    await downloadChromeAI((f) => (btn.textContent = `Downloading… ${Math.round(f * 100)}%`));
                    renderAI();
                  } catch (err) {
                    btn.textContent = 'Download failed: ' + (err?.message || err);
                  }
                },
              },
              chrome === 'downloading' ? 'Resume download' : 'Download the model (one-off, a few GB)'
            )
          )
        : chrome === 'unavailable' || chrome === 'unsupported'
          ? h('p', { class: 'hint' }, 'This computer or Chrome version can’t run it. Use Ollama below instead.')
          : null
    );

    const ollamaBody = !ollama.running
      ? [
          h('p', { class: 'hint' }, 'Free and private: a model that runs on your computer through the Ollama app. One-time setup, about five minutes:'),
          h(
            'ol',
            { class: 'setup-steps' },
            h('li', null, 'Install Ollama from ', h('a', { href: 'https://ollama.com/download', target: '_blank', rel: 'noreferrer' }, 'ollama.com/download'), ' and open it.'),
            h('li', null, 'In Terminal, allow Trailcard to talk to it, then quit and reopen Ollama:', code(`launchctl setenv OLLAMA_ORIGINS "chrome-extension://${extId}"`)),
            h('li', null, 'Download a small model (about 3 GB):', code('ollama pull gemma3:4b')),
            h('li', null, 'Come back here and click Check again.')
          ),
        ]
      : ollama.origin === false
        ? [
            h('p', { class: 'hint' }, 'Ollama is running but is blocking Trailcard. Run this in Terminal, then quit and reopen Ollama:'),
            code(`launchctl setenv OLLAMA_ORIGINS "chrome-extension://${extId}"`),
          ]
        : !ollama.models.length
          ? [h('p', { class: 'hint' }, 'Ollama is running but has no models. Download a small one in Terminal (about 3 GB):'), code('ollama pull gemma3:4b')]
          : [
              h('p', { class: 'hint' }, 'Free and private. Pick which installed model drafts your cards; bigger models write better cards but are slower.'),
              h(
                'select',
                { class: 'input', 'aria-label': 'Ollama model', onchange: (e) => save({ ollamaModel: e.target.value }) },
                ollama.models.map((m) => h('option', { value: m, selected: m === (ollama.models.includes(s.ollamaModel) ? s.ollamaModel : ollama.models[0]) }, m))
              ),
            ];
    const ollamaReady = ollama.running && ollama.origin !== false && ollama.models.length > 0;
    const ollamaCard = h(
      'div',
      { class: 'ai-card' },
      h('div', { class: 'ai-card-head' }, h('b', null, 'Ollama on this computer'), badge(ollamaReady, ollamaReady ? 'Ready' : !ollama.running ? 'Not running' : ollama.origin === false ? 'Blocked' : 'No model')),
      ollamaBody
    );

    const claudeCard = h(
      'div',
      { class: 'ai-card' },
      h('div', { class: 'ai-card-head' }, h('b', null, 'Claude API'), badge(!!s.apiKey, s.apiKey ? 'Key added' : 'No key')),
      h('p', { class: 'hint' }, 'The best cards, but paid: each card is one request billed to your Anthropic account. Only used when you pick it above.'),
      h('input', { class: 'input', type: 'password', value: s.apiKey, placeholder: 'Claude API key (sk-ant-…)', 'aria-label': 'Claude API key', autocomplete: 'off', onchange: (e) => save({ apiKey: e.target.value.trim() }).then(renderAI) }),
      h('select', { class: 'input', 'aria-label': 'Claude model', onchange: (e) => save({ model: e.target.value }) }, MODELS.map((m) => h('option', { value: m.id, selected: m.id === s.model }, m.label)))
    );

    const activeText = active
      ? `New cards are drafted by ${{ chrome: 'Chrome’s built-in AI (free)', ollama: 'Ollama (free)', claude: 'Claude (paid)' }[active]}.`
      : p === 'none'
        ? 'AI drafting is off: new cards are basic cards from the page.'
        : p === 'auto'
          ? 'No free AI is set up yet, so new cards are basic cards from the page. Set one up below.'
          : 'The option you picked isn’t ready yet; until it is, new cards are basic cards from the page.';

    aiSection.replaceChildren(
      row(
        'Who drafts your cards',
        'Automatic uses whichever free option below is ready and never the paid one.',
        h('select', { class: 'input', onchange: (e) => save({ provider: e.target.value }).then(renderAI) }, PROVIDERS.map((o) => h('option', { value: o.id, selected: o.id === p }, o.label)))
      ),
      h('div', { class: 'notice ai-active', role: 'status' }, activeText, ' ', h('button', { class: 'link', onclick: renderAI }, 'Check again')),
      chromeCard,
      ollamaCard,
      claudeCard
    );
  }
  renderAI();

  view.replaceChildren(
    h(
      'div',
      { class: 'page' },
      h('div', { class: 'section-head' }, h('h1', null, 'Settings'), status),

      h('h2', null, 'Card drafting'),
      aiSection,
      row(
        'Context window',
        'How far back in your trail to look when building a card.',
        h(
          'select',
          { class: 'input', onchange: (e) => save({ windowMinutes: Number(e.target.value) }) },
          [10, 30, 60, 180].map((m) => h('option', { value: m, selected: m === s.windowMinutes }, m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`))
        )
      ),

      row(
        'Flashcard button on highlighted text',
        'Shows a small Flashcard button when you highlight text on a page. You can also right-click a highlight and choose “Create flashcard”.',
        h('input', { type: 'checkbox', checked: s.selectionChip, onchange: (e) => save({ selectionChip: e.target.checked }) })
      ),
      row(
        'Grow cards automatically',
        `When you have answered every question on a card correctly, the AI adds up to 3 new ones on the same topic, at most ${MAX_GROWTHS} times per card. Free with a free AI option; one paid request each time with Claude.`,
        h('input', { type: 'checkbox', checked: s.autoGrow, onchange: (e) => save({ autoGrow: e.target.checked }) })
      ),

      h('h2', null, 'Review'),
      row(
        'Target retention',
        'Higher means you forget less but review more often.',
        h(
          'select',
          { class: 'input', onchange: (e) => save({ retention: Number(e.target.value) }) },
          [0.8, 0.85, 0.9, 0.95].map((r) => h('option', { value: r, selected: r === s.retention }, `${Math.round(r * 100)}%`))
        )
      ),

      h('h2', null, 'Privacy'),
      row(
        'Track browsing',
        'When off, no searches or page visits are recorded.',
        h('input', { type: 'checkbox', checked: !s.paused, onchange: (e) => save({ paused: !e.target.checked }) })
      ),
      h(
        'label',
        { class: 'setting stacked' },
        h('div', null, h('div', { class: 'setting-label' }, 'Never track these sites'), h('div', { class: 'hint' }, 'One per line. Any site whose address contains the text is skipped and never read.')),
        h('textarea', {
          class: 'input',
          rows: 6,
          value: s.blocklist.join('\n'),
          onchange: (e) => save({ blocklist: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) }),
        })
      ),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              await set('events', []);
              status.textContent = 'Browsing trail cleared';
            },
          },
          'Clear browsing trail'
        ),
        h('button', { class: 'btn', onclick: () => save({ blocklist: DEFAULT_SETTINGS.blocklist }).then(settings) }, 'Reset blocklist')
      ),

      h('h2', null, 'Your cards'),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', onclick: exportCards }, 'Export cards'),
        h(
          'label',
          { class: 'btn' },
          'Import cards',
          h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: (e) => e.target.files[0] && importCards(e.target.files[0]) })
        )
      )
    )
  );
}

route();

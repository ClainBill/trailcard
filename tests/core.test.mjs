import test from 'node:test';
import assert from 'node:assert/strict';
import { newSrs, schedule, previewIntervals, formatInterval, DAY } from '../lib/fsrs.js';
import { reconcile, draftFromAI, pickQuestion, recordAnswer, substitute, noteFromDraft, isMastered, applyGrowth } from '../lib/cards.js';
import { parseSearch, isTrackable, selectTrail, safeUrl } from '../lib/trail.js';
import { demoContext, demoSuggestion } from '../lib/demo.js';

const NOW = 1_800_000_000_000;

test('new card intervals rise with the grade', () => {
  const [again, hard, good, easy] = previewIntervals(newSrs(NOW), NOW);
  assert.equal(again, 10 * 60_000);
  assert.ok(hard < good && good < easy);
  assert.equal(Math.round(good / DAY), 4);
});

test('stability grows on success and shrinks on a lapse', () => {
  let s = schedule(newSrs(NOW), 3, NOW);
  const first = s.stability;
  s = schedule(s, 3, s.due);
  assert.ok(s.stability > first * 2);
  const lapsed = schedule(s, 1, s.due);
  assert.ok(lapsed.stability < s.stability);
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.due, s.due + 10 * 60_000);
});

test('passing a card right after a lapse does not inflate stability', () => {
  let s = schedule(schedule(newSrs(NOW), 3, NOW), 1, NOW + 4 * DAY);
  const after = schedule(s, 3, s.due);
  assert.ok(after.stability <= s.stability * 1.05);
  assert.ok(after.due - s.due >= DAY);
});

test('higher retention target gives shorter intervals', () => {
  const s = schedule(newSrs(NOW), 3, NOW);
  assert.ok(schedule(s, 3, s.due, 0.95).due < schedule(s, 3, s.due, 0.85).due);
});

test('formatInterval', () => {
  assert.equal(formatInterval(10 * 60_000), '10m');
  assert.equal(formatInterval(4 * DAY), '4d');
  assert.equal(formatInterval(45 * DAY), '1.5mo');
});

test('AI output becomes a draft with resolved images', () => {
  const { page, events } = demoContext(NOW);
  const images = [{ src: page.images[0].src }, { src: events[1].image }];
  const draft = draftFromAI(demoSuggestion, images);
  assert.equal(draft.fields.length, 5);
  assert.equal(draft.fields.find((f) => f.key === 'poster').value, events[1].image);
  assert.equal(draft.questions.length, 4);
});

test('an image index that does not exist is dropped along with its cue', () => {
  const draft = draftFromAI(demoSuggestion, [{ src: 'https://x.test/a.jpg' }]);
  assert.ok(!draft.fields.some((f) => f.key === 'poster'));
  assert.ok(draft.questions.every((q) => !q.cueKeys.includes('poster')));
});

test('removing a field removes the questions that ask for it', () => {
  const draft = draftFromAI(demoSuggestion, []);
  draft.fields = draft.fields.filter((f) => f.key !== 'character');
  const clean = reconcile(draft);
  assert.ok(clean.questions.every((q) => !q.answerKeys.includes('character') && !q.cueKeys.includes('character')));
  assert.ok(clean.questions.length >= 2);
});

test('a hand-added field gets a default question', () => {
  const draft = draftFromAI(demoSuggestion, []);
  draft.fields.push({ key: 'f_new', label: 'Director', type: 'text', value: 'Joe Wright', added: true });
  const clean = reconcile(draft);
  assert.ok(clean.questions.some((q) => q.answerKeys[0] === 'f_new'));
  assert.ok(clean.fields.every((f) => !('added' in f)));
});

test('placeholders use current field values', () => {
  const note = noteFromDraft(draftFromAI(demoSuggestion, []), {}, NOW);
  note.fields.find((f) => f.key === 'film').value = 'P&P';
  assert.equal(substitute(note.questions[1].prompt, note), 'Who played Elizabeth Bennet in P&P?');
});

test('question picking never repeats the last one and favours misses', () => {
  let note = noteFromDraft(draftFromAI(demoSuggestion, []), {}, NOW);
  note = recordAnswer(note, 0, 1);
  for (let i = 0; i < 50; i++) assert.notEqual(pickQuestion(note).index, 0);
  note.lastQ = 3;
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < 2000; i++) counts[pickQuestion(note).index]++;
  assert.equal(counts[3], 0);
  assert.ok(counts[0] > 300);
});

test('search parsing and tracking rules', () => {
  assert.deepEqual(parseSearch('https://www.google.co.uk/search?q=keira+knightley'), { engine: 'Google', query: 'keira knightley' });
  assert.deepEqual(parseSearch('https://www.youtube.com/results?search_query=fsrs'), { engine: 'YouTube', query: 'fsrs' });
  assert.equal(parseSearch('https://en.wikipedia.org/wiki/Keira_Knightley'), null);
  const settings = { blocklist: ['bank', 'mail.google.com'] };
  assert.equal(isTrackable('https://www.mybank.com/login', settings), false);
  assert.equal(isTrackable('chrome://extensions', settings), false);
  assert.equal(isTrackable('https://en.wikipedia.org/wiki/X', settings), true);
  assert.equal(safeUrl('https://a.test/p?token=secret#x'), 'https://a.test/p');
});

test('trail keeps the lead-up even when older than the window', () => {
  const events = [1, 2, 3].map((i) => ({ id: String(i), ts: NOW - (200 - i) * 60_000 }));
  assert.equal(selectTrail(events, 30, NOW).length, 3);
});

test('a card is mastered only when every question was last answered correctly', () => {
  let note = noteFromDraft(draftFromAI(demoSuggestion, []), {}, NOW);
  assert.equal(isMastered(note), false);
  for (let i = 0; i < 4; i++) note = recordAnswer(note, i, 3);
  assert.equal(isMastered(note), true);
  note = recordAnswer(note, 2, 1);
  assert.equal(isMastered(note), false);
  note = recordAnswer(note, 2, 2);
  assert.equal(isMastered(note), false);
  note = recordAnswer(note, 2, 4);
  assert.equal(isMastered(note), true);
});

test('growth appends fields and questions without disturbing existing stats', () => {
  let note = noteFromDraft(draftFromAI(demoSuggestion, []), {}, NOW);
  for (let i = 0; i < 3; i++) note = recordAnswer(note, i, 3);
  note.srs = { ...note.srs, state: 'review', due: NOW + 30 * DAY };
  const out = {
    new_fields: [
      { key: 'director', label: 'Director', value: 'Joe Wright' },
      { key: 'film', label: 'Clashing key', value: 'ignored unless asked' },
      { key: 'unused', label: 'Unused', value: 'never asked about' },
    ],
    questions: [
      { prompt: 'Who directed {{film}}?', answer_keys: ['director'], cue_keys: ['film'] },
      { prompt: 'Who played {{character}} in {{film}}?', answer_keys: ['actress'], cue_keys: [] },
      { prompt: 'Bad question', answer_keys: ['missing'], cue_keys: [] },
    ],
  };
  const { note: grown, added } = applyGrowth(note, out, NOW);
  assert.equal(added, 1);
  assert.equal(grown.questions.length, 5);
  assert.deepEqual(grown.questions.slice(0, 4), note.questions);
  assert.ok(grown.fields.some((f) => f.key === 'director'));
  assert.ok(!grown.fields.some((f) => f.key === 'unused'));
  assert.equal(grown.fields.filter((f) => f.key === 'film').length, 1);
  assert.equal(grown.grown, 1);
  assert.equal(grown.srs.due, NOW + DAY);
  assert.equal(isMastered(grown), false);
  assert.equal(applyGrowth(note, { new_fields: [], questions: [] }, NOW).added, 0);
});

test('every fact in an AI draft gets a question, even if the model skipped it', () => {
  const out = {
    title: 'Mitochondria',
    fields: [
      { key: 'makes', label: 'What do mitochondria generate?', type: 'text', value: 'ATP', image_index: -1 },
      { key: 'found', label: 'First seen in', type: 'text', value: 'insect muscle', image_index: -1 },
      { key: 'year', label: 'Year discovered', type: 'text', value: '1857', image_index: -1 },
    ],
    questions: [{ prompt: 'What do mitochondria generate?', answer_keys: ['makes'], cue_keys: [] }],
  };
  const draft = draftFromAI(out, []);
  const answered = draft.questions.map((q) => q.answerKeys[0]).sort();
  assert.deepEqual(answered, ['found', 'makes', 'year']);
  assert.equal(draft.questions.filter((q) => q.answerKeys[0] === 'makes').length, 1);
  assert.ok(draft.questions.some((q) => q.prompt === 'What is the year discovered?'));
  assert.ok(draft.fields.every((f) => !('added' in f)));
});

test('a label phrased as a question becomes the default prompt', () => {
  const draft = draftFromAI({ title: 'x', fields: [{ key: 'a', label: 'Who wrote it?', type: 'text', value: 'Austen', image_index: -1 }], questions: [] }, []);
  assert.equal(draft.questions[0].prompt, 'Who wrote it?');
});

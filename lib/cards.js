// The card model.
//
// A note is one thing worth remembering, made of several fields (text or image).
// Each review picks one of its questions at random, so the same note is quizzed
// from a different direction each time.
//
//   field:    { key, label, type: 'text' | 'image', value }
//   question: { prompt, answerKeys: [fieldKey], cueKeys: [fieldKey] }
//
// Prompts can reference a field's current value with {{key}}, so editing a
// field never leaves a stale question behind.

import { newSrs, DAY } from './fsrs.js';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const fieldKey = () => 'f_' + uid();

const textFields = (note) => note.fields.filter((f) => f.type === 'text');

export function defaultQuestions(fields) {
  const texts = fields.filter((f) => f.type === 'text');
  return texts.map((f) => ({
    // A label already phrased as a question ("What do mitochondria make?") is used as is.
    prompt: f.label.trim().endsWith('?') ? f.label.trim() : `What is the ${f.label.toLowerCase()}?`,
    answerKeys: [f.key],
    cueKeys: fields.filter((o) => o.key !== f.key).map((o) => o.key),
  }));
}

// Drops empty fields and anything in the questions that points at a field that
// no longer exists. Guarantees at least one usable question when possible.
export function reconcile(draft) {
  const fields = draft.fields
    .map((f) => ({ ...f, label: (f.label || '').trim(), value: (f.value || '').trim() }))
    .filter((f) => f.value)
    .map((f) => ({ ...f, label: f.label || (f.type === 'image' ? 'Image' : 'Fact') }));
  const byKey = new Map(fields.map((f) => [f.key, f]));

  let questions = (draft.questions || [])
    .map((q) => {
      const answerKeys = (q.answerKeys || []).filter((k) => byKey.get(k)?.type === 'text');
      const cueKeys = (q.cueKeys || []).filter((k) => byKey.has(k) && !answerKeys.includes(k));
      return { prompt: (q.prompt || '').trim(), answerKeys, cueKeys };
    })
    .filter((q) => q.prompt && q.answerKeys.length);

  // A field the user added by hand has no question yet: give it a default one,
  // otherwise it would never be tested.
  const asked = new Set(questions.flatMap((q) => q.answerKeys));
  const addedKeys = new Set(fields.filter((f) => f.added).map((f) => f.key));
  questions = questions.concat(
    defaultQuestions(fields).filter((q) => addedKeys.has(q.answerKeys[0]) && !asked.has(q.answerKeys[0]))
  );
  if (!questions.length) questions = defaultQuestions(fields);

  return {
    ...draft,
    title: (draft.title || '').trim(),
    fields: fields.map(({ added, ...f }) => f),
    questions,
  };
}

export function validate(draft) {
  if (!draft.title) return 'Give the card a title.';
  if (!draft.fields.some((f) => f.type === 'text')) return 'Add at least one text field to quiz on.';
  return null;
}

export const MAX_GROWTHS = 3;

// Mastered: every question on the card was answered Good or Easy the last time it came up.
export function isMastered(note) {
  return note.questions.length > 0 && note.questions.every((_, i) => (note.qstats?.[i]?.last ?? 0) >= 3);
}

// Appends the model's new fields and questions to a note. Existing questions keep
// their positions, so their review stats stay attached to them.
export function applyGrowth(note, out, now = Date.now()) {
  // A new field whose key is already taken is dropped, so references to that
  // key keep pointing at the field the card already has.
  const used = new Set(note.fields.map((f) => f.key));
  const newFields = [];
  for (const f of out.new_fields || []) {
    const value = (f.value || '').trim();
    if (!value || !f.key || used.has(f.key)) continue;
    used.add(f.key);
    newFields.push({ key: f.key, label: (f.label || 'Fact').trim(), type: 'text', value });
  }
  const fields = [...note.fields, ...newFields];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const have = new Set(note.questions.map((q) => q.prompt.trim().toLowerCase()));

  const questions = (out.questions || [])
    .map((q) => {
      const answerKeys = (q.answer_keys || []).filter((k) => byKey.get(k)?.type === 'text');
      const cueKeys = (q.cue_keys || []).filter((k) => byKey.has(k) && !answerKeys.includes(k));
      const prompt = (q.prompt || '').trim();
      return { prompt, answerKeys, cueKeys };
    })
    .filter((q) => q.prompt && q.answerKeys.length && !have.has(q.prompt.toLowerCase()))
    .slice(0, 3);

  // A new field that no surviving question asks about would be dead weight.
  const asked = new Set(questions.flatMap((q) => [...q.answerKeys, ...q.cueKeys]));
  const keptFields = [...note.fields, ...newFields.filter((f) => asked.has(f.key))];

  if (!questions.length) return { note, added: 0 };
  return {
    added: questions.length,
    note: {
      ...note,
      fields: keptFields,
      questions: [...note.questions, ...questions],
      grown: (note.grown || 0) + 1,
      // Bring the card back soon so the new material gets learned, not buried for weeks.
      srs: { ...note.srs, due: Math.min(note.srs.due, now + DAY) },
    },
  };
}

export function noteFromDraft(draft, source, now = Date.now(), context = null) {
  return {
    id: uid(),
    created: now,
    title: draft.title,
    tags: draft.tags || [],
    source,
    context,
    fields: draft.fields,
    questions: draft.questions,
    srs: newSrs(now),
    qstats: {},
    lastQ: -1,
  };
}

// Turns the model's structured output into an editable draft.
export function draftFromAI(out, images) {
  // Small models often write fewer questions than facts. A fact nothing asks
  // about would never be tested, so it gets a default question (see reconcile).
  const asked = new Set((out.questions || []).flatMap((q) => q.answer_keys || []));
  const fields = [];
  for (const f of out.fields || []) {
    if (f.type === 'image') {
      const img = images[f.image_index];
      if (img) fields.push({ key: f.key, label: f.label, type: 'image', value: img.src });
    } else if (f.value) {
      fields.push({ key: f.key, label: f.label, type: 'text', value: f.value, added: !asked.has(f.key) });
    }
  }
  return reconcile({
    title: out.title,
    summary: out.summary,
    tags: out.tags || [],
    fields,
    questions: (out.questions || []).map((q) => ({
      prompt: q.prompt,
      answerKeys: q.answer_keys,
      cueKeys: q.cue_keys,
    })),
  });
}

// No-AI fallback: page title, lead image and a few structured facts.
export function heuristicDraft(page, trail, images) {
  const title = (page.title || 'Untitled').replace(/\s+[-–|·]\s+[^-–|·]+$/, '').trim();
  const fields = [{ key: 'subject', label: 'Subject', type: 'text', value: title }];
  if (page.selection) fields.push({ key: 'selected', label: 'Highlighted', type: 'text', value: page.selection.slice(0, 300) });
  for (const [label, value] of (page.infobox || []).slice(0, 3)) {
    fields.push({ key: fieldKey(), label, type: 'text', value: value.slice(0, 160) });
  }
  if (fields.length < 3 && page.description) {
    fields.push({ key: 'summary', label: 'Summary', type: 'text', value: page.description.slice(0, 240) });
  }
  if (images[0]) fields.push({ key: 'image', label: 'Image', type: 'image', value: images[0].src });
  return reconcile({ title, summary: '', tags: [], fields, questions: [] });
}

export function substitute(prompt, note) {
  return prompt.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key) => {
    const f = note.fields.find((x) => x.key === key);
    return f ? (f.type === 'text' ? f.value : f.label) : '';
  });
}

// Weighted random pick: unseen questions and ones you've missed come up more,
// and the same question never repeats twice in a row when there's a choice.
export function pickQuestion(note, rand = Math.random) {
  let questions = note.questions?.length ? note.questions : defaultQuestions(note.fields);
  if (!questions.length) {
    const t = textFields(note)[0];
    questions = [{ prompt: note.title, answerKeys: t ? [t.key] : [], cueKeys: [] }];
  }
  const weights = questions.map((_, i) => {
    if (questions.length > 1 && i === note.lastQ) return 0;
    const s = note.qstats?.[i] || { seen: 0, fails: 0 };
    return (s.seen === 0 ? 3 : 1) + 2 * s.fails;
  });
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  let index = weights.findIndex((w) => (r -= w) < 0);
  if (index < 0) index = 0;
  return { index, question: questions[index] };
}

export function recordAnswer(note, index, grade) {
  const stats = { ...(note.qstats || {}) };
  const s = { seen: 0, fails: 0, ...(stats[index] || {}) };
  s.seen += 1;
  s.last = grade;
  // A miss raises the question's weight; later successes let it decay again.
  s.fails = grade === 1 ? s.fails + 1 : Math.max(0, s.fails - (grade >= 3 ? 1 : 0));
  stats[index] = s;
  return { ...note, qstats: stats, lastQ: index };
}

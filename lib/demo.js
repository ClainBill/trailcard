// Sample context used when the pages are opened outside the extension, so the
// whole flow can be previewed in an ordinary browser tab.

const placeholder = (label, bg) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="440"><rect width="100%" height="100%" fill="${bg}"/>` +
      `<text x="50%" y="50%" fill="#fff" font-family="system-ui,sans-serif" font-size="26" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`
  );

export function demoContext(now = Date.now()) {
  const m = 60_000;
  const events = [
    { id: 'd1', kind: 'visit', ts: now - 9 * m, url: 'https://www.google.com/search?q=pride+and+prejudice+2005+cast', title: 'pride and prejudice 2005 cast - Google Search', search: { engine: 'Google', query: 'pride and prejudice 2005 cast' }, dwellMs: 21000 },
    { id: 'd2', kind: 'visit', ts: now - 8 * m, url: 'https://en.wikipedia.org/wiki/Pride_%26_Prejudice_(2005_film)', title: 'Pride & Prejudice (2005 film) - Wikipedia', via: 'Pride & Prejudice (2005 film)', dwellMs: 95000, image: placeholder('Film poster', '#7c5c3b') },
    { id: 'd3', kind: 'visit', ts: now - 6 * m, url: 'https://en.wikipedia.org/wiki/Keira_Knightley', title: 'Keira Knightley - Wikipedia', via: 'Keira Knightley', dwellMs: 240000, image: placeholder('Keira Knightley', '#4f46e5') },
  ];
  const page = {
    url: 'https://en.wikipedia.org/wiki/Keira_Knightley',
    title: 'Keira Knightley - Wikipedia',
    selection: '',
    description: 'Keira Christina Knightley is an English actress.',
    headings: ['Keira Knightley', 'Early life', 'Career', 'Personal life'],
    infobox: [
      ['Born', '26 March 1985, Teddington, London, England'],
      ['Occupation', 'Actress'],
      ['Years active', '1993–present'],
    ],
    text: 'Keira Christina Knightley is an English actress. She played Elizabeth Bennet in Pride & Prejudice (2005), directed by Joe Wright, for which she was nominated for the Academy Award for Best Actress.',
    images: [{ src: placeholder('Keira Knightley', '#4f46e5'), alt: 'Keira Knightley' }],
  };
  return { events, page };
}

// What the model returns for the context above.
export const demoSuggestion = {
  title: 'Keira Knightley in Pride & Prejudice',
  summary: 'You looked up the cast of Pride & Prejudice and landed on Keira Knightley, so this links her to the character she played.',
  tags: ['film', 'actors'],
  fields: [
    { key: 'actress', label: 'Actress', type: 'text', value: 'Keira Knightley', image_index: -1 },
    { key: 'character', label: 'Character', type: 'text', value: 'Elizabeth Bennet', image_index: -1 },
    { key: 'film', label: 'Film', type: 'text', value: 'Pride & Prejudice (2005)', image_index: -1 },
    { key: 'photo', label: 'Photo', type: 'image', value: '', image_index: 0 },
    { key: 'poster', label: 'Film poster', type: 'image', value: '', image_index: 1 },
  ],
  questions: [
    { prompt: 'What was her character’s name in {{film}}?', answer_keys: ['character'], cue_keys: ['photo', 'film'] },
    { prompt: 'Who played {{character}} in {{film}}?', answer_keys: ['actress'], cue_keys: ['poster', 'character'] },
    { prompt: 'Who is this, and who did she play in {{film}}?', answer_keys: ['actress', 'character'], cue_keys: ['photo', 'film'] },
    { prompt: 'In which film did {{actress}} play {{character}}?', answer_keys: ['film'], cue_keys: ['photo'] },
  ],
};

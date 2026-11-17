// The guided tour. It runs the real editor and scheduler on a made-up example,
// so a new user can try the whole flow without an API key and without anything
// being saved or sent.

import { h } from './dom.js';
import { demoContext, demoSuggestion } from './demo.js';
import { draftFromAI, noteFromDraft, pickQuestion, substitute } from './cards.js';
import { previewIntervals, formatInterval, DAY } from './fsrs.js';
import { renderEditor } from './editor.js';
import { hostOf } from './trail.js';

const GRADES = [
  ['Again', 'again'],
  ['Hard', 'hard'],
  ['Good', 'good'],
  ['Easy', 'easy'],
];

export function renderTutorial(view, { onFinish, onOpenSettings }) {
  const { events, page } = demoContext();
  const images = [
    { src: page.images[0].src, alt: 'Keira Knightley', from: 'current page' },
    { src: events[1].image, alt: 'Film poster', from: 'earlier page: Pride & Prejudice (2005 film)' },
  ];
  const freshDraft = () => draftFromAI(demoSuggestion, images);
  let draft = freshDraft();
  let step = 0;

  // ----- step bodies -----

  function welcome() {
    return [
      h('p', { class: 'tour-lede' }, 'You look something up, find the answer, and forget it by next week. Trailcard turns what you look up into flashcards and brings them back just before you would forget.'),
      h(
        'ol',
        { class: 'tour-outline' },
        h('li', null, h('span', null, h('b', null, 'Browse.'), ' Trailcard keeps a short trail of your searches and pages.')),
        h('li', null, h('span', null, h('b', null, 'Click Create Flashcard.'), ' It drafts a card from the trail and the page.')),
        h('li', null, h('span', null, h('b', null, 'Review.'), ' A few seconds a day, quizzed from a different angle each time.'))
      ),
      h('p', { class: 'hint' }, 'This tour takes about a minute and uses a made-up example. Nothing in it is saved or sent anywhere.'),
    ];
  }

  function trail() {
    return [
      h('p', { class: 'tour-lede' }, 'Say you are watching Pride & Prejudice and wonder who plays Elizabeth. You search, open the film’s page, then click through to the actress. Trailcard notes each step:'),
      h(
        'ul',
        { class: 'trail' },
        [...events].reverse().map((e) =>
          h(
            'li',
            { class: 'trail-item' },
            h('span', { class: 'trail-kind' + (e.search ? ' search' : '') }, e.search ? 'Search' : hostOf(e.url) + (e.via ? ` · clicked “${e.via}”` : '')),
            h('span', { class: 'trail-text' }, e.search ? e.search.query : e.title)
          )
        )
      ),
      h(
        'ul',
        { class: 'tour-points' },
        h('li', null, 'The trail shows what you were curious about, which a single page cannot.'),
        h('li', null, 'It stays on this device and clears itself after 24 hours.'),
        h('li', null, 'You can pause tracking from the side panel, and block any site in Settings.')
      ),
    ];
  }

  function create() {
    const mount = h('div', { class: 'tour-frame' });
    renderEditor(mount, {
      draft: structuredClone(draft),
      images,
      saveLabel: 'Save and continue',
      onCancel: () => {
        draft = freshDraft();
        render();
      },
      onSave: (clean) => {
        draft = clean;
        go(step + 1);
      },
    });
    return [
      h('p', { class: 'tour-lede' }, 'On the actress’s page you open the side panel and click Create Flashcard. Claude reads the trail and the page together and drafts this card. It is the real editor, so try it:'),
      h(
        'ul',
        { class: 'tour-points' },
        h('li', null, 'Change any label or value, or remove a field with ×.'),
        h('li', null, 'Click Change on an image to pick another, including the poster from the earlier page.'),
        h('li', null, 'Open Quiz questions to see what you will be asked.')
      ),
      mount,
    ];
  }

  function review() {
    const mount = h('div');
    let note = noteFromDraft(draft, { url: page.url }, Date.now());
    const field = (key) => note.fields.find((f) => f.key === key);

    function ask(result) {
      const { index, question } = pickQuestion(note);
      note = { ...note, lastQ: index };
      const intervals = previewIntervals(note.srs);
      let revealed = false;

      const draw = () => {
        const cues = question.cueKeys.map(field).filter(Boolean);
        const pics = cues.filter((f) => f.type === 'image');
        const texts = cues.filter((f) => f.type === 'text');
        mount.replaceChildren(
          result && h('div', { class: 'notice' }, result),
          h(
            'article',
            { class: 'card' },
            pics.length ? h('div', { class: 'cue-images' }, pics.map((f) => h('img', { src: f.value, alt: f.label }))) : null,
            texts.length ? h('div', { class: 'cue-chips' }, texts.map((f) => h('span', { class: 'chip' }, h('b', null, f.label), ' ', f.value))) : null,
            h('h2', { class: 'prompt' }, substitute(question.prompt, note)),
            revealed &&
              h(
                'div',
                { class: 'answer' },
                question.answerKeys
                  .map(field)
                  .filter(Boolean)
                  .map((f) => h('div', null, h('div', { class: 'answer-label' }, f.label), h('div', { class: 'answer-value' }, f.value)))
              )
          ),
          revealed
            ? h(
                'div',
                { class: 'grades' },
                GRADES.map(([label, cls], i) =>
                  h(
                    'button',
                    {
                      class: `grade ${cls}`,
                      onclick: () => {
                        const ms = intervals[i];
                        const when = ms < DAY ? 'in 10 minutes, in the same session' : `in ${formatInterval(ms).replace('d', ' days')}`;
                        ask(`You chose ${label}. A real card would come back ${when}, with a different question. Here is another one:`);
                      },
                    },
                    h('span', { class: 'grade-label' }, label),
                    h('span', { class: 'grade-interval' }, formatInterval(intervals[i]))
                  )
                )
              )
            : h(
                'button',
                {
                  class: 'btn primary big',
                  onclick: () => {
                    revealed = true;
                    draw();
                  },
                },
                'Show answer'
              )
        );
      };
      draw();
    }
    ask('');

    return [
      h('p', { class: 'tour-lede' }, 'Saved cards show up in Review when they are due. Each review asks one question, picked at random from the card. Think of the answer, reveal it, then say how well you knew it.'),
      mount,
      h(
        'ul',
        { class: 'tour-points' },
        h('li', null, 'The time under each button is when the card would come back. Good answers push it further out; Again brings it back in minutes.'),
        h('li', null, 'Questions you miss come up more often.'),
        h('li', null, 'You never have to wait: Review ahead and Review now let you practise any time.')
      ),
    ];
  }

  function setup() {
    const item = (title, body) => h('li', null, h('b', null, title), h('span', null, body));
    return [
      h('p', { class: 'tour-lede' }, 'That is the whole loop. A few things to set up before your first real card:'),
      h(
        'ul',
        { class: 'tour-checklist' },
        item('Open the side panel', 'Click the Trailcard icon in the toolbar, or press Alt+Shift+F. Pin the icon from the puzzle-piece menu to keep it handy; it shows a badge when cards are due.'),
        item('Add a Claude API key (optional)', 'Smart cards need your own key from the Anthropic console. Each card is one paid request: a few cents on the default model, far less on Haiku. Without a key you still get a basic card from the page.'),
        item('Check the privacy controls', 'Mail, banking and password sites are skipped by default. Add your own in Settings, or pause tracking from the side panel.'),
        item('Let cards grow (optional)', 'Turn on “Grow cards automatically” and Claude adds new questions on the same topic once you have mastered a card.')
      ),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: onOpenSettings }, 'Open Settings')),
    ];
  }

  const steps = [
    { title: 'Remember what you look up', body: welcome },
    { title: 'It keeps a trail as you browse', body: trail },
    { title: 'One click drafts a card', body: create },
    { title: 'Review from a different angle each time', body: review },
    { title: 'You are ready', body: setup },
  ];

  function go(n) {
    step = Math.max(0, Math.min(steps.length - 1, n));
    render();
    window.scrollTo({ top: 0 });
  }

  function render() {
    const last = step === steps.length - 1;
    view.replaceChildren(
      h(
        'div',
        { class: 'tour' },
        h(
          'div',
          { class: 'tour-head' },
          h('span', { class: 'hint' }, `Step ${step + 1} of ${steps.length}`),
          h(
            'div',
            { class: 'tour-dots', 'aria-hidden': 'true' },
            steps.map((_, i) => h('span', { class: 'tour-dot' + (i === step ? ' on' : i < step ? ' done' : '') }))
          )
        ),
        h('h1', null, steps[step].title),
        steps[step].body(),
        h(
          'div',
          { class: 'tour-nav' },
          step > 0 ? h('button', { class: 'btn', onclick: () => go(step - 1) }, 'Back') : h('span'),
          last
            ? h('button', { class: 'btn primary', onclick: onFinish }, 'Start using Trailcard')
            : h('button', { class: 'btn primary', onclick: () => go(step + 1) }, step === 0 ? 'Start the tour' : 'Next')
        )
      )
    );
  }

  render();
}

// The card editor, shared by the Create Flashcard panel and the library.

import { h } from './dom.js';
import { fieldKey, reconcile, validate } from './cards.js';

export function renderEditor(root, { draft, images = [], onSave, onCancel, onRegenerate, saveLabel = 'Save card' }) {
  let pickerFor = null;
  let error = '';
  let busy = false;

  const labelOf = (key) => draft.fields.find((f) => f.key === key)?.label || '?';

  function removeField(key) {
    draft.fields = draft.fields.filter((f) => f.key !== key);
    draft.questions = draft.questions
      .map((q) => ({
        ...q,
        answerKeys: q.answerKeys.filter((k) => k !== key),
        cueKeys: q.cueKeys.filter((k) => k !== key),
      }))
      .filter((q) => q.answerKeys.length);
    render();
  }

  function addField(type) {
    const key = fieldKey();
    draft.fields.push({ key, label: '', type, value: '', added: true });
    if (type === 'image') pickerFor = key;
    render();
    root.querySelector(`[data-key="${key}"] input`)?.focus();
  }

  function textField(f) {
    return h(
      'div',
      { class: 'field', 'data-key': f.key },
      h(
        'div',
        { class: 'field-head' },
        h('input', {
          class: 'field-label',
          value: f.label,
          placeholder: 'Label',
          'aria-label': 'Field label',
          oninput: (e) => (f.label = e.target.value),
        }),
        h('button', { class: 'icon-btn', title: 'Remove field', 'aria-label': 'Remove field', onclick: () => removeField(f.key) }, '×')
      ),
      h('textarea', {
        class: 'field-value',
        rows: f.value.length > 60 ? 3 : 1,
        value: f.value,
        placeholder: 'What to remember',
        'aria-label': f.label || 'Field value',
        oninput: (e) => (f.value = e.target.value),
      })
    );
  }

  function imageField(f) {
    const open = pickerFor === f.key;
    const choices = images.filter((img) => img.src);
    return h(
      'div',
      { class: 'field', 'data-key': f.key },
      h(
        'div',
        { class: 'field-head' },
        h('input', {
          class: 'field-label',
          value: f.label,
          placeholder: 'Image label',
          'aria-label': 'Image label',
          oninput: (e) => (f.label = e.target.value),
        }),
        h('button', { class: 'icon-btn', title: 'Remove image', 'aria-label': 'Remove image', onclick: () => removeField(f.key) }, '×')
      ),
      h(
        'div',
        { class: 'image-row' },
        f.value
          ? h('img', { class: 'thumb-lg', src: f.value, alt: f.label })
          : h('div', { class: 'thumb-lg empty' }, 'No image'),
        h(
          'button',
          {
            class: 'btn small',
            onclick: () => {
              pickerFor = open ? null : f.key;
              render();
            },
          },
          open ? 'Done' : f.value ? 'Change' : 'Choose'
        )
      ),
      open &&
        h(
          'div',
          { class: 'picker' },
          choices.length
            ? h(
                'div',
                { class: 'picker-grid' },
                choices.map((img) =>
                  h(
                    'button',
                    {
                      class: 'pick' + (img.src === f.value ? ' selected' : ''),
                      title: [img.alt, img.from].filter(Boolean).join(' · '),
                      onclick: () => {
                        f.value = img.src;
                        pickerFor = null;
                        render();
                      },
                    },
                    h('img', { src: img.src, alt: img.alt || 'Candidate image', loading: 'lazy' })
                  )
                )
              )
            : null,
          h('input', {
            class: 'input',
            type: 'url',
            placeholder: 'Or paste an image URL',
            'aria-label': 'Image URL',
            onchange: (e) => {
              if (/^https?:\/\//.test(e.target.value.trim())) {
                f.value = e.target.value.trim();
                pickerFor = null;
                render();
              }
            },
          })
        )
    );
  }

  function questionRow(q, i) {
    return h(
      'div',
      { class: 'question' },
      h(
        'div',
        { class: 'field-head' },
        h('span', { class: 'q-meta' }, `Answer: ${q.answerKeys.map(labelOf).join(' + ')}`),
        h(
          'button',
          {
            class: 'icon-btn',
            title: 'Remove question',
            'aria-label': 'Remove question',
            onclick: () => {
              draft.questions.splice(i, 1);
              render();
            },
          },
          '×'
        )
      ),
      h('textarea', {
        class: 'field-value',
        rows: 2,
        value: q.prompt,
        'aria-label': 'Question text',
        oninput: (e) => (q.prompt = e.target.value),
      }),
      q.cueKeys.length ? h('div', { class: 'q-meta' }, `Shown with: ${q.cueKeys.map(labelOf).join(', ')}`) : null
    );
  }

  async function save() {
    const clean = reconcile(draft);
    error = validate(clean) || '';
    if (error) return render();
    busy = true;
    render();
    try {
      await onSave(clean);
    } catch (e) {
      busy = false;
      error = e.message || 'Could not save the card.';
      render();
    }
  }

  function render() {
    root.replaceChildren(
      h(
        'div',
        { class: 'editor' },
        draft.summary && h('p', { class: 'summary' }, draft.summary),
        h('label', { class: 'label', for: 'card-title' }, 'Card title'),
        h('input', {
          id: 'card-title',
          class: 'input title-input',
          value: draft.title,
          placeholder: 'What is this card about?',
          oninput: (e) => (draft.title = e.target.value),
        }),
        h('div', { class: 'label' }, 'Fields'),
        h('div', { class: 'fields' }, draft.fields.map((f) => (f.type === 'image' ? imageField(f) : textField(f)))),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn small', onclick: () => addField('text') }, '+ Field'),
          h('button', { class: 'btn small', onclick: () => addField('image') }, '+ Image')
        ),
        h(
          'details',
          { class: 'questions' },
          h('summary', null, `Quiz questions (${draft.questions.length})`),
          h('p', { class: 'hint' }, 'Each review asks one of these at random. {{name}} inserts a field’s current value.'),
          draft.questions.map(questionRow)
        ),
        onRegenerate &&
          h(
            'form',
            {
              class: 'regen',
              onsubmit: (e) => {
                e.preventDefault();
                onRegenerate(e.target.elements.hint.value.trim());
              },
            },
            h('input', {
              class: 'input',
              name: 'hint',
              placeholder: 'Not quite right? Say what you want to remember',
              'aria-label': 'What you want to remember',
            }),
            h('button', { class: 'btn small', type: 'submit' }, 'Redo')
          ),
        error && h('p', { class: 'error', role: 'alert' }, error),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn', onclick: onCancel, disabled: busy }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: save, disabled: busy }, busy ? 'Saving…' : saveLabel)
        )
      )
    );
  }

  render();
}

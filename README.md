# Trailcard

**Remember what you look up.**

Trailcard is a Chrome extension that turns your search trail into spaced-repetition flashcards. You search for something, click around, find the answer, and normally forget it by next week. Trailcard notes the trail you took, works out what you were trying to learn, and turns it into a flashcard in one click.

**Website and live demo: https://trailcard.wcgill.com**

The site has an interactive review you can try in the browser without installing anything, and a download of the extension.

## The idea in one example

You're watching Pride & Prejudice and want to know who plays Elizabeth.

1. You search "pride and prejudice 2005 cast", click through to the film, then to Keira Knightley's Wikipedia page.
2. You click **Create Flashcard**. Trailcard sends the trail and the current page to Claude, which sees the question behind the page: actor, character, film.
3. A draft card appears with fields for Actress, Character, Film, her photo and the film poster. You edit anything you like and save.
4. In daily review the card is quizzed from a random direction each time: her photo with "What was her character's name in Pride & Prejudice?", or the poster with "Who played Elizabeth Bennet?".

## What it does

- **Reads the trail, not just the page.** It records searches, pages visited, the text of links clicked, text copied and time on each page, so the card can capture a connection that spans several pages.
- **Drafts multi-field cards with AI.** Claude proposes the fields, picks images (including ones from earlier pages in the trail) and writes one quiz question per fact.
- **Keeps you in control.** Nothing is saved until you have reviewed the draft. You can edit fields, swap images, rewrite questions, or describe what you wanted and have it redone.
- **Quizzes from every direction.** Each review picks one of the card's questions at random, favouring ones you have missed.
- **Schedules with FSRS.** Reviews are timed by FSRS-4.5, the algorithm behind current Anki, to a retention target you choose. You can also review ahead of schedule at any time.
- **Grows cards as you master them.** Optionally, once every question on a card has been answered correctly, Claude adds up to three new questions on the same topic.
- **Teaches itself.** A hands-on guided tour opens on first install and runs the real editor and scheduler on a sample card, with nothing saved or sent.
- **Works without AI.** With no API key you still get a basic card from the page title, key facts and lead image.

## Privacy

There is no Trailcard server. Everything lives in the browser.

- The browsing trail is stored locally and dropped after 24 hours.
- The trail and current page are sent to Claude only when you click Create Flashcard, using your own API key.
- Mail, banking and password-manager sites are blocked by default, and any site can be added to the blocklist.
- One switch pauses all tracking. Web addresses are trimmed of their query strings before anything is sent.

## What's in this repo

| Path | What it is |
|---|---|
| `manifest.json` | The Chrome extension manifest. Load this folder directly into Chrome. |
| `background.js`, `content.js` | Browsing-trail tracking. |
| `panel.html`, `panel.js` | The side panel: recent trail and the Create Flashcard flow. |
| `app.html`, `app.js` | The full-page app: review, card library and settings. |
| `lib/` | Scheduler (`fsrs.js`), card model (`cards.js`), Claude calls (`ai.js`), page reader (`extract.js`), editor (`editor.js`), guided tour (`tutorial.js`) and helpers. |
| `tests/` | Unit tests for the scheduler, card model and trail parsing. |
| `site/` | The showcase site published at trailcard.wcgill.com, including a zip of the extension. |
| `wrangler.jsonc` | Cloudflare configuration used to deploy the site. |

## Try it

**In the browser, no install:** open https://trailcard.wcgill.com and use the "Try a review" section.

**Install the extension:**

1. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder.
3. A guided tour opens in a new tab. Afterwards, click the Trailcard toolbar icon (or press Alt+Shift+F) to open the side panel.
4. For AI-drafted cards, open **Settings** and paste a Claude API key. Each card is then one paid API request to Anthropic; the model can be changed in Settings to trade quality for cost.

**Run the tests** (needs Node.js 22 or later):

```bash
npm test
```

## How it's built

- Chrome extension, Manifest V3, plain JavaScript modules with no build step and no dependencies.
- Card drafting uses the Claude API with structured output, called directly from the extension.
- All data is kept in `chrome.storage.local`.
- The website is a single static HTML page served by Cloudflare.

## Status

This is a hackathon build.

- The full flow (tracking, page reading, card creation, saving, review, card growth) was tested end to end in Chromium against live web pages, with Claude's reply stubbed.
- The extension is not on the Chrome Web Store, so it is installed by hand as above.
- Facts on a card come from the page you were on and Claude's general knowledge. They are not checked against other sources, which is why every card is shown to you before it is saved.

## Development

- `npm run preview` serves the pages at http://localhost:4173. Outside the extension, `panel.html` and `app.html` run in demo mode with a sample trail and `localStorage`.
- `npx wrangler deploy` publishes `site/` to Cloudflare. Rebuild `site/trailcard.zip` first if the extension changed.

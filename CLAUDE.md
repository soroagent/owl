# soroagent: project context

Read this before changing anything. It records what the README doesn't: how the code fits together,
the decisions behind it, and the rules that keep releases, sign-in and privacy working.

## What it is

soroagent is a browser extension (Chrome, Edge, Brave, Arc, Firefox; Manifest V3) that puts an owl
on every web page. It summarizes and answers questions about the page, files what you read into a
personal library (searchable by meaning, exportable to Obsidian/Logseq), lets you chat with that
library with citations, researches topics on the web, and syncs the library across browsers.

- **Tagline:** "Your browser is your knowledge base."
- **Brand:** always lowercase `soroagent`; owl colours green `#34D399` and orange `#F59E0B`.
- **License:** MIT, © 2026 soroagent.com.
- **Promise:** no soroagent servers, no accounts, no analytics. Everything lives in the user's browser.
  The AI is either a model on the user's computer (Ollama, LM Studio, llama.cpp, Jan) or the user's
  own cloud key (Anthropic, OpenAI, Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI, custom).

## Where things live

| What | Where |
|---|---|
| Extension code (this repo) | github.com/soroagent/owl |
| Website and privacy policy | github.com/soroagent/soroagent.github.io, served at https://soroagent.github.io/ |
| Old repo (no longer updated) | github.com/arjunmarri/soroagent |

## Layout

```
extension/
  manifest.json      base manifest; scripts/build.mjs derives the Chrome and Firefox ones
  background/        service worker (Chrome) / event page (Firefox); sw.js imports the files in order
    background.js    message router, menus, alarms, install/onboarding, wiring of everything below
    llm.js           chat + model listing for Ollama, OpenAI-compatible and Anthropic wire formats
    jobs.js          summaries/research run here, so they survive leaving the page
    library.js       library index: int8 embeddings ("vec:<id>") + BM25, fused with RRF
    research.js      web search (DuckDuckGo lite, Brave, Bing) + reading top results
    sync.js          encrypted cross-browser sync (Google Drive / WebDAV / GitHub Gist)
    mdexport.js      Markdown folder export (Obsidian/Logseq)
    autobackup.js    JSON backup to Downloads/soroagent/
    secrets.js       API keys, AES-256-GCM with a non-extractable key in IndexedDB
    recommend.js     ranks installed local models
  content/           content scripts (run on every http(s) page)
    assistant.js     the panel (closed shadow DOM): chat, Summarize, Save, Research, suggested questions
    launcher.js      owl button placement/drag   styles.js  panel CSS
    extract.js       readable page text           capture.js passive capture (opt-in)
    faq.js           fixed answers to "do you store my data?"-type questions about soroagent itself
  sites/             site profiles: structure-aware extraction per site (registry.js + one file per site)
  prompts/           every prompt as plain text (default.js + per-site overrides); see prompts/README.md
  shared/            loaded everywhere: config (settings, providers), prompts engine, snippets store,
                     knowledge (BM25, note formatting), backup/migrations, markdown renderer, brand
  pages/             options (Settings), onboard (first run), snippets, history, libchat (Ask your library)
scripts/             build.mjs (manifests + zips, no deps), release.mjs, make-icons.mjs, try-prompt.mjs
test/                node:test unit tests (no dependencies); test/helpers.mjs loads extension files
downloads/           the released zips, one per browser, named with the version
keys/                chrome-public-key.txt pins the Chrome extension ID (see keys/README.md)
```

All extension code is classic scripts that attach to `globalThis.soroagent` (aliased `S`). No
bundler, no npm dependencies. Pure functions are exported on `soroagent` so tests can load them.

## Data

`chrome.storage.local` keys: `settings`, `snippet:<id>` (library notes; kinds: summary, research,
selection, page, deliverable, read, screenshot), `summary:<id>` (summary history), `vec:<id>`
(search vectors), `syncConfig`/`syncState`, `markdownExport`/`markdownIndex`/`markdownState`,
`backupState`. IndexedDB holds things storage can't: encrypted API keys, the sync key, the Markdown
folder handle. `storage.session` holds the Google access token.

`shared/backup.js` owns storage migrations (`SCHEMA_VERSION`, currently 4). When a feature is
removed, add a migration that converts or deletes its data (v3: wishlist → readlater; v4: readlater
→ page and stats keys deleted).

## Rules

### Every code change is a release
Run `npm run release -- patch|minor|major` (patch for fixes, minor for features). It bumps
`manifest.json` and `package.json`, rebuilds `downloads/soroagent-<browser>-<version>.zip` (old zips
removed) and rewrites the README download links. Then commit and push. Users download from the
README links and need the version in the file name to know what they have.

```bash
perl -e 'alarm 150; exec @ARGV' npm test   # macOS has no `timeout`; keeps a hung run from blocking
npm run release -- minor
git push owl soroagent-main:main           # local branch soroagent-main → soroagent/owl main
```

Commit messages: `release: vX.Y.Z — <what changed>` with a short body.

### Never change these (Google sign-in depends on them)
- `keys/chrome-public-key.txt` → Chrome extension ID `jomghmmgdlajfonjihmagbhomimadpcg`.
- Firefox add-on ID `sorotrack@arjunmarri.github.io` (in `manifest.json` → `browser_specific_settings`).

Both are registered as OAuth redirect URIs on soroagent's Google Cloud client
(`991479969577-mpl1gaq4ku16jpn9fivc63pcvnsceg1j.apps.googleusercontent.com`, a public ID, no secret):

```
https://jomghmmgdlajfonjihmagbhomimadpcg.chromiumapp.org/
http://127.0.0.1/mozoauth2/2cc4144500e90330e1a3d0c39bbd9cc2e7ce6aeb
```

Firefox uses the loopback form because Google rejects `*.extensions.allizom.org`. A test in
`test/manifest.test.mjs` fails if either ID drifts.

### Privacy policy follows the code
If a change alters what data leaves the browser, or when, update `privacy.html` in
soroagent/soroagent.github.io and the answers in `extension/content/faq.js` in the same change.
Features that send page text without the user clicking something need a Settings switch.

### Style
- Code matches the surrounding code: small pure functions with a comment on top, unit tests for
  anything pure, no new dependencies.
- User-facing text is plain and short; sentence case; no jargon. Say what happens to data.
- Prompts live in `extension/prompts/`, never inline in code. JSON-returning prompts keep their
  documented shape (see `prompts/README.md`).
- Respect `prefers-reduced-motion`; the owl stays calm (no flying, blinking or eye-tracking).

## How the main features work

- **Summarize / Ask:** `assistant.js` reads the page via the site profile's `extract()` (Stack
  Overflow answers, Reddit/HN comment trees, GitHub issue state, X threads…) or `extract.js`, builds
  messages with `S.buildMessages(action, vars, sitePrompts())`, and streams through the `llm` port.
  Summaries run as background jobs (`jobs.js`).
- **Prepared on visit** (`preparePages`, on by default): 4 s after a page is in front, `preparePage()`
  in `assistant.js` summarizes it (`summarize` prompt) and then writes questions from that summary
  (`questions` prompt with `quick: true`: no extended thinking, short output; `llm.js`), using
  `S.pageKind` (JSON-LD, og:type, site profile, URL → product, news, thread, docs…). Opening the panel
  shows the questions; Summarize shows the prepared summary at once and saves it through a job with
  `preset` (no second model call). Nothing is stored until the reader acts. Skipped on pages
  `S.capture.captureAllowed` rejects (mail, banking, sign-in, checkout…), thin pages, or before setup.
- **X refresh:** X loads posts as you scroll and recycles DOM nodes, so a throttled MutationObserver
  collects every post seen on the URL (`xPosts`). The header's refresh button (X only) shows how many
  are new since the prepared summary and prepares again with all of them (most recent that fit
  `maxPageChars`). Other sites are static, so they get no watcher or button.
- **Suggested questions without preparing** (`pageQuestions`): if preparing is off or failed, opening
  the panel asks for questions from the page text directly. Standard questions are the last fallback.
- **Library:** everything saved is labelled (title, summary, tags) by the model, indexed in
  `library.js`, related notes show on matching pages, and "Ask your library" answers with `[S#]`
  citations from `knowledge.js` formatting.
- **Sync:** one encrypted document (`soroagent-sync.json`), gzip + AES-GCM with a PBKDF2 key from
  the passphrase; merged per item, newest wins, tombstones for deletions. Settings sync except each
  browser's AI connection and keys; screenshots stay local. Google Drive uses only the
  `drive.appdata` scope (hidden app folder). The sign-in window opens from an extension page
  (Settings or onboarding), and the background then reads the token from `storage.session` and
  renews it silently. WebDAV and Gist are the alternatives.
- **First run** (`pages/onboard.html`, install tab only): step 1 offers Google Drive sync (clearly
  says soroagent only sees its own hidden folder; Skip is one click), step 2 connects an AI.
- **Markdown export:** File System Access folder handle (Chrome family) or Downloads/soroagent/notes
  (Firefox); never overwrites a file the user edited in the vault.

## Testing

- `npm test`: all unit tests, about 1 s.
- Live checks: launch Chrome with `--remote-debugging-pipe --enable-unsafe-extension-debugging`, load
  `dist/chrome` with `Extensions.loadUnpacked`, set settings from the service worker target, open the
  panel by sending `{ type: 'assistant:toggle' }` to the tab, and read the closed shadow DOM with
  `DOM.getDocument({ pierce: true })`. Local models via Ollama at `127.0.0.1:11434` work for this.
- Branded Chrome ignores `--load-extension`; use the CDP pipe as above. `chrome.runtime.reload()`
  under the pipe breaks extension pages (a harness quirk, not a bug).
- Never complete a Google sign-in in tests; stop at the sign-in page and check the URL parameters.

## History of decisions

- Features tried and removed on purpose (don't bring back without asking): dark mode for sites,
  time stats, the doom-scroll limiter, read later (Save covers it), the wish list / e-commerce
  buy-later, malware detection, ad hiding, opening quips, the panel footer and feedback link,
  ++/-- resize (edge-drag resize replaced it).
- "Summarize" (not "TL;DR"), "Save" (not "Read later"); screenshot and page history are icons.
- Google Drive became the default sync because GitHub tokens and WebDAV were too hard for most
  users; a shared folder on disk can't work because Firefox extensions can't read files.

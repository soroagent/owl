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
  The AI is one of: inside the browser (Chrome's Gemini Nano, or Qwen2.5-1.5B via WebLLM on WebGPU),
  a model server on the user's computer (Ollama, LM Studio, llama.cpp, Jan), or the user's own cloud
  key (Anthropic, OpenAI, Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI, custom).

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
    llm.js           chat + model listing for Ollama, OpenAI-compatible and Anthropic; "browser" → browserai.js
    browserai.js     in-browser AI: Gemini Nano (Prompt API) and the WebLLM engine host + port client
    flight.js        flight recorder: scrubbed ring buffer (50) in storage.session + the Markdown report
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
  pages/             sidepanel (the default UI: Chrome side panel / Firefox sidebar), options (Settings),
                     onboard (first run; ?sync = sync setup), snippets, history,
                     libchat (Ask your library), offscreen (Chrome: backup blobs + the WebLLM engine)
  vendor/web-llm/    WebLLM 0.2.86 + the Qwen2.5-1.5B model library, vendored (README has sources/hashes)
scripts/             build.mjs (manifests + zips, no deps), release.mjs, make-icons.mjs, try-prompt.mjs
test/                node:test unit tests (no dependencies); test/helpers.mjs loads extension files
downloads/           the released zips, one per browser, named with the version
keys/                chrome-public-key.txt pins the Chrome extension ID (see keys/README.md)
```

All extension code is classic scripts that attach to `globalThis.soroagent` (aliased `S`). No
bundler, no npm dependencies; the one third-party library, WebLLM, is vendored as a file in
`extension/vendor/web-llm/` (see its README). Pure functions are exported on `soroagent` so tests can load them.

## Data

`chrome.storage.local` keys: `settings`, `snippet:<id>` (library notes; kinds: summary, research,
selection, page, deliverable, read, screenshot), `summary:<id>` (summary history), `vec:<id>`
(search vectors), `syncConfig`/`syncState`, `markdownExport`/`markdownIndex`/`markdownState`,
`backupState`, `browserAI` (`{ webllmReady }`, set once the WebLLM weights finished loading).
IndexedDB holds things storage can't: encrypted API keys, the sync key, the Markdown folder handle.
`storage.session` holds the Google access token and the flight recorder (`flightRecorder`). WebLLM's weights live in the browser's Cache Storage.

Settings worth knowing (`shared/config.js` → `DEFAULT_SETTINGS`): `openIn` (`sidepanel` | `page`),
`showLauncher` (the floating owl, off by default; existing installs keep their saved value),
`source` (`local` | `cloud` | `browser`), `browserEngine` (`nano` | `webllm`), `preparePages` (on), `pageQuestions` (on),
`syncOffer` (`{ snoozedAt, times }`), `autoCapture` (off), `maxPageChars` (12,000; 6,000 for
in-browser models via `S.pageCharLimit`).

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

Commit messages: `release: vX.Y.Z — <what changed>` with a short body. The owner also edits on
GitHub (README wording, the website move), so `git fetch owl` first and rebase onto `owl/main` if
the push is rejected; keep their edits.

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

### Diagnostics stay scrubbed
Anything that may reach a report goes through `diag.record()` (background) or the `diag:record`
message (pages, content scripts), and `sanitizeEvent`/`scrubDiagnostic` in `flight.js` run on it in
the background. Add new detail fields to `DETAIL_KEYS` only if they can't hold addresses or page
text, and extend `test/flight.test.mjs` when you add a kind of event.

### Style
- Code matches the surrounding code: small pure functions with a comment on top, unit tests for
  anything pure, no new dependencies. A third-party library is vendored as files only when there's no
  other way (as WebLLM is), with its license and a README giving source and SHA-256.
- User-facing text is plain and short; sentence case; no jargon. Say what happens to data.
- Prompts live in `extension/prompts/`, never inline in code. JSON-returning prompts keep their
  documented shape (see `prompts/README.md`).
- Respect `prefers-reduced-motion`; the owl stays calm (no flying, blinking or eye-tracking).

## How the main features work

- **Opening:** the toolbar button and `open-soroagent` (Alt+Shift+O, also ⌥⇧O on Mac) open the side
  panel (Chrome: `sidePanel.setPanelBehavior` + `sidePanel.open` in the command; Firefox:
  `sidebarAction.toggle`) or, with `openIn: 'page'`, the floating panel. `toggle-assistant`
  (Alt+Shift+K) always toggles the floating panel. The choice is cached in memory in the background
  because browsers only open a side panel inside the click or key press. Cmd/Ctrl+Shift+O (Firefox
  Library, Chrome's Windows bookmark manager), Cmd/Ctrl+Shift+S (Firefox/Edge screenshots) and Alt+S
  (Firefox History menu) are taken; `test/manifest.test.mjs` keeps them out.
- **Side panel** (`pages/sidepanel.js`): follows the active tab (`tabs.onActivated`/`onUpdated`),
  keeps a conversation per tab, and asks the tab's content script for everything page-related:
  `assistant:sp-snapshot` (title, site, prepared questions, new X posts), `sp-summary` (a job spec,
  with `preset` when the prepared summary is current), `sp-ask` (messages, or the "soroagent or this
  website?" topic), `sp-save`, `sp-refresh`, `sp-open`. The content script sends
  `sidepanel:changed` when something shown there changes. It runs chats over the `llm` port and
  summaries as jobs, like the floating panel.
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
- **First run** (`pages/onboard.html`, install tab and inside the panel): no questions if it can
  avoid them. `ai:detect` checks Ollama at 127.0.0.1:11434, Chrome's Gemini Nano and WebGPU at once:
  Ollama with a model, or Nano/WebLLM already downloaded → configured silently. Ollama 403 → the
  `S.ollamaOriginsFix()` command (extension origins only, never `*`) with a copy button; the panel
  and Settings show the same card. Otherwise one click for Nano (download must start in a click) or
  WebLLM (progress bar), a cloud key, or Ollama/LM Studio.
- **In-browser AI** (`source: 'browser'`, `background/browserai.js`): Nano runs where it's called
  (`LanguageModel`, also in the service worker). WebLLM is an ES module, so in Chrome it runs in the
  offscreen document (shared with the backup helper; never closed) behind a `webllm` port; in
  Firefox it runs in the background page. Engine and Qwen model library are vendored in
  `vendor/web-llm/` (MV3 forbids remote code; CSP allows `wasm-unsafe-eval`); weights (880 MB) are
  data from Hugging Face. Small models get `pageCharLimit` 6,000 chars. Ollama's 403 only happens
  when the Origin rewrite can't apply (e.g. Ollama on another computer).
- **Sync offer:** not in first run. `sync:offer` (`S.syncOfferDue`) offers it in the panel once 5
  items are saved; "Not now" waits 15 more items, two "Not now"s stop it. The setup page is
  `onboard.html?sync`.
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
- Never start model downloads on the owner's machine without asking (Gemini Nano is several GB, the
  WebLLM weights 880 MB, `ollama pull` several GB). To test WebLLM wiring, block `*huggingface.co*`
  on the offscreen document's target (`Network.setBlockedURLs`) and check the engine loads from
  `vendor/web-llm/` and requests the right model.
- X needs a login: test against a stand-in page with X's markup (`article[data-testid="tweet"]`…)
  served locally and mapped with `--host-resolver-rules="MAP x.com 127.0.0.1"`, with a function that
  appends posts. Ollama's 403: a local server that always answers 403, set as the server URL.
- The background worker can't `runtime.sendMessage` to itself; send test messages from an
  extension page target instead.
- Open the real side panel with `Extensions.triggerAction({ id, targetId })`, where `targetId` is
  the **tab** target (`Target.getTargets({ filter: [{ type: 'tab' }] })`), not the page target. Its
  page then shows up as a target with `sidepanel.html` in the URL.
- Chrome's storage returns objects with their keys sorted; never compare stored objects with
  `JSON.stringify` directly.

## History of decisions

- Features tried and removed on purpose (don't bring back without asking): dark mode for sites,
  time stats, the doom-scroll limiter, read later (Save covers it), the wish list / e-commerce
  buy-later, malware detection, ad hiding, opening quips, the panel footer and feedback link,
  ++/-- resize (edge-drag resize replaced it).
- "Summarize" (not "TL;DR"), "Save" (not "Read later"); screenshot and page history are icons.
- Google Drive became the default sync because GitHub tokens and WebDAV were too hard for most
  users; a shared folder on disk can't work because Firefox extensions can't read files.
- Sync is not part of first run: asking for Google access and a passphrase to sync an empty
  library lost people. It's offered after 5 saved items.
- First run configures an AI without questions when it can. The in-browser model's 880 MB download
  is one click, not automatic, so nobody's data plan is used without consent.
- The Ollama fix allows `chrome-extension://*,moz-extension://*`, not `*`, which would let every
  website use the person's Ollama.
- The side panel is the default UI and the floating owl is opt-in: no site CSS conflicts, and it
  persists across navigations. The floating panel stays for people who prefer it.
- Shortcut is Alt+Shift+O, not Cmd+Shift+O/S as first asked: those are taken by the browsers.
- Preparing a summary and questions on every visit is on by default (the owner asked for it). With
  a cloud key it sends each visited page to the provider; the Settings switch and privacy policy
  say so. Revisit if cloud users find it surprising.

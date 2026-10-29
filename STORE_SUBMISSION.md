# Store submission: Chrome Web Store and Firefox Add-ons

Everything a reviewer is likely to question, with paste-ready text for each form field. Checked
against version 2.53.0 on 2026-10-29.

## Before you submit

### Done in the code

| | Item | Status |
|---|---|---|
| ✅ | No `eval`, `new Function` or string timers anywhere (our code and all vendored files) | Checked |
| ✅ | CSP is `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`; no remote scripts | Checked |
| ✅ | Vendored libraries byte-identical to official releases, reproducible with `npm run vendor` | `npm run vendor:check` (also in `npm test`) |
| ✅ | Mozilla `addons-linter` on `dist/firefox`: **0 errors**, 4 warnings, all inside unmodified third-party files (see below) | Run 2026-10-29 (v2.53.0) |
| ✅ | Every permission used; manifest description ≤ 132 characters (tested) | `activeTab` and `downloads.ui` removed |
| ✅ | No background browsing log: Stats (the reading log) was removed in 2.41, so no prominent-disclosure screen is needed for web history | 2026-10-24 |
| ✅ | Nothing is downloaded unasked: the automatic backup is **opt-in** (off by default; a storage upgrade turned it off for existing installs) and shows in the browser's downloads like any download | 2026-10-24 |
| ✅ | Fewer features to justify against "single purpose": Tasks (background tabs) and the pictures download offer were removed in 2.41 | 2026-10-24 |
| ✅ | Nothing is posted, liked or sent on the user's behalf on any site (Reply ideas, added in 2.46, were removed in 2.47 along with Tech only) | 2026-10-28 |
| ✅ | Feed scrolling (Summarize the top 100 posts, Save the posts) happens only after the user clicks, in their own tab and login, on X and LinkedIn feeds; Stop ends it; it reads only what the page shows the user | 2026-10-28 |
| ✅ | The first-run page that shows inside the panel is web-accessible with `use_dynamic_url: true`, so websites can't use it to detect soroagent | 2026-10-24 |
| ✅ | Privacy policy at a stable URL: https://github.com/soroagent/owl/blob/main/PRIVACY.md (use it in both store listings) | Updated 2026-10-24 |
| ✅ | Third-party licenses ship in both builds | Tested |

### Still to do (outside the code)

| | Item | Where |
|---|---|---|
| ⚠️ | **A way for the reviewer to test.** Reviewers won't have Ollama, Gemini Nano may be missing and the in-browser model is an 880 MB download. Create a cloud key with a small spending cap (OpenAI or Gemini) and put it in the reviewer notes. This is the most common reason AI extensions are rejected ("functionality not working"). | Notes for reviewers, below |
| ⚠️ | **Google Drive sync in the store build**: the store assigns a new extension ID; add its sign-in redirect to the Google Cloud OAuth client after the first (unpublished) upload | "Chrome: extension ID and Google sign-in", below |
| ⚠️ | **Google OAuth consent screen**: publish it (not "Testing"), or only test users can connect Drive. Brand verification wants the homepage and privacy policy **on a domain you own and have verified** (a `github.com/…` link won't do): host `PRIVACY.md` at https://soroagent.github.io/ (live) or soroagent.com and verify that domain in Google Search Console | Google Cloud console |
| ⚠️ | **soroagent.com shows a "One moment, please…" bot check** to automated visitors. Google's verifier and store reviewers may be blocked by it; turn it off for the homepage, privacy and feedback pages, or point the listing at soroagent.github.io | Website hosting |
| ⚠️ | **Store listing assets**: 1–5 screenshots (1280×800), small promo tile (440×280), optional marquee (1400×560), category Productivity, a support URL | Developer Dashboard |
| ⚠️ | **Firefox data collection declaration** is `"none"`, not accurate for cloud AI, web lookups, sync and diagnostic reports | **Needs a decision**: "Firefox: data collection", below |
| ℹ️ | If the extension is renamed, do it **before** the first upload (the listing name and the OAuth consent screen's app name are hard to change later) | |
| ℹ️ | Optional: `"minimum_chrome_version": "116"` (opening the side panel from a click needs Chrome 116) | `extension/manifest.json` |
| ℹ️ | Broad host access means Chrome's in-depth review (slower). Justification below | Expected |

Packages: `npm run store` → `dist/soroagent-chrome-store-<version>.zip` (no `key`, for the Chrome Web
Store). `npm run package` → `dist/soroagent-firefox-<version>.zip` for AMO.

Re-run the Mozilla linter before each Firefox upload:

```bash
npx addons-linter dist/firefox
```

---

## How soroagent works (for both reviewers)

soroagent is an AI reading assistant. It summarizes and answers questions about the page you're on,
and saves what you read to a private library on your device that you can search. The AI is chosen by
the user: a model server on their computer (Ollama, LM Studio…), an AI inside the browser (Chrome's
Gemini Nano, or Qwen2.5-1.5B via WebLLM in Chrome), or the user's own API key for a cloud provider.
There are no soroagent servers, accounts, analytics or ads.

Things a reviewer may notice while testing (all serve that purpose; automatic ones can be switched off
in Settings → AI → While you read):

- **Suggested questions.** The panel suggests four questions for the page, in four labelled slots
  (Gist, Understand, Check, Next) that follow a template for the site (`shared/templates.js`), written
  by the user's AI. After each answer it asks the same AI for two follow-up questions, sending only
  the question and the answer.
- **Feeds: summarize the top 100, save the posts.** On X feeds (home timeline, bookmarks, likes,
  lists, profiles, search) and the LinkedIn feed, the panel shows two buttons instead of suggested
  questions. Only on a click does soroagent scroll that page in the user's tab, collect the posts the
  page shows, and either summarize the top 100 with the user's AI (like Summarize) or save them as
  snippets, sending their text in batches of 5 for topic tags. Saved X bookmarks, X likes and
  LinkedIn posts also get a fixed tag naming where they came from (x-bookmark, x-like,
  linkedin-post), added locally without the AI. On X's bookmarks page the panel opens
  by itself once per browser session with these buttons (off in Settings → PKG). Nothing is posted.
- **Page actions on news, Hacker News, Reddit and YouTube.** Buttons on the opening screen, each run
  on a click: a news front page's top 5 stories (its headlines to the user's AI); an article's
  "Confirmed vs claimed" and "Story timeline" (the article, plus the user's related saved snippets,
  to the AI); Hacker News and Reddit top 100 (Hacker News: the next list pages are fetched from
  news.ycombinator.com, same as clicking "More"); "Best comments" on threads; YouTube's top 50 videos
  and a video's chapter summaries. None of this reads anything before the click, and it reads only
  what the page (or the list's next pages) shows the user.
- **What's new since your last visit.** Off until the user asks on a page (a news front page, Hacker
  News, a subreddit). From then on, visiting that page compares its story links with the ones stored
  last time and marks the new ones (an attribute and one CSS rule). Only those pages' story
  addresses are stored, locally (`seenLists`, capped), never sent; Settings → PKG forgets them. No
  AI and no network.
- **Hide clutter.** Per site, off by default: hides related-link, newsletter, comment and sponsored
  boxes on articles by their class or id (an attribute and one CSS rule; no AI, no network). The
  story itself is never hidden; turning it off restores the page.
- **Knowledge graph.** While the user is away from the computer (the `idle` API: no input for a
  minute), the user's AI reads their saved snippets one at a time and stores, locally, the entities,
  typed relations and claims in them (each claim with the exact sentence it came from), which claims
  support or contradict each other, and a topic page per entity they read most about. It stops when
  the user is back. On by default only with a local or in-browser AI; off by default with a cloud key
  (Settings → PKG); "Build now" on the PKG page runs it on a click. Users merge, split, rename and
  hide entities on each topic page. Nothing new is fetched; only the user's own snippets are read.
- **Hovercards, "seen before" and the `kg` keyword.** The content script asks the background for the
  user's own entity names and compares them with the page text, in the extension, to show a card on
  hover and a short note when a page repeats or contradicts a saved story (no AI, nothing stored or
  sent; switches in Settings → PKG). The manifest's `omnibox` keyword `kg` searches the user's PKG
  from the address bar.
- **Answers off the page.** If the page doesn't have the answer, soroagent searches the web (the
  search engine chosen in Settings), reads the top results and answers with sources.
- **Sites soroagent never reads automatically.** `content/capture.js` (`NEVER_READ`) lists adult,
  betting, ad-redirect and unlicensed streaming sites and IRCTC, and any page with the adult (RTA)
  label is treated the same way: no suggested questions, no automatic summary, no capture there. The
  domain names in that list are only for this exclusion.

Source: https://github.com/soroagent/owl (MIT). Privacy policy: https://github.com/soroagent/owl/blob/main/PRIVACY.md

---

## Chrome Web Store

### Single purpose

> soroagent helps you understand and keep what you read on the web: it summarizes and answers
> questions about the current page with an AI model the user chooses, and files what they read into
> a private, searchable library on their device.

### Permission justifications

| Permission | Justification (paste) |
|---|---|
| `storage` | Stores the user's settings, saved notes and summary history locally. |
| `unlimitedStorage` | The user's PKG, their personal knowledge graph (notes, page text and search vectors) can grow beyond the default quota; it never leaves the device unless the user turns on sync. |
| `contextMenus` | Right-click items: "Summarize this page" and "Summarize this PDF with soroagent". |
| `scripting` | When the user opens soroagent (or a right-click item) on a tab that was already open before soroagent was installed or updated, injects soroagent's own packaged content scripts into that tab so it works without a reload. |
| `declarativeNetRequestWithHostAccess` | One session rule that sets the `Origin` header on soroagent's own background requests to the user's local model server (e.g. Ollama at 127.0.0.1), so the server accepts them. See "Local model servers" below. It never applies to web pages or tabs. |
| `downloads` | Saves files the user asks for to their Downloads folder: exports (Markdown, JSON) and, only if the user turns it on in Settings, the automatic backup file. Each one shows in the browser's downloads like any other download. |
| `alarms` | Schedules the optional automatic backup, the optional sync, and a check every 15 minutes whether the knowledge graph has snippets left to read. |
| `idle` | Builds the user's knowledge graph from their saved snippets only while they are away from the computer (idle for a minute), so it never slows their browsing; it stops when they come back. Off by default with a cloud AI (Settings → PKG). |
| `identity` | Opens Google's sign-in window when the user connects Google Drive sync (scope `drive.appdata` only: a hidden app folder; no access to the user's files). |
| `offscreen` | A hidden document for two things a service worker can't do: create a blob URL for the backup file (BLOBS), and run pdf.js (which uses a Worker) and the optional in-browser AI (WebLLM) as ES modules (WORKERS). |
| `sidePanel` | Users can choose to open soroagent in the side panel, beside the page, instead of the floating panel on the page (one click in its menu, or in Settings). |
| Host permission `<all_urls>` | The content script must run on any page the user reads (to read the page they ask about, show the optional on-page panel, and prepare a summary when they open the side panel). The background also fetches: the user's chosen AI provider or local model server, web search results for Research and for questions the page can't answer, PDFs the user opens, and the user's own sync storage. None of these are fixed hosts. |

### Remote code

**Answer: "No, I am not using remote code."** Explanation, if asked:

> All JavaScript and WebAssembly ship in the package, including three unmodified third-party
> libraries in `vendor/` (WebLLM 0.2.86, pdf.js 6.4.299, Readability 0.6.0; sources and SHA-256 in
> each `vendor/*/README.md`, reproducible with `npm run vendor`). The CSP allows only `'self'` and
> `'wasm-unsafe-eval'`; WebAssembly is compiled only from files in the package (WebLLM's model
> library `vendor/web-llm/*.wasm` and the tokenizer embedded in WebLLM). Downloaded at runtime, as
> data only: the in-browser model's weights (Hugging Face, `mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC`,
> only after the user clicks to set it up) and Chrome's own Gemini Nano (downloaded by Chrome).

### Data usage (Privacy practices tab)

Tick these data types:

- **Website content**: page text is sent to the AI provider the *user* configured when they use
  soroagent (or automatically when the side panel is open / after 15 s of reading, only with a local
  or in-browser AI by default). Page actions (a feed's top 100, an article's Confirmed vs
  claimed or Story timeline, Best comments, Chapter summaries) send that content, on click. After an answer, the question and the answer go to the same AI to
  suggest follow-up questions (switch in Settings). While the user is idle, their saved snippets go
  to the same AI to build their knowledge graph (on by default only with a local or in-browser AI;
  switch in Settings → PKG). With a local or in-browser AI nothing leaves the device.
- **Web history**: saved notes include the address of the page they came from; stored locally and
  included in the user's encrypted sync only if they turn sync on. For pages the user saved (only
  those), the active reading time is added up per page to weight topics in the PKG view; it stays on
  the device and can be switched off. soroagent keeps no log of visited pages.
- **Authentication information**: the user's own AI API keys, stored encrypted on the device and sent
  only to that provider.

Not collected: personally identifiable information, health, financial, personal communications,
location, user activity (no clicks, keystrokes or browsing log are recorded).

Certify all three statements: not sold, not used or transferred for purposes unrelated to the single
purpose, not used for creditworthiness or lending.

### Notes for reviewers (paste)

> soroagent is an AI reading assistant that uses an AI model the user chooses.
>
> To test: on the first-run page, choose "Use Claude, ChatGPT or Gemini", pick the provider of this
> spending-capped test key (for review only) and paste it: **<TEST KEY HERE>**. Alternatively install Ollama
> (https://ollama.com) and run `ollama pull qwen2.5:7b`; soroagent finds it automatically. Then open
> any article, click the owl in the page corner (or the toolbar button, or press Alt+Shift+O), and
> use Summarize or one of the suggested questions. The panel's ⋯ menu has "Switch to the side panel".
>
> After each answer the panel shows two follow-up questions (a second, short request to the same AI
> with the question and the answer). Nothing is downloaded unless the user exports or turns on the
> automatic backup in Settings.
>
> On X feeds (for example x.com/home, x.com/i/bookmarks; needs an X account) and the LinkedIn feed,
> the panel offers "Summarize the top 100 posts" and "Save … to your PKG". After a click, soroagent
> scrolls that page in the user's tab to collect the posts it shows; it never posts anything.
> To see the other page actions without an account: open https://news.ycombinator.com (Summarize
> the top 100 stories), any story's comments (Best comments), a news site such as
> https://www.bbc.com (Today's top 5 stories, What's new since your last visit) and one of its
> articles (Confirmed vs claimed, Story timeline, Hide clutter).
>
> Knowledge graph: save or summarize a few articles, then open the PKG page (toolbar menu → PKG, or
> Snippets → PKG) and click "Build now". The people, companies and ideas in them appear as a graph;
> click one and "Open the topic page" for its claims, the passages they came from and where sources
> disagree. Without a click it runs only while the computer is idle.
>
> Local model servers: Ollama rejects requests whose Origin is chrome-extension:// unless the user
> edits its configuration (OLLAMA_ORIGINS). Instead, soroagent adds one declarativeNetRequest
> *session* rule that sets the Origin header to the local server's own origin (for example
> http://127.0.0.1:11434). The rule is limited to: requests initiated by this extension
> (`initiatorDomains: [<extension id>]`), not from any tab (`tabIds: [-1]`), to that single
> user-configured server URL (`urlFilter: |<server origin>/`), resource types xmlhttprequest/other.
> It does not touch web pages, other sites or cookies, and it is removed when the browser closes.
> The code is in background/background.js, ensureOriginRewrite().
>
> Third-party code (unmodified, in vendor/, with README, license and SHA-256): WebLLM 0.2.86
> (@mlc-ai/web-llm, lib/index.js), pdf.js 6.4.299 (pdfjs-dist, build/pdf.min.mjs and
> pdf.worker.min.mjs), Readability 0.6.0 (@mozilla/readability). WebLLM's built-in model list
> mentions remote model-library URLs on raw.githubusercontent.com; soroagent overrides it so the
> model library is loaded from the package (background/browserai.js, appConfig). pdf.js contains a
> code path that wraps a cross-origin worker URL; soroagent's worker is a packaged file, so it is never
> used (background/pdfread.js).

### Chrome: extension ID and Google sign-in

The unpacked build pins ID `jomghmmgdlajfonjihmagbhomimadpcg` with `keys/chrome-public-key.txt`; the
store build has no `key`, so the Chrome Web Store assigns a new ID. Google Drive sync signs in through
`https://<id>.chromiumapp.org/`, which must be an authorized redirect URI on the OAuth client. After
the first upload (it can stay unpublished): add `https://<store id>.chromiumapp.org/` to the client
in Google Cloud, then copy the item's public key from the Developer Dashboard into
`keys/chrome-public-key.txt` (see `keys/README.md`) so unpacked builds and the store share one ID, and
update the test in `test/manifest.test.mjs` and the IDs in `CLAUDE.md`.

---

## Firefox Add-ons (AMO)

### Source code question

**"Do you use code generators, minifiers, bundlers…?"** soroagent's own code: **no**. Every file in
`background/`, `content/`, `pages/`, `shared/`, `sites/` and `prompts/` is the source as written; the
build (`scripts/build.mjs`, no dependencies) only copies files and writes a per-browser
`manifest.json`. The only minified files are official, unmodified third-party releases (below). If
AMO still asks for source, upload the repository (or link https://github.com/soroagent/owl) with:

```bash
node --version   # 20 or newer; no npm install needed
npm run build    # writes dist/firefox
npm run vendor   # optional: downloads the vendored libraries again and verifies their SHA-256
```

### Notes to reviewer (paste)

> soroagent is an AI reading assistant that uses an AI model the user chooses (no soroagent servers).
> To test: on first run, choose a cloud AI and paste this spending-capped test key: **<TEST KEY HERE>**;
> or install Ollama (https://ollama.com), run `ollama pull qwen2.5:7b`, and soroagent finds it on
> first run. Open an article and click the owl in the page corner (or press Alt+Shift+O). The panel's
> ⋯ menu has "Switch to the side panel", which opens the same UI in Firefox's sidebar.
>
> After each answer the panel shows two follow-up questions (a second, short request to the same AI
> with the question and the answer). Nothing is downloaded unless the user exports or turns on the
> automatic backup in Settings. On X and LinkedIn feeds the panel can summarize
> the top 100 posts or save them, scrolling the page after a click; it never posts anything.
>
> Our code is not minified or bundled; scripts/build.mjs only copies files and writes the manifest.
> Third-party libraries, unmodified (README, license and SHA-256 in each vendor/ folder; `npm run
> vendor` downloads them from the npm registry, checks the tarball integrity and the SHA-256):
> pdf.js 6.4.299 (pdfjs-dist: build/pdf.min.mjs, build/pdf.worker.min.mjs) and Readability 0.6.0
> (@mozilla/readability: Readability.js). The linter warnings (innerHTML in Readability.js, dynamic
> import in pdf.js) are inside these unmodified files. pdf.js is loaded with a literal packaged path
> and isEvalSupported: false.
>
> Local model servers: Ollama rejects moz-extension:// origins by default. soroagent's background
> page registers a blocking webRequest onBeforeSendHeaders listener that, only for requests made by
> soroagent itself (tabId -1 and originUrl inside this extension) to the single user-configured model
> server URL (default http://127.0.0.1:11434), sets the Origin header to that server's own origin. It
> never changes requests from web pages or to any other host. Code: background/background.js, the
> listener at the top and ensureOriginRewrite().
>
> The Firefox build does not include the in-browser model (WebLLM); that option is Chrome-only.

### Firefox: data collection (decision needed)

The manifest declares `"data_collection_permissions": { "required": ["none"] }`. Mozilla defines
transmission as "any data collected, used, transferred, shared, or handled outside the add-on or the
local browser", which includes sending data to a provider the user picked. soroagent transmits data
only when the user chooses a feature that needs it:

| Feature | Data | Category |
|---|---|---|
| A cloud AI (the user's own API key) | Page text, questions, answers (for follow-up questions) | `websiteContent` |
| Research, and questions the page can't answer (looked up on the web) | The search query | `searchTerms` |
| Sync (Google Drive, WebDAV, Gist) | The library, encrypted end to end | `websiteContent`, `browsingActivity` |
| "Copy diagnostic report" (opens a GitHub issue) | Scrubbed error log | `technicalAndInteraction` |

With Ollama or another local model, nothing is transmitted, so `"none"` is true for that setup but not
for the add-on as a whole. Recommended: keep `required: ["none"]` and declare
`optional: ["websiteContent", "searchTerms", "browsingActivity", "technicalAndInteraction"]`, then call
`browser.permissions.request({ data_collection: [...] })` (from the click) when the user picks a
cloud AI, first uses Research, turns on sync, or copies a diagnostic report, and don't transmit if
it's declined. This is Firefox-only code (feature-detect with `permissions.getAll().data_collection`).
Firefox 140+ is required for this, which is now `strict_min_version`.

### Other Firefox notes

- `strict_min_version` is 140 (data consent), Android 142.
- Host permissions are shown at install in Firefox 127+; soroagent needs them for the reasons in the
  Chrome table above.
- The sidebar (`sidebar_action`) hosts the same page as Chrome's side panel.

---

## Things that commonly trigger rejections, and where soroagent stands

| Risk | Status |
|---|---|
| Reviewer can't test the core feature | Provide the capped test key in the reviewer notes (to do). |
| Remote code / `eval` | None. Only packaged JS and WebAssembly (`'wasm-unsafe-eval'`). |
| Modified or unverifiable third-party libraries | Unmodified, pinned, reproducible (`npm run vendor`), tested. |
| Files too large for AMO's linter (`FILE_TOO_LARGE`) | WebLLM (6.8 MB) is left out of the Firefox build. |
| Unused permissions | None (checked each one; `activeTab` and `downloads.ui` removed). |
| Header modification | One narrowly scoped rule, documented above. |
| Obfuscation | None. |
| Undisclosed data handling | Privacy policy and in-product text; no browsing log; Firefox declaration needs the update above. |
| Description too long (Chrome, 132) | 132 characters; a test keeps it within the limit. |
| Missing licenses for bundled code | Shipped in both builds. |
| Broken features for reviewers (OAuth in Testing mode, store ID) | Publish the OAuth consent screen; add the store ID redirect. |
| Single purpose (Chrome) | Every feature serves reading and keeping pages: summaries, questions, web answers, research, the library, sync. Tasks and picture downloads were removed to keep it that way. Reply ideas and Tech only were removed in 2.47 for the same reason. |
| Acting on the user's behalf on other sites (spam, automation) | soroagent never posts, likes, follows or sends anything. Feed summaries and saving only scroll the user's own feed page after a click. |
| Unexpected downloads, tabs or tracking | None: the backup is opt-in and visible, no background tabs, no reading log. |
| Extension detectable by websites | The one web-accessible page uses `use_dynamic_url`. |

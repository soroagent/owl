<p align="center"><img src="extension/icons/icon-128.png" width="96" height="96" alt="soroagent owl"></p>

<h1 align="center">soroagent</h1>

<p align="center"><b>Your browser is your knowledge base.</b><br>
An AI companion for every web page that turns what you read into a personal library you can think with.</p>

<p align="center">Chrome · Edge · Brave · Arc · Firefox &nbsp;|&nbsp; macOS · Windows &nbsp;|&nbsp; AI in your browser, on your computer (Ollama, LM Studio…) or your own Claude, OpenAI or Gemini key</p>

---

## Why soroagent

soroagent sits beside every page as a small owl (or in your browser's side panel, if you prefer) and does three things:

- **Understands the page.** Summaries and answers shaped by the site you're on: the accepted solution on Stack Overflow, the consensus in a Reddit or Hacker News thread, the status of a GitHub issue. This will improve productivity.
- **Archives what you read.** Every summary (and, if you like, every page you actually read) is filed into a personal library with a title, summary and consistent tags. It's searchable by meaning, and you can write it to your Obsidian or Logseq folder.
- **Lets you think with it.** Chat with everything you've read, see related notes on the page you're on, and turn your notes into a research brief, a decision record, a study guide or a draft. Every answer is cited to your own sources.

> **Browsing history, reinvented.** Not *"you visited 214 pages yesterday"* but *"here's what you read, what it said, and how it connects to what you already know."*

## Features

### Understand any page
- **Your choice of where it lives.** By default a small owl sits in the corner of every page; click it (or the toolbar button, or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>, <kbd>⌥</kbd><kbd>⇧</kbd><kbd>O</kbd> on a Mac) and the panel opens on the page. One click in its ⋯ menu, **Switch to the side panel**, moves soroagent into the browser's side panel (Firefox: the sidebar): beside the page, out of reach of any website's styles, open as you switch tabs, with a conversation per tab. **Switch to the floating owl** in the side panel's menu brings it back. Settings → On the page also has **Quiet** mode: no owl on pages, open it from the toolbar or the shortcut.
- **Works out of the box.** The first-run setup looks for an AI on your computer and uses it without asking: Ollama if it's running, or Chrome's built-in AI (Gemini Nano). If neither is there, one click sets up Chrome's built-in AI or a small model that runs in the browser on your graphics chip (Qwen2.5-1.5B, a one-time 880 MB download). Or paste a Claude, OpenAI or Gemini key. If Ollama is running but blocks browser extensions, you get the one command that fixes it, ready to copy.
- **Ready before you ask.** When the side panel is open on a page, or after you've been reading it for 15 seconds, your model summarizes it in the background and works out the questions you're likely to have: how a product works and what it compares to, the background and the people in a news story, the consensus in a thread. The questions are there when you look, and Summarize is instant. Nothing is saved unless you act, and it never runs on mail, chat, banking, sign-in or checkout pages. On by default with an AI on your computer or in the browser; with a cloud key it's off (every page would be sent and billed), and **Suggest questions for this page** does it on request.
- **Long pages, whole.** Instead of cutting a long article after its introduction, soroagent condenses it to fit your model: its headings, the start and end of each section, and the paragraphs most relevant to the whole, in reading order, with "[…]" where it skipped. This matters most for the small in-browser models.
- **PDFs and papers.** Open a PDF (an arXiv paper, a report) and the side panel reads it with pdf.js: summary, questions, chat and Save, like any page. Or right-click a PDF link → **Summarize this PDF with soroagent**. Scanned PDFs (images only) have no text to read.
- **YouTube transcripts.** When you summarize or ask about a video, soroagent reads its timed transcript (from YouTube's own transcript panel, which it opens and closes again), so answers cover what's said, with timestamps.
- **X keeps up with the timeline.** X loads more posts as you scroll, so soroagent collects every post that appears. The refresh button in the panel shows how many are new and redoes the summary and questions with all of them.
- **Summarize** gives you the page in a scannable format: a one-line TL;DR, then the key points. Summaries run in the background, so you can switch tabs; the result waits for you.
- **Feeds, summarized or saved in one click.** On your X home timeline, bookmarks, likes, lists and profiles, and on your LinkedIn feed, the panel skips the usual questions and offers two things instead: **Summarize the top 100 posts** (it scrolls the feed, collects them and tells you what's worth knowing, who said it, and what's worth opening) and **Save the posts to your PKG** (all your bookmarks or likes, or the top 100 elsewhere), each as a snippet with topics from your AI. Next time only new ones are added.
- **News without the clutter.** On a news site's front page: **Today's top 5 stories** (duplicates merged, each linked to its headline). On an article: **Confirmed vs claimed** (what's established, what's only claimed and by whom, who the sources are, what's missing) and **Story timeline** (a dated timeline built from the article and your own saved snippets on the story). **Hide clutter** folds away related links, newsletter boxes, comments and sponsored blocks on that site, with no AI.
- **What's new since your last visit.** On a news front page, Hacker News or a subreddit, ask once and from then on soroagent marks the stories you haven't seen before with a green dot and lists them. It remembers only those pages' story addresses, on your computer.
- **Hacker News, Reddit and YouTube.** Summarize or save the top 100 stories on Hacker News and Reddit, see a thread's **Best comments**, summarize the top 50 videos on your YouTube home or subscriptions, and get **Chapter summaries** of a video that jump to each moment.
- **Your digest.** The PKG page shows what you saved today, yesterday or this week, grouped by topic.
- **Questions that fit the site.** Suggested questions always come in the same four slots, **Gist · Understand · Check · Next**, and each site fills them its own way: timestamps on YouTube, the consensus on Reddit, critical reviews and bank offers on Amazon and Flipkart, the match situation on Cricbuzz and ESPNcricinfo, red flags on eBay and Telegram, the background and the other side on any news site. They're written in the page's language, so a Hindi news page gets Hindi questions. Templates cover YouTube, X, Reddit, Wikipedia, Amazon (.com and .in), LinkedIn, Pinterest, Netflix, JioHotstar, Apple, ESPN, GitHub, eBay, Roblox, Quora, AliExpress, Spotify, Flipkart, Myntra, IMDb, BookMyShow, Physics Wallah, Moneycontrol, Yahoo Finance, Justdial and Telegram; other pages get the general four.
- **Keep exploring.** The suggested questions stay at the top of the conversation (the ones you've asked are ticked), so you can scroll up and pick another. Under each answer, two follow-up questions written from that answer take you deeper or somewhere related.
- **Ask** anything about the page. If the page doesn't have the answer (ask a news article for a company's revenue), soroagent searches the web, reads the top results and answers with numbered sources instead of "the text doesn't say". Turn it into a one-click button in Settings → On the page.
- **Site profiles** read each site's structure before the AI sees it:

  | Site | What soroagent reads | What you get |
  |---|---|---|
  | Stack Overflow / Stack Exchange | the question, answers ranked with the **accepted** one first, code intact | **Accepted solution**, better alternatives, caveats |
  | Reddit threads | the post and its comment tree | **Thread consensus** and the most useful answer |
  | Hacker News | the story and its comment tree, reply depth kept | **Discussion consensus** and the main disagreements |
  | GitHub | issue or PR state, labels and conversation; READMEs | **Status** and next steps |
  | YouTube | title, channel, description, **chapters**, top comments | chapter-by-chapter overview and what viewers say |
  | Wikipedia | infobox facts, lead, outline | **Key facts**, with "citation needed" flagged |
  | X | posts with handles, verification and engagement; X Articles (long-form) as articles | themes and notable posts, every @handle linked; article summaries |

  The panel's site bar shows the mode (for example *Q&A · Accepted-solution mode*). LinkedIn, Amazon and major news sites have tuned prompts too. Sites change their markup: when a profile's selectors find nothing, soroagent reads the page with Mozilla's Readability instead (the Firefox Reader View parser), so you still get a summary, and the diagnostic report notes it.
- **Feeds** on X and Reddit: Summarize reads the posts that have loaded (on X, every post that appeared while you scrolled), and **Read more** loads the next batch. Promoted posts are left out.
- **Research** turns a summary into a starting point. soroagent offers topics from the summary (or type your own), searches the web, reads the top sources and writes a brief with numbered citations. Only the search query leaves your machine.

### Your PKG (personal knowledge graph)
- **A real knowledge graph.** While you're away from the computer, your AI reads your snippets and files the people, companies, products, ideas, papers and places in them, how they relate (made by, competes with, part of, written by, cites, works for), and the claims they make, each tied to the exact sentence it came from. "OpenAI", "Open AI" and "openai.com" are one entity. New claims are checked against older ones, so the PKG shows **where your sources disagree** (a benchmark of 91% vs 86%, a launch promised for December and then delayed). Finding contradictions needs a 7B model or larger, or a cloud AI.
- **Topic pages.** Every entity you read about has a page: a summary your AI keeps up to date as you read more, every sentence cited to the claim and passage behind it (the link opens the source page scrolled to that sentence), the disagreements, the claims over time and what it's connected to. Fix the AI's mistakes there: rename, change the type, merge, split off a name, or hide.
- **Auto-filed and auto-tagged.** Every summary is saved with a title, short summary and tags. The tagger reuses the tags already in your library, so "AI Agents" files under your existing *ai-agents*. Saved X bookmarks, X likes and LinkedIn posts also get *x-bookmark*, *x-like* or *linkedin-post*, so you can filter by where they came from.
- **Save** puts the page itself into your library, with its text for search.
- **Passive capture** (opt-in) saves the pages you actually read. That means pages where you were active for a while (45 seconds by default) and scrolled through at least half. Mail, chat, banking, logins, checkouts, search results, feeds and pages with a password box are never captured, and you can exclude any site.
- **Search by meaning.** Finds notes about the same idea even when the words differ, and still finds exact names. It uses a free local embedding model (`ollama pull nomic-embed-text`) or your OpenAI, Gemini or Mistral key; vectors stay on your device. Without one, it searches by words.
- **Related notes.** On the page you're reading, the panel shows *"📚 3 of your saved notes relate to this page"*. **Use in chat** brings them into the conversation, cited as [N1], [N2]…
- **PKG, your personal knowledge graph.** The PKG tab draws your snippets as a small graph of topics: each topic is sized by how many snippets you have on it and how long you've actually spent reading those pages, and lines join topics that share snippets. Click a topic for its snippets, sources and connected topics; the side list shows where your knowledge is, strongest first. Reading time is counted only on pages you've saved, and stays on your computer.
- **Your X bookmarks, in your PKG.** Open your bookmarks on X and the owl opens with **Save all bookmarks to your PKG** ready: it scrolls to the end, saves each bookmark as a snippet (author, text and link) and has your AI add topics, so they join your knowledge graph. Next time it adds only the new ones. Settings → PKG turns off the panel opening by itself there.

### Your notes, everywhere
- **Markdown folder (Obsidian, Logseq…).** The archivist keeps a clean `.md` file with YAML frontmatter for every note in a folder you choose, such as your Obsidian vault or Logseq `pages` folder:

  ```markdown
  ---
  title: "How AI agents use tools"
  source: "https://blog.example.com/agents"
  site: "blog.example.com"
  type: "summary"
  tags:
    - ai-agents
    - llm
  created: 2026-10-22T05:42:05.952Z
  soroagent_id: "mvj465xcrzqzek"
  ---

  # How AI agents use tools
  …summary, research and sources…
  ```

  New and changed notes are written automatically (renamed when their title changes) and deleted notes are removed. Files you edit in your vault are never overwritten. Chrome, Edge, Brave and Arc write to the folder you pick; Firefox writes to `Downloads/soroagent/notes/`.
- **Sync across browsers.** Every browser where soroagent is installed can share one PKG, on any computer. There are no soroagent servers, so the shared copy lives in **your own storage**. Once you've saved 5 things, the owl offers it (or turn it on any time in Settings → Sync): click **Connect Google Drive**, sign in, and pick a passphrase; do the same in your other browsers. **Not now** keeps everything in that browser. It goes in a hidden folder in your Drive that only soroagent can see (soroagent can't see your other files). A WebDAV folder (Nextcloud, ownCloud, Synology, Koofr…) or a private GitHub Gist also work. It's **end-to-end encrypted** with your passphrase before it leaves the browser. Notes merge one by one (the newest wins; deletions carry over); each browser keeps its own AI connection and keys.
- **Backups and restore.** Turn on the automatic backup (Settings → Library) and a backup file in `Downloads/soroagent/` is kept up to date. After a reinstall, soroagent finds it and restores everything in one click. Snippets also export as Markdown or JSON.

### Make it yours
- **Prompts in settings.** Rewrite the system prompt for all websites or any one site, and click **Optimize with AI** to have your model improve it.
- **Any model.** An AI inside the browser (Chrome's built-in Gemini Nano, or Qwen2.5-1.5B on your graphics chip), a model server on your computer (Ollama, LM Studio, llama.cpp, Jan, any OpenAI-compatible server), or your own key for Anthropic Claude, OpenAI, Google Gemini, OpenRouter, Groq, Mistral, DeepSeek or xAI. soroagent recommends the best of your installed local models.
- **Floating owl, side panel or quiet.** The owl places itself where it doesn't cover the page's own buttons, can be dragged to either side (remembered per site), can be hidden on any site, and follows your browser's light or dark theme. Drag the panel's edges to resize it. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> always opens the floating panel.

## Private by design

- **Your AI:** with an in-browser or local model, page text never leaves your computer. With a cloud API, page text goes only to the provider you chose, billed to your key.
- **API keys:** encrypted with a key that can't be exported, and sent only to their own provider.
- **Your data:** your library, history and settings live in your browser, and search vectors stay on your device.
- **Google Drive sync** asks only for soroagent's own app folder in your Drive (`drive.appdata`), never your files. The sign-in token stays in memory for the session.
- **Prepared automatically:** to have the summary and questions ready, your AI reads a page when the side panel is open on it or after 15 seconds of reading (never mail, chat, banking, sign-in or checkout pages). On by default only with an AI on your computer or in the browser; off by default with a cloud key. Change it in Settings → On the page.
- **PDFs** are downloaded from where they are, as your browser would, and read on your computer.
- **Opt-in only:** passive capture, sync and the Markdown folder are off until you turn them on, and only go where you point them.
- **No tracking:** there are no soroagent accounts, servers, trackers or analytics.

Read the full [privacy policy](PRIVACY.md).

## Download

Current version: **v2.52.0**. The version is in each file name, so you can tell which build you have.

| Browser | Download | Install |
|---|---|---|
| Chrome, Edge, Brave, Arc | [**soroagent-chrome-2.52.0.zip**](https://github.com/soroagent/owl/raw/main/downloads/soroagent-chrome-2.52.0.zip) | Unzip, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the unzipped folder. |
| Firefox (140+, no in-browser model) | [**soroagent-firefox-2.52.0.zip**](https://github.com/soroagent/owl/raw/main/downloads/soroagent-firefox-2.52.0.zip) | Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and choose the zip. |

Both work on macOS and Windows.

## Install

**1. Get the extension.** Download a build above (unzip the Chrome one into a folder you'll keep), or build it yourself with [Node.js](https://nodejs.org) 20+. The build has no dependencies:

```bash
npm run build
```

This creates `dist/chrome` and `dist/firefox`.

**2. Load it.** Chrome, Edge, Brave and Arc: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the folder. Firefox: open `about:debugging#/runtime/this-firefox` and **Load Temporary Add-on…** (temporary add-ons are removed when Firefox restarts; to keep it, sign it through [addons.mozilla.org](https://addons.mozilla.org/developers/), unlisted is fine).

**3. Connect an AI.** A welcome page opens and looks for an AI on your computer. If Ollama is running with a model, or Chrome's built-in AI is already downloaded, it's set up without a single question. Otherwise pick one:
- **Chrome's built-in AI** (Gemini Nano): free and private; Chrome downloads it once.
- **A small AI in the browser** (Qwen2.5-1.5B on WebGPU): free and private; a one-time 880 MB download, with a progress bar.
- **A cloud key** from [Anthropic](https://console.anthropic.com/settings/keys), [OpenAI](https://platform.openai.com/api-keys), [Google Gemini](https://aistudio.google.com/apikey) (free tier), [Groq](https://console.groq.com/keys) (free tier) or [OpenRouter](https://openrouter.ai/keys). **How do I get a key?** walks you through it.
- **[Ollama](https://ollama.com)**, for bigger free models on your computer:

  ```bash
  ollama pull qwen2.5:7b
  ```

  For search by meaning, also pull a small embedding model:

  ```bash
  ollama pull nomic-embed-text
  ```

  LM Studio (`http://127.0.0.1:1234/v1`), llama.cpp (`:8080/v1`) and Jan (`:1337/v1`) work too.

## Using it

| Where | How |
|---|---|
| Any page | Click the owl in the corner (or soroagent in the toolbar). The panel has **Summarize** and **Save**, one-click actions for the page (feeds, news, threads, videos), the page's suggested questions (none on feeds and news front pages), and a chat; its ⋯ menu switches between the floating owl and the side panel. On X, a refresh button shows how many new posts have loaded and redoes the summary with them. |
| Keyboard | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> (<kbd>⌥</kbd><kbd>⇧</kbd><kbd>O</kbd>) opens soroagent; <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> opens the floating panel on the page. Change them at `chrome://extensions/shortcuts` (Firefox: Add-ons → ⚙ → Manage Extension Shortcuts). We avoided <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> and <kbd>S</kbd>: browsers already use them for bookmarks and screenshots. |
| Right-click | *Summarize this page*, *Summarize this PDF with soroagent* (on PDF links) |
| Toolbar button | Click to open soroagent; a number means summaries finished while you were away. Right-click for **Snippets**, **Send feedback** and **Settings**. |

Your data carries over to every update. The Chrome build has a fixed extension ID (`jomghmmgdlajfonjihmagbhomimadpcg`), so a newer version loaded from any folder keeps the same storage, and stored data is upgraded automatically.

## Customizing

- **Prompts** are plain text in [`extension/prompts/`](extension/prompts), one file per site. Edit them, or use **Settings → Prompts**. Try a prompt against your local model with `npm run try-prompt -- --site x --action summarize --show-prompt`. See the [prompts guide](extension/prompts/README.md).
- **Site profiles** in [`extension/sites/`](extension/sites) teach soroagent a website's structure: `extract()` for single pages, `items` for feeds, and toggles. Copy [`_template.js`](extension/sites/_template.js); see the [site profiles guide](extension/sites/README.md).

## How it works

```
 web page ──► content scripts (page extraction, prepared summary and questions, passive capture,
                 │            the optional floating panel in a closed shadow root)
                 ▼
          side panel / Firefox sidebar ◄── asks the page's content script for a snapshot and prompts
                 │
          background worker ──► your model (Ollama, OpenAI-compatible or Anthropic API,
                 │                or in the browser: Gemini Nano, or WebLLM in the offscreen document)
                 │           ──► library index (embeddings + BM25), Markdown folder, encrypted sync
                 ▼
          extension pages (snippets, settings)
```

- **Model requests:** all of them come from the background worker, so pages' security policies don't block them. Three wire formats cover every provider: Ollama, OpenAI chat completions and Anthropic Messages. Reasoning models run with thinking off for speed, and `<think>` output is removed.
- **API keys:** encrypted with AES-256-GCM using a non-extractable key, in the extension's own IndexedDB. Only the background worker decrypts them, and settings pages only ever see the last four characters. First-run key entry happens in soroagent's own frame, so the page you're on can't see what you type.
- **Ollama 403s:** Ollama refuses `chrome-extension://` and `moz-extension://` origins by default. soroagent rewrites the `Origin` header on its own background requests only (a session `declarativeNetRequest` rule in Chrome, `webRequest` in Firefox), so you normally don't need `OLLAMA_ORIGINS`. When that can't apply (for example Ollama on another computer), the panel, setup and Settings show the one command that allows browser extensions (not every website), with a copy button.
- **In-browser AI:** Gemini Nano is Chrome's Prompt API. Qwen2.5-1.5B runs with [WebLLM](https://github.com/mlc-ai/web-llm) on WebGPU; its engine ships inside the extension (`extension/vendor/web-llm/`, Apache-2.0) because extensions can't run code from the web, and only the model weights download from Hugging Face. Small models get less page text (6,000 characters).
- **Search:** notes are embedded once (again only when they change) and stored as 8-bit vectors. A search fuses the meaning and word rankings (reciprocal rank fusion).
- **Sync:** the shared document is gzipped, encrypted with AES-GCM using a key derived from your passphrase (PBKDF2, 250,000 rounds), and merged per item with tombstones for deletions. The passphrase is never stored; the derived key is non-extractable.
- **Reading pages:** site profile first, Readability when its selectors find nothing, then a generic reader; long text is condensed (`condenseText` in `shared/knowledge.js`) rather than cut. PDFs are read by pdf.js and YouTube transcripts from YouTube's transcript panel; both run only on request or when the side panel is open. pdf.js and Readability ship inside the extension (`extension/vendor/`, Apache-2.0).
- **Side panel:** the page's content script still reads the page and builds the prompts, so the side panel and the floating panel give the same answers; the side panel runs the model and shows the result.
- **Flight recorder:** the last 50 internal problems (errors, site readers that found nothing, model replies in an unexpected shape, storage upgrades) are kept in session storage, scrubbed of web addresses, host names, page text, emails, keys and file paths. **Settings → Troubleshooting → Copy diagnostic report** turns them into Markdown and opens a pre-filled GitHub issue for you to check and submit.
- **Research** only reads public web pages: addresses on your computer or local network are never fetched. Only `http(s)` links are ever made clickable.

## Development

```
extension/
  background/   background.js (routing, menus) · llm.js (model client, embeddings) · browserai.js (Gemini Nano, WebLLM) · flight.js (diagnostics) · pdfread.js (PDFs)
                jobs.js (summaries, auto-filing) · library.js (search) · mdexport.js (Markdown folder) · sync.js · research.js
                autobackup.js · secrets.js (encrypted keys) · recommend.js (local model ranking) · sw.js (Chrome entry)
  content/      assistant.js (the panel) · launcher.js (the owl) · capture.js (passive capture) · extract.js · faq.js · styles.js
  pages/        sidepanel · snippets (library and summary history) · options (settings) · onboard (first run) · offscreen
  prompts/      prompt texts per site, with a fine-tuning guide
  sites/        site profiles: X, Reddit, Stack Overflow, Hacker News, GitHub, YouTube, Wikipedia
  shared/       config · prompts · markdown · snippets · knowledge (BM25, related notes) · backup · ask · brand
  vendor/       web-llm (in-browser AI) · pdfjs (PDFs) · readability (fallback page parser), each with a README
scripts/        build, release, icons, try-prompt
test/           node:test unit tests
```

```bash
npm test                    # unit tests
npm run build               # dist/chrome and dist/firefox
npm run release -- patch    # bump the version, build versioned zips into downloads/ and update these links
npm run try-prompt -- --site x --action summarize   # run a prompt against your local model
```

After editing, run `npm run build` and click **Reload** on the extension card.

## Troubleshooting

- **"Can't reach http://127.0.0.1:11434":** Ollama isn't running. Open the app, or run `ollama serve`.
- **No models:** run `ollama pull qwen2.5:7b` (or any chat model).
- **"Ollama is blocking browser extensions":** copy the command soroagent shows (on macOS: `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"`), then quit and reopen Ollama. On a Mac, run it again after a restart.
- **In-browser AI isn't offered:** Chrome's built-in AI needs a recent Chrome on a supported computer; the in-browser model needs WebGPU (recent Chrome or Edge). Firefox has neither yet on most systems, so use Ollama or a cloud key there.
- **Search only "by words":** install an embedding model with `ollama pull nomic-embed-text`, or use an OpenAI, Gemini or Mistral key.
- **Markdown folder says it needs permission:** browsers sometimes ask again after a restart. Click **Allow access again** in Settings, and choose "Allow on every visit" if offered.
- **The side panel says it can't read the page:** browser pages (`chrome://`, extension stores) can't run extensions. On a normal site, reload the tab once after installing or updating. PDFs are read by the side panel itself; local files (`file://`) aren't supported.
- **A YouTube video has no transcript:** some videos have none (or YouTube doesn't show one); soroagent then uses the description, chapters and comments.
- **Something else went wrong:** Settings → Troubleshooting → **Copy diagnostic report** opens a GitHub issue with a scrubbed report attached. Read it before you submit.
- **Cloud API errors:**
  - *rejected the API key* means a wrong or expired key, or no billing set up
  - *rate limiting* means wait a minute
  - *model not found* means pick another model in settings

## License

soroagent is open source under the [MIT License](LICENSE). © 2026 [soroagent.com](https://soroagent.com).

---

<p align="center"><sub>tech is art. © 2026 <a href="https://soroagent.com">soroagent.com</a></sub></p>

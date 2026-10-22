<p align="center"><img src="extension/icons/icon-128.png" width="96" height="96" alt="soroagent owl"></p>

<h1 align="center">soroagent</h1>

<p align="center"><b>Your browser is your knowledge base.</b><br>
An AI companion for every web page that turns what you read into a personal library you can think with.</p>

<p align="center">Chrome · Edge · Brave · Arc · Firefox &nbsp;|&nbsp; macOS · Windows &nbsp;|&nbsp; AI in your browser, on your computer (Ollama, LM Studio…) or your own Claude, OpenAI or Gemini key</p>

---

## Why soroagent

soroagent sits beside every page as a small owl and does three things:

- **Understands the page.** Summaries and answers shaped by the site you're on: the accepted solution on Stack Overflow, the consensus in a Reddit or Hacker News thread, the status of a GitHub issue. This will improve productivity.
- **Archives what you read.** Every summary (and, if you like, every page you actually read) is filed into a personal library with a title, summary and consistent tags. It's searchable by meaning, and you can write it to your Obsidian or Logseq folder.
- **Lets you think with it.** Chat with everything you've read, see related notes on the page you're on, and turn your notes into a research brief, a decision record, a study guide or a draft. Every answer is cited to your own sources.

> **Browsing history, reinvented.** Not *"you visited 214 pages yesterday"* but *"here's what you read, what it said, and how it connects to what you already know."*

## Features

### Understand any page
- **Works out of the box.** The first-run setup looks for an AI on your computer and uses it without asking: Ollama if it's running, or Chrome's built-in AI (Gemini Nano). If neither is there, one click sets up Chrome's built-in AI or a small model that runs in the browser on your graphics chip (Qwen2.5-1.5B, a one-time 880 MB download). Or paste a Claude, OpenAI or Gemini key. If Ollama is running but blocks browser extensions, you get the one command that fixes it, ready to copy.
- **Ready before you ask.** A few seconds after you open a page, your model summarizes it in the background and works out the questions you're likely to have: how a product works and what it compares to, the background and the people in a news story, the consensus in a thread. Open the owl and the questions are there; click Summarize and the summary appears at once. Nothing is saved unless you act, and it never runs on mail, chat, banking, sign-in or checkout pages. Turn it off in Settings → On the page.
- **X keeps up with the timeline.** X loads more posts as you scroll, so soroagent collects every post that appears. The refresh button in the panel shows how many are new and redoes the summary and questions with all of them.
- **Summarize** gives you the page in a scannable format: a one-line TL;DR, then the key points. Summaries run in the background, so you can switch tabs; the result waits for you.
- **Ask** anything about the page. Questions about soroagent itself ("where is my data stored?", "is this open source?") first ask whether you mean soroagent or the website, then get an accurate answer.
- **Site profiles** read each site's structure before the AI sees it:

  | Site | What soroagent reads | What you get |
  |---|---|---|
  | Stack Overflow / Stack Exchange | the question, answers ranked with the **accepted** one first, code intact | **Accepted solution**, better alternatives, caveats |
  | Reddit threads | the post and its comment tree | **Thread consensus** and the most useful answer |
  | Hacker News | the story and its comment tree, reply depth kept | **Discussion consensus** and the main disagreements |
  | GitHub | issue or PR state, labels and conversation; READMEs | **Status** and next steps |
  | YouTube | title, channel, description, **chapters**, top comments | chapter-by-chapter overview and what viewers say |
  | Wikipedia | infobox facts, lead, outline | **Key facts**, with "citation needed" flagged |
  | X | posts with handles, verification and engagement | themes and notable posts, every @handle linked |

  The panel's site bar shows the mode (for example *Q&A · Accepted-solution mode*). LinkedIn, Amazon and major news sites have tuned prompts too.
- **Feeds** on X and Reddit: Summarize reads the posts that have loaded (on X, every post that appeared while you scrolled), and **Read more** loads the next batch. Promoted posts are left out.
- **Research** turns a summary into a starting point. soroagent offers topics from the summary (or type your own), searches the web, reads the top sources and writes a brief with numbered citations. Only the search query leaves your machine.

### Your personal library
- **Auto-filed and auto-tagged.** Every summary is saved with a title, short summary and tags. The tagger reuses the tags already in your library, so "AI Agents" files under your existing *ai-agents*.
- **Save** puts the page itself into your library, with its text for search.
- **Passive capture** (opt-in) saves the pages you actually read. That means pages where you were active for a while (45 seconds by default) and scrolled through at least half. Mail, chat, banking, logins, checkouts, search results, feeds and pages with a password box are never captured, and you can exclude any site.
- **Search by meaning.** Finds notes about the same idea even when the words differ, and still finds exact names. It uses a free local embedding model (`ollama pull nomic-embed-text`) or your OpenAI, Gemini or Mistral key; vectors stay on your device. Without one, it searches by words.
- **Related notes.** On the page you're reading, the panel shows *"📚 3 of your saved notes relate to this page"*. **Use in chat** brings them into the conversation, cited as [N1], [N2]…
- **Screenshots** of what you see go to their own gallery in your snippets.

### Ask your library
A chat console at the bottom of the snippets and summary history pages (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>). Ask follow-up questions over the past week, month, three months or all time, or focus on the open note with **About this note**:
- *What have I learned about this topic over the past month?*
- *Where do my saved sources disagree?*
- *What evidence supports this argument?*
- *What should I read next?*
- *What conclusions can I draw from these sources?*

Answers come in two parts, **From your sources** (every claim cited [S1], [S2]…) and **My interpretation**, with the notes used listed underneath. One click instead creates a **Research brief**, **Technical decision**, **Study guide** or **Draft**, which you can save, copy or download.

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
- **Sync across browsers.** Every browser where soroagent is installed can share one library, on any computer. There are no soroagent servers, so the shared copy lives in **your own storage**. Once you've saved 5 things, the owl offers it (or turn it on any time in Settings → Sync): click **Connect Google Drive**, sign in, and pick a passphrase; do the same in your other browsers. **Not now** keeps everything in that browser. It goes in a hidden folder in your Drive that only soroagent can see (soroagent can't see your other files). A WebDAV folder (Nextcloud, ownCloud, Synology, Koofr…) or a private GitHub Gist also work. It's **end-to-end encrypted** with your passphrase before it leaves the browser. Notes merge one by one (the newest wins; deletions carry over); each browser keeps its own AI connection and keys; screenshots stay local.
- **Backups and restore.** A backup file in `Downloads/soroagent/` is kept up to date automatically. After a reinstall, soroagent finds it and restores everything in one click. Snippets also export as Markdown or JSON.

### Make it yours
- **Prompts in settings.** Rewrite the system prompt for all websites or any one site, and click **Optimize with AI** to have your model improve it.
- **Any model.** An AI inside the browser (Chrome's built-in Gemini Nano, or Qwen2.5-1.5B on your graphics chip), a model server on your computer (Ollama, LM Studio, llama.cpp, Jan, any OpenAI-compatible server), or your own key for Anthropic Claude, OpenAI, Google Gemini, OpenRouter, Groq, Mistral, DeepSeek or xAI. soroagent recommends the best of your installed local models.
- **A quiet owl.** It places itself where it doesn't cover the page's own buttons, can be dragged to either side (remembered per site), and follows your browser's light or dark theme. Drag the panel's edges to resize it.

## Private by design

- **Your AI:** with an in-browser or local model, page text never leaves your computer. With a cloud API, page text goes only to the provider you chose, billed to your key.
- **API keys:** encrypted with a key that can't be exported, and sent only to their own provider.
- **Your data:** your library, history and settings live in your browser, and search vectors stay on your device.
- **Google Drive sync** asks only for soroagent's own app folder in your Drive (`drive.appdata`), never your files. The sign-in token stays in memory for the session.
- **Prepared on visit:** to have the summary and questions ready, your AI reads each page a few seconds after you open it (never mail, chat, banking, sign-in or checkout pages). It's on by default; with a cloud AI that sends each page you visit to it, so turn it off in Settings → On the page if you prefer.
- **Opt-in only:** passive capture, sync and the Markdown folder are off until you turn them on, and only go where you point them.
- **No tracking:** there are no soroagent accounts, servers, trackers or analytics.

Read the full [privacy policy](https://soroagent.github.io/privacy.html).

## Download

Current version: **v2.29.0**. The version is in each file name, so you can tell which build you have.

| Browser | Download | Install |
|---|---|---|
| Chrome, Edge, Brave, Arc | [**soroagent-chrome-2.29.0.zip**](https://github.com/soroagent/owl/raw/main/downloads/soroagent-chrome-2.29.0.zip) | Unzip, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the unzipped folder. |
| Firefox (128+) | [**soroagent-firefox-2.29.0.zip**](https://github.com/soroagent/owl/raw/main/downloads/soroagent-firefox-2.29.0.zip) | Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and choose the zip. |

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
| Any page | Click the owl. The panel has **Summarize** and **Save**, plus Home, Screenshot and this page's History in the header. On X, a refresh button shows how many new posts have loaded and redoes the summary with them. |
| Keyboard | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> opens the panel (change it at `chrome://extensions/shortcuts`). <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> opens Ask your library on the snippets page. |
| Right-click | *Summarize this page*, *Take a screenshot* |
| Toolbar owl | Click to open the panel; a number means summaries finished while you were away. Right-click for **Summary history**, **Saved snippets**, **Ask your library**, **Send feedback** and **Settings**. |

Your data carries over to every update. The Chrome build has a fixed extension ID (`jomghmmgdlajfonjihmagbhomimadpcg`), so a newer version loaded from any folder keeps the same storage, and stored data is upgraded automatically.

## Customizing

- **Prompts** are plain text in [`extension/prompts/`](extension/prompts), one file per site. Edit them, or use **Settings → Prompts**. Try a prompt against your local model with `npm run try-prompt -- --site x --action summarize --show-prompt`. See the [prompts guide](extension/prompts/README.md).
- **Site profiles** in [`extension/sites/`](extension/sites) teach soroagent a website's structure: `extract()` for single pages, `items` for feeds, and toggles. Copy [`_template.js`](extension/sites/_template.js); see the [site profiles guide](extension/sites/README.md).

## How it works

```
 web page ──► content scripts (panel in a closed shadow root, page extraction, prepared summary
                 │            and questions, passive capture)
                 ▼
          background worker ──► your model (Ollama, OpenAI-compatible or Anthropic API,
                 │                or in the browser: Gemini Nano, or WebLLM in the offscreen document)
                 │           ──► library index (embeddings + BM25), Markdown folder, encrypted sync
                 ▼
          extension pages (settings, snippets + Ask your library, summary history)
```

- **Model requests:** all of them come from the background worker, so pages' security policies don't block them. Three wire formats cover every provider: Ollama, OpenAI chat completions and Anthropic Messages. Reasoning models run with thinking off for speed, and `<think>` output is removed.
- **API keys:** encrypted with AES-256-GCM using a non-extractable key, in the extension's own IndexedDB. Only the background worker decrypts them, and settings pages only ever see the last four characters. First-run key entry happens in soroagent's own frame, so the page you're on can't see what you type.
- **Ollama 403s:** Ollama refuses `chrome-extension://` and `moz-extension://` origins by default. soroagent rewrites the `Origin` header on its own background requests only (a session `declarativeNetRequest` rule in Chrome, `webRequest` in Firefox), so you normally don't need `OLLAMA_ORIGINS`. When that can't apply (for example Ollama on another computer), the panel, setup and Settings show the one command that allows browser extensions (not every website), with a copy button.
- **In-browser AI:** Gemini Nano is Chrome's Prompt API. Qwen2.5-1.5B runs with [WebLLM](https://github.com/mlc-ai/web-llm) on WebGPU; its engine ships inside the extension (`extension/vendor/web-llm/`, Apache-2.0) because extensions can't run code from the web, and only the model weights download from Hugging Face. Small models get less page text (6,000 characters).
- **Search:** notes are embedded once (again only when they change) and stored as 8-bit vectors. A search fuses the meaning and word rankings (reciprocal rank fusion).
- **Sync:** the shared document is gzipped, encrypted with AES-GCM using a key derived from your passphrase (PBKDF2, 250,000 rounds), and merged per item with tombstones for deletions. The passphrase is never stored; the derived key is non-extractable.
- **Research** only reads public web pages: addresses on your computer or local network are never fetched. Only `http(s)` links are ever made clickable.

## Development

```
extension/
  background/   background.js (routing, menus) · llm.js (model client, embeddings) · browserai.js (Gemini Nano, WebLLM)
                jobs.js (summaries, auto-filing) · library.js (search) · mdexport.js (Markdown folder) · sync.js · research.js
                autobackup.js · secrets.js (encrypted keys) · recommend.js (local model ranking) · sw.js (Chrome entry)
  content/      assistant.js (the panel) · launcher.js (the owl) · capture.js (passive capture) · extract.js · faq.js · styles.js
  pages/        snippets (library + libchat.js console) · history · options (settings) · onboard (first run) · offscreen
  prompts/      prompt texts per site, with a fine-tuning guide
  sites/        site profiles: X, Reddit, Stack Overflow, Hacker News, GitHub, YouTube, Wikipedia
  shared/       config · prompts · markdown · snippets · knowledge (BM25, related notes) · backup · ask · brand
  vendor/       web-llm (the in-browser AI engine, vendored; see its README)
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
- **The owl doesn't appear:** browser pages (`chrome://`, extension stores, PDFs) can't run extensions. On a normal site, reload the tab after installing.
- **Cloud API errors:**
  - *rejected the API key* means a wrong or expired key, or no billing set up
  - *rate limiting* means wait a minute
  - *model not found* means pick another model in settings

## License

soroagent is open source under the [MIT License](LICENSE). © 2026 [soroagent.com](https://soroagent.com).

---

<p align="center"><sub>tech is art. © 2026 <a href="https://soroagent.com">soroagent.com</a></sub></p>

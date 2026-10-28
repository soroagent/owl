# soroagent Privacy Policy

**Effective October 24, 2026.** Applies to the soroagent browser extension for Chrome, Edge, Brave,
Arc and Firefox, version 2.48 and later.

## The short version

- soroagent has **no servers, no accounts, no analytics and no ads**. We (the soroagent project) never
  receive what you read, save or ask.
- Everything soroagent keeps is stored **in your browser, on your computer**.
- Page text and your questions go only to the **AI you choose**: one inside your browser, a model
  server on your computer, or a cloud AI with your own key. With the first two, nothing you read
  leaves your computer.
- A few features reach the web on your behalf (web search, PDFs, sync). Each is described below, and
  the ones that send data without a click can be turned off.
- If you turn on **Google Drive sync**, soroagent uses only its own hidden folder in your Drive, and
  everything in it is **encrypted with your passphrase** before it leaves your browser.

## 1. Who we are

soroagent is an open-source browser extension (MIT license), made by
[soroagent.com](https://soroagent.com). Its full source code is public at
[github.com/soroagent/owl](https://github.com/soroagent/owl), so anyone can check what it does with
data. In this policy, "soroagent", "we" and "us" mean the extension and the project behind it.

## 2. What soroagent stores, and where

soroagent stores the following **only in your browser's extension storage on your device**:

- **Your PKG (personal knowledge graph):** summaries, saved pages and PDFs, highlights, research briefs and the
  notes you create, with their titles, tags and the address of the page they came from.
- **Summary history** and the conversation in the panel while you use it.
- **A search index** of your library (numeric "embeddings" and word counts) so you can search it by
  meaning.
- **Your settings**, such as which AI you use, your prompts, how soroagent appears and where the owl
  sits.
- **Your AI API keys**, if you add any. They are encrypted (AES-256) with a key the browser keeps and
  cannot export. They are never included in backups or sync, and Settings only ever shows their last
  four characters.
- **Reading time on saved pages:** for pages you've saved to your PKG, and only those, how long
  you've actively read them (the tab in front and you using it), added up per page. It makes the
  topics you spend time on weigh more in your PKG. Pages you haven't saved are never recorded. It
  stays on this computer, is never synced, backed up or sent anywhere, and is deleted with "Delete
  all". Turn it off or clear it in Settings → PKG.
- **What's new since your last visit:** only on pages where you asked for it (a news front page,
  Hacker News, a subreddit), the addresses of the stories listed there (at most 600 per page, 40
  pages), so the next visit can mark the new ones. Never synced, backed up or sent anywhere; "Forget
  them" in Settings → PKG and "Delete all" clear it.
- **Hide clutter:** the sites where you turned it on (in your settings).
- **A diagnostic log** of soroagent's own errors (the last 50), kept in memory only while the browser is
  open. Web addresses, host names, page text, emails, keys and file paths are removed before anything
  is logged. See section 6.

soroagent does not collect your browsing history or read your browser's history (the reading time
above covers only pages you saved). It reads a page's content only:

- when you open soroagent on it or ask it to do something (Summarize, Ask, Save, Research, or one of the page's actions, such as a feed's Summarize the top 100 posts or an article's Confirmed vs claimed);
- when **automatic preparing** is on (section 3) and the side panel is open on the page, or you have
  been reading the page for 15 seconds;
- if you turn on **passive capture**, when you have actually read a page (time spent and how far you
  scrolled). Passive capture is off by default.

Automatic preparing and passive capture never run on mail, chat, banking, sign-in,
checkout, account or settings pages, search results, AI chat sites or local pages. On adult sites
(including any page that labels itself adult), betting and ad-redirect sites, unlicensed streaming
sites and railway booking (IRCTC), soroagent also suggests no questions: it reads nothing there
unless you ask it something yourself.

## 3. What leaves your computer

soroagent sends data over the network only in these cases, and only to the destinations listed.

| When | What is sent | To whom |
|---|---|---|
| You summarize, ask, research, use a page action (the top 100 posts or stories of an X, LinkedIn, Reddit or Hacker News feed, the top 50 videos on YouTube, a news front page's headlines, an article for Confirmed vs claimed or Story timeline, with your related snippets for the timeline, a thread for Best comments, a video for Chapter summaries), save (for its title and tags) or save a feed's posts, such as your **X bookmarks** (their text, in batches of 5, for topic tags) | The page text and your question | The AI you chose. **In the browser** (Chrome's built-in Gemini Nano, or the in-browser model) or **a local model server** (Ollama, LM Studio, llama.cpp, Jan): it stays on your computer. **A cloud AI** with your own key (Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI, or a custom address you enter): it goes to that provider, whose privacy policy applies. |
| You summarize or save the top 100 stories on Hacker News | Requests for the next pages of that list (for example news.ycombinator.com/news?p=2), as your browser would | Hacker News, the site you're on |
| **Automatic preparing**: the side panel is open on a page, or you've read it for 15 seconds | The page text (on X, the posts loaded so far), to prepare a summary and the questions you're likely to have | The AI you chose, as above. **On by default only with an AI in the browser or on your computer; off by default with a cloud key.** Nothing is saved unless you act. Turn it off in Settings → On the page. |
| You get an answer or a summary (**follow-up questions**) | Your question and the answer you got (not the page again), to write two follow-up questions | The AI you chose, as above. On by default; turn it off in Settings → On the page. |
| You open soroagent on a page (suggested questions), when automatic preparing is off but suggested questions are on | The start of the page text | The AI you chose, as above. Same defaults; Settings → On the page. |
| **Hide non-tech** is on for X, Reddit or YouTube (you switch it on per site) | The text of the posts as they load (the @handle and post text on X, titles on Reddit, video titles and channels on YouTube), in batches, so your AI can say which are about tech | The AI you chose, as above. Each post is sent once; nothing is stored. Switch it off in the panel's site bar. |
| Your library is indexed for search | The text of your notes | The embedding model you use: a local Ollama model, or your OpenAI, Gemini or Mistral key. |
| You click **Research** | Your research topic | A web search engine (DuckDuckGo, Brave Search or Bing, or a SearXNG server you set), then the top result pages are opened and read, as if you had visited them. Addresses on your computer or local network are never fetched. |
| You ask something **the page doesn't answer** | A short search query for your question | The same search engine, then the top result pages are read, as for Research. On by default; turn it off in Settings → On the page to get a button instead. |
| You open a **PDF** in the side panel, or choose "Summarize this PDF with soroagent" | A request for the PDF file | The site the PDF is on, as your browser would make to show it. It is read on your computer. |
| First-run setup | A request to `127.0.0.1:11434` to see whether Ollama is running | Your own computer only. |
| You choose an AI that runs **in the browser** | Nothing of yours | The model is downloaded once: Chrome's built-in AI by Chrome itself, from Google; the in-browser model (Qwen2.5-1.5B, about 880 MB) from Hugging Face (`huggingface.co/mlc-ai`). The in-browser model is not offered in Firefox. |
| You turn on **sync** | Your library, history and preferences, encrypted with your passphrase | The storage you pick: your Google Drive (section 4), a WebDAV server you name, or a private GitHub Gist under your account. |
| You click **Send feedback** | soroagent's version, your browser (Chrome or Firefox) and where you clicked, in the page address | soroagent.com's feedback page, which opens in a tab. |
| You click **Copy diagnostic report** | Nothing, until you choose to post it | It copies a scrubbed report (section 6) and opens a pre-filled issue on GitHub that you read and submit yourself; GitHub's privacy policy applies to what you post. |

soroagent never sends anything to a server run by us. It contains no analytics, telemetry,
automatic crash reporting, advertising or tracking code, and it never sells, rents or shares your
data.

When soroagent talks to an AI model server on your computer (such as Ollama), it sets the request's
`Origin` header to that server's own address so the server accepts it. This applies only to
soroagent's own requests to the server you configured; it never changes requests made by websites.

On YouTube, when you ask soroagent about a video, it opens YouTube's own transcript panel on the page
to read what's said, then closes it. This happens in your browser; nothing extra is sent.

## 4. Google Drive sync and Google user data

Sync is optional. soroagent offers it after you have saved a few things, and you can turn it on or off
any time in Settings → Sync across browsers.

### What soroagent accesses

When you click **Connect Google Drive**, Google asks you to allow one permission:
`https://www.googleapis.com/auth/drive.appdata` ("See, create, and delete its own configuration data
in your Google Drive"). This gives soroagent a **hidden folder in your Drive that only soroagent can
see**.

- soroagent **cannot** see, open, list or change any of your other Drive files.
- soroagent does **not** request your name, email address, contacts, Gmail, calendar, photos or any
  other Google data.

### How soroagent uses it

soroagent keeps one file there, `soroagent-sync.json`. It holds your PKG, summary history and
preferences, compressed and **encrypted in your browser with AES-256-GCM**, using a key derived from
your sync passphrase. Google stores only this encrypted data and cannot read it. Your API keys and
your reading time are never synced. Each browser where you connect with the same passphrase reads
the file, merges it with its own PKG and writes it back. That is the only use of this data.

### Sign-in tokens

The access token Google issues is kept only in the browser's memory for the current session, never
written to disk, and never sent anywhere except Google's own Drive API. Your passphrase is never
stored or sent; only a non-exportable key derived from it is kept in your browser.

### Sharing

Data from your Google Drive is not shared with anyone, not used for advertising, not used to train AI
models and not read by people. It never passes through any server of ours.

### Limited Use

soroagent's use and transfer of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

### Removing access

Click **Stop syncing in this browser** in Settings to disconnect; this also revokes the token. You can
remove soroagent's access at any time at
[myaccount.google.com/connections](https://myaccount.google.com/connections), and delete its hidden
data in Google Drive → Settings → Manage apps → soroagent → Delete hidden app data.

## 5. Files soroagent writes on your computer

- **Automatic backup** (off unless you turn it on): a backup of your library and settings (never your
  API keys) kept in your Downloads folder under `soroagent/`, so you can restore it after a reinstall.
  It is rewritten a few minutes after your library changes (at most every 30 minutes), and each save
  shows in your browser's downloads like any other. Settings → Library → Backup & restore.
- **Markdown folder** (optional): if you choose a folder, such as an Obsidian vault, soroagent writes
  your notes there as `.md` files. In Firefox these go to `Downloads/soroagent/notes`.
- **Exports** you start yourself (Markdown or JSON) are saved where your browser saves downloads.

## 6. Diagnostics

To help fix problems, soroagent keeps a short log of its own errors (the last 50) in the browser's
memory while it's open: crashes, site readers that found nothing, AI replies it couldn't read, and
storage upgrades. It is cleared when the browser closes and is never synced or backed up. Web
addresses, host names, page text, emails, keys and file paths are removed before anything is logged.
Nothing is sent anywhere unless you choose Settings → Troubleshooting → **Copy diagnostic report**,
which copies the report and opens a pre-filled GitHub issue for you to read and submit yourself.

## 7. Browser permissions and why soroagent needs them

- **Read and change data on all websites:** to show the owl and read the page you ask about (and,
  when they're on, prepare pages and capture pages you read), and to reach your AI provider, web
  search, PDFs and your sync storage.
- **Storage** and **unlimited storage:** to keep your library, settings and search index in your
  browser.
- **Downloads:** for the automatic backup (if you turn it on), exports and the Firefox Markdown folder.
- **Identity:** to open Google's own sign-in window when you connect Google Drive.
- **Side panel** (Chrome) / **sidebar** (Firefox): to open soroagent beside the page if you choose to.
- **Declarative net request** (Chrome) / **web request** (Firefox): to set the `Origin` header on
  soroagent's own requests to a model server on your computer (section 3).
- **Offscreen document** (Chrome): to save the backup file and to run pdf.js and the in-browser model.
- **Context menus, scripting and alarms:** for right-click actions, to start soroagent in tabs that
  were open before it was installed, and for periodic backup and sync.

## 8. Your control over your data

- You can view, search, export and delete any note on the Snippets page, and export or delete
  everything in Settings → Backup & restore.
- Automatic preparing, suggested questions, follow-up questions, web answers, reading time on saved pages, passive capture, the automatic backup and
  sync can each be turned off in Settings.
- Uninstalling soroagent deletes everything it stored in that browser. Backups in your Downloads
  folder, Markdown files and any sync file stay until you delete them.
- Because we hold none of your data, we cannot see it, recover it or hand it to anyone. If you lose
  your sync passphrase, the synced copy cannot be decrypted; your local library is unaffected.

## 9. Children

soroagent is not directed at children under 13, and we do not knowingly collect any personal
information from anyone.

## 10. Changes to this policy

If soroagent's handling of data changes, we will update this policy and its effective date before the
change ships. Every change is visible in
[this file's history](https://github.com/soroagent/owl/commits/main/PRIVACY.md).

## 11. Contact

Questions or concerns about privacy: open an issue at
[github.com/soroagent/owl/issues](https://github.com/soroagent/owl/issues), or visit
[soroagent.com](https://soroagent.com).

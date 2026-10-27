# Site-specific prompts

Every prompt soroagent sends to the model lives in this folder as plain text. To change how soroagent summarizes, answers questions or labels what you save, edit the prompt here; you don't need to touch any extension code.

| File | Used on |
|---|---|
| [`default.js`](default.js) | Every website, and for any action a site file leaves out |
| [`x.js`](x.js) | X (formerly Twitter) |
| [`reddit.js`](reddit.js) | Reddit, with separate prompts for thread pages |
| [`_template.js`](_template.js) | Starting point for a new site (not loaded) |
| [`samples/`](samples) | Example inputs for trying prompts (not shipped in the extension) |

## How prompts are chosen

For each action, soroagent combines up to three layers. A later layer wins, separately for `system` and `user`:

1. `prompts/default.js`
2. `prompts/<site id>.js`, for example `x.js`, when the page matches the site profile with that id in [`../sites/`](../sites)
3. that file's `pages.<page type>` overrides, for the kind of page you're on (see below)
4. `prompts` written directly inside a site profile (rarely needed)

So a site file only needs the parts it changes. For example, `x.js` replaces the `user` prompt for **Save** but keeps the default `system` prompt.

## Prompts for specific page types

A site often has different kinds of pages, such as a feed of posts and a single discussion thread. Its site profile's `pageInfo()` names the page type (for Reddit: `home`, `subreddit`, `search`, `user`, `thread`), and the prompt file can override actions just for that type:

```js
definePrompts('reddit', {
  summarize: { user: `…summarize these posts…` },           // feeds
  pages: {
    thread: { summarize: { user: `…summarize this discussion…` } },  // thread pages
  },
});
```

One focused prompt per page type works much better than a single prompt that says "if this is a thread, do X, otherwise Y". Small models tend to answer both branches.

## Fine-tuning loop

1. **Try the current prompt** on a sample, outside the browser, using your local model:

   ```bash
   npm run try-prompt -- --site x --action summarize --show-prompt
   ```

2. **Edit** the prompt in `default.js` or the site's file.
3. **Run it again** and compare. Use `--model` to check a small and a large model; prompts that work on both are the most robust:

   ```bash
   npm run try-prompt -- --site x --action summarize --model llama3.2:3b
   npm run try-prompt -- --site x --action summarize --model qwen3:30b-a3b
   ```

4. **Try real content.** Copy text from a page into a file and pass `--input my-page.txt`. For item sites like X, use the numbered format in `samples/x-posts.txt`.
5. Run `npm test` (checks every prompt file), then `npm run build`, and reload the extension to use it in the browser.

`try-prompt` options:

| Option | Default | |
|---|---|---|
| `--site` | `default` | Prompt set to use (`default`, `x`, …) |
| `--action` | `summarize` | `summarize`, `notes`, `ask`, `save` |
| `--input` | a file in `samples/` | Text to run the prompt on |
| `--page` | the sample's page type | Use that page type's prompts, for example `--site reddit --page thread` |
| `--question` | | The question, for `ask` |
| `--context` | an X search description for `x` | Fills `{{context}}` |
| `--model` | best installed model | Any model on your server |
| `--url` | `http://127.0.0.1:11434` | Your local server (or set `SOROAGENT_URL`) |
| `--show-prompt` | off | Print the exact messages sent to the model |

For `save`, `try-prompt` also prints the title, summary and tags soroagent read from the reply.

## Actions

| Action | When it runs | Reply format |
|---|---|---|
| `summarize` | **Summarize** | Markdown |
| `notes` | Long content is summarized in parts: notes per part, then `summarize` merges them | Markdown |
| `ask` | A question typed in the panel. `system` carries the page; `user` is the question | Markdown |
| `save` | Labels each auto-saved summary (and saved selections): title, summary and tags | JSON `{ "title", "summary", "tags" }` |
| `questions` | Suggested questions on the panel's opening screen: one per slot (Gist, Understand, Check, Next) from the site's template in `shared/templates.js`, in the page's language (`{{context}}` = what kind of page it is, `{{slots}}` = the slot patterns). Sent in quick mode: no long thinking | JSON `{ "questions": [] }`, 4 in slot order |
| `followUps` | Two follow-up questions under each answer (`{{question}}` = what was asked, `{{content}}` = the answer). Quick mode | JSON `{ "questions": [] }` |
| `focus` | **Tech only**: the page filtered to one topic (`{{question}}` = what the topic covers, from `FOCUS_TOPICS` in `shared/prompts.js`); items cited [n], video moments [m:ss], both made clickable | Markdown |
| `techSort` | **Hide non-tech** on feeds: which of the numbered items in `{{content}}` are about `{{question}}` (the topic). Quick mode | JSON `{ "tech": [] }` (item numbers) |
| `tagBatch` | **X bookmarks** saved to the PKG: 1–3 topic tags per numbered post in `{{content}}`, reusing the tags in `{{context}}`. Quick mode | JSON `{ "tags": { "1": [] } }` |
| `researchTopics` | **Research**, step 0: topics offered to the reader before research starts | JSON `{ "topics": [] }` |
| `researchQuery` | **Research**, step 1: the web search query | JSON `{ "query" }` |
| `research` | **Research**, step 2: the cited brief. `{{question}}` is the query, `{{content}}` the numbered web sources, `{{context}}` what the user already read | Markdown |

You can reword anything, but **keep the JSON field names** in the `save` prompt so soroagent can read the reply. Every prompt set can also define a `persona` string, which fills `{{persona}}`.

## Placeholders

| Placeholder | Value |
|---|---|
| `{{persona}}` | The `persona` of the prompt set (falls back to `default.js`) |
| `{{title}}`, `{{url}}` | Page title and URL |
| `{{content}}` | The text being worked on: page text, numbered posts or the selection |
| `{{page}}` | Title, URL and content wrapped in `<page>` tags, plus a truncation note if needed |
| `{{count}}` | Number of posts in `{{content}}` (item sites) |
| `{{context}}` | What the page is, from the site profile, for example `These are top posts from X search results for the query "local llm".` |
| `{{note}}` | The truncation note on its own, or empty |
| `{{question}}` | The user's question (`ask` only) |
| `{{slots}}` | The four question slots for the site and page type, Gist · Understand · Check · Next (`questions` only; edit them in `shared/templates.js`) |

## Add prompts for a new site

1. Make sure there's a site profile for it in [`../sites/`](../sites) (see that folder's README). Its `id` connects the two.
2. Copy `_template.js` to `<id>.js` and change the id in `definePrompts('<id>', …)`.
3. Keep only the actions you want to change.
4. Run `npm test`, then `npm run build`. New files in this folder are picked up automatically.

## Tips for good prompts

- **Say what the content is.** "Posts from an X search for …" or "a GitHub issue thread" helps more than general instructions. `{{context}}` is the place for it.
- **Ask for structure** (headings, bullets), and say what to leave out.
- **Give concrete examples** of what you want and don't want. One example phrase works better than adjectives.
- **Write for small models too.** Short, direct sentences and explicit formats help 3–8B models most.
- **Change one thing at a time** and compare runs on the same input.

## Prompts for websites without a site profile

A prompt file can also name the websites it covers, with `label` (shown in settings) and `hosts`
(subdomains match too). This is how YouTube, GitHub, Hacker News, Wikipedia, LinkedIn, Amazon,
Stack Overflow and news sites get their own prompts:

```js
root.soroagent.definePrompts('youtube', {
  label: 'YouTube',
  hosts: ['youtube.com', 'youtu.be'],
  persona: `You are soroagent, …`,
  summarize: { system: `{{persona}}`, user: `{{page}}\n\nSummarize this YouTube video page. …` },
});
```

Add the new file to the `<script>` tags in `pages/options.html` and `pages/snippets.html` (a test checks this).
Users can rewrite any set's `persona` in **Settings → Prompts**, and optimize it with their model.


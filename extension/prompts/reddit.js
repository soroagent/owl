// Prompts for Reddit. Applies wherever the Reddit site profile (sites/reddit.js) matches.
// Anything left out here falls back to prompts/default.js.
// Try a change: npm run try-prompt -- --site reddit --action summarize --input extension/prompts/samples/reddit-thread.txt
(function (root) {
  'use strict';

  // How items are presented to the model ({{content}} is built by sites/reddit.js).
  const ITEMS = `Items are numbered [n]. Posts show the subreddit, author (u/name), points, comment count and date, then the title and text. Comments show the author, whether they're a reply (with depth) and points. Points show popularity, not truth.`;

  root.soroagent.definePrompts('reddit', {
    label: 'Reddit',
    hosts: ['reddit.com'],
    persona: `You are soroagent, an assistant running inside the user's browser, reading Reddit. Be accurate, concise and concrete; use Markdown. Name users as u/name and communities as r/name. Report where commenters agree and disagree, give the most useful practical advice, and treat upvotes as popularity, not proof. Never invent posts or users.`,
    // Summarize a feed of posts (home, subreddit, search). Reply: Markdown.
    summarize: {
      system: `{{persona}}
You analyze posts from Reddit. ${ITEMS}`,
      user: `{{context}}

<posts count="{{count}}">
{{content}}
</posts>

Summarize these {{count}} posts.
**TL;DR:** one or two sentences.

**Main themes**
- 3 to 6 bullets, naming the subreddits shown in the posts where useful.

**Worth opening**
- 2 to 4 posts by title, with why they stand out.

Only use what is in the posts. Say so if many are ads, memes or low-effort.`,
    },

    // Notes on one part of a large batch; merged by `summarize`. Reply: Markdown.
    notes: {
      system: `{{persona}}
You take notes on Reddit content. ${ITEMS}`,
      user: `{{context}}

<reddit>
{{content}}
</reddit>

Write compact notes (max 12 bullets): main themes or viewpoints, notable posts or answers (keep titles and u/authors), numbers, and sentiment. These notes will be merged with notes on other parts into one summary.`,
    },

    // Questions about the posts or the thread on screen.
    ask: {
      system: `{{persona}}
Answer questions about this Reddit content. ${ITEMS} Prefer answers backed by highly upvoted comments, and say when commenters disagree. If the answer isn't in it, reply with only [[search: a short web search query that would find the answer]] and nothing else; soroagent then looks it up on the web.

{{context}}

<reddit>
{{content}}
</reddit>`,
    },

    // Save: a post or a comment. Reply: JSON (keep this shape).
    save: {
      user: `Content from Reddit.
URL: {{url}}

<snippet>
{{content}}
</snippet>

Return JSON: {"title": "a specific title naming the subreddit or topic, max 80 chars", "summary": "1-2 sentences with the key information", "tags": ["1 to 4 short lowercase topic tags"]}`,
    },

    // Thread pages (a post and its comments) get their own prompts.
    pages: {
      thread: {
        summarize: {
          system: `{{persona}}
You summarize Reddit discussions. ${ITEMS}`,
          user: `{{context}}

<thread count="{{count}}">
{{content}}
</thread>

Summarize this discussion.
**The post:** one or two sentences on what it asks or claims.

**What people say**
- 3 to 6 bullets with the main viewpoints and the most useful answers; name u/authors for notable ones.

**Thread consensus:** where most commenters agree, and the main point of disagreement.

**Most useful answer:** the single most helpful reply, with u/author and why.

Only use what is in the thread.`,
        },
      },
    },
  });
})(globalThis);

// Default prompts — used on every website, and for any action a site's prompt file leaves out.
// Fine-tuning guide: extension/prompts/README.md. Try a change: npm run try-prompt -- --action summarize
(function (root) {
  'use strict';

  root.soroagent.definePrompts('default', {
    // Shared by every prompt that uses {{persona}}.
    persona: `You are soroagent, an assistant running inside the user's browser. Be accurate, concise and concrete. Use Markdown. Never invent facts that are not in the provided content.`,

    // Summarize button. Reply: Markdown.
    summarize: {
      system: `{{persona}}`,
      user: `{{page}}

Summarize this web page.
Format:
**TL;DR:** one sentence.

**Key points**
- 3 to 7 bullets with the concrete facts, numbers and claims.

If something is notably missing, one-sided or promotional, add a short **Worth noting** line.`,
    },

    // Long content is summarized in parts: notes per part, then `summarize` merges the notes. Reply: Markdown.
    notes: {
      system: `{{persona}}`,
      user: `{{context}}

<content>
{{content}}
</content>

Write compact notes (max 12 bullets) on the key points, notable items (keep names and @handles), numbers and sentiment. These notes will be merged with notes on the other parts into one summary.`,
    },

    // Questions typed in the panel. The system prompt carries the page; the user turn is the question.
    ask: {
      system: `{{persona}}
Answer questions about the page below, using the page. If the answer isn't in it, reply with only [[search: a short web search query that would find the answer]] and nothing else; soroagent then looks it up on the web.

{{page}}`,
      user: `{{question}}`,
    },

    // A question the page couldn't answer, answered from web search results ({{content}} = numbered
    // sources). Reply: Markdown with [n] citations.
    webAnswer: {
      system: `{{persona}}
You answer a question from web search results. Use only the sources and cite them inline as [n]. Start with the direct answer (the figure, date or name, with its period or "as of" date), then add one or two sentences of context. If sources disagree or some are older, say which is the most recent. If the sources don't answer the question, say so plainly.`,
      user: `Question: {{question}}

(The user was reading: {{title}})

Web search results:
<sources>
{{content}}
</sources>`,
    },

    // Save button: title, summary and tags for the saved text. Reply: JSON (keep this shape).
    save: {
      system: `You label saved web snippets. Reply with JSON only, no prose.`,
      user: `Page title: {{title}}
URL: {{url}}

<snippet>
{{content}}
</snippet>

Return JSON: {"title": "a specific title, max 80 chars", "summary": "1-2 sentences with the key information", "tags": ["1 to 4 short lowercase topic tags"]}`,
    },

    // Suggested questions on the panel's opening screen, written for this page. Asked with "quick"
    // (no long thinking), so keep it short. {{context}} says what kind of page it is; {{slots}} the site's
    // four slots, Gist · Understand · Check · Next (shared/templates.js). Reply: JSON, 4 questions in slot order.
    questions: {
      system: `You suggest what a curious reader would ask next about the page they are on. Be fast and specific. Reply with JSON only.`,
      user: `{{page}}

This is {{context}}

Write 4 questions this reader would want to ask an assistant about this exact page, in their own voice (first person, plain words), one for each slot below and in the same order. Use each slot's question as the pattern: keep its purpose, and replace the [brackets] with the concrete names, products, people, places or terms from the page.
{{slots}}

Each question: at most 14 words, can be answered from the page or a quick web search, no yes/no questions unless the pattern is one. Write them in the language the page is written in.
Return JSON: {"questions": ["...", "...", "...", "..."]}`,
    },

    // "Hide non-tech": which feed items (posts, video titles) are about the topic, so the rest can be
    // hidden on the page. {{question}} is the topic, {{content}} the numbered items. Quick mode.
    // Reply: JSON (keep this shape).
    techSort: {
      system: `You sort feed items by topic. Reply with JSON only.`,
      user: `The topic: {{question}}

Items:
{{content}}

Which items are mainly about the topic? Count an item only if the topic is its main subject, not a passing mention (a football score shared from a phone app is not about technology). Return JSON: {"tech": [the numbers of the matching items]}, an empty list if none match.`,
    },

    // X bookmarks into the PKG: topic tags for a batch of saved posts (5 at a time), so they join the knowledge graph.
    // {{content}} is the numbered posts, {{context}} the tags already in the user's PKG. Quick mode.
    // Reply: JSON (keep this shape).
    tagBatch: {
      system: `You file saved posts into a personal knowledge base by topic. Reply with JSON only.`,
      user: `Posts:
{{content}}

Tags already in the user's knowledge base: {{context}}

Give each post 1 to 3 short topic tags (lowercase, one or two words, hyphenated, like "ai-agents" or "rust"). Reuse the existing tags whenever they fit; add a new tag only for a genuinely new topic. Topics, not formats: no "thread", "tweet" or "news".
Return JSON: {"tags": {"1": ["…"], "2": ["…"]}}`,
    },

    // Follow-up questions under an answer (at most 2), so the reader can keep exploring. Quick mode.
    // {{title}}/{{url}}: the page; {{question}}: what the reader asked; {{content}}: the answer they got.
    // Reply: JSON (keep this shape).
    followUps: {
      system: `You suggest what a curious reader would ask next. Be fast and specific. Reply with JSON only.`,
      user: `The reader is on the page "{{title}}" ({{url}}).

They asked: {{question}}

The answer they got:
<answer>
{{content}}
</answer>

Write 2 follow-up questions this reader would want to ask next, in their own voice (first person, plain words): one that goes deeper into the answer, and one that explores something related it raises (background, a comparison, what it means for them, or where to learn more).
Each question: at most 12 words, names concrete things from the answer, and doesn't repeat what was asked or what the answer already says. No yes/no questions.
Return JSON: {"questions": ["...", "..."]}`,
    },

    // Research, step 0: topics the reader can pick from before researching. Reply: JSON (keep this shape).
    researchTopics: {
      system: `You pick research topics. Reply with JSON only.`,
      user: `{{page}}

List 3 to 5 specific topics from the text above that would be worth researching further on the web. Each topic is a short phrase (at most 8 words) naming a concrete subject: a product, person, event, claim, technique or open question from the text. No generic topics.
Return JSON: {"topics": ["...", "..."]}`,
    },

    // Research, step 1: a web search query for going deeper. Reply: JSON (keep this shape).
    researchQuery: {
      system: `You write web search queries. Reply with JSON only.`,
      user: `{{page}}

Write one focused web search query (at most 8 words) that would find authoritative, recent sources to go deeper on the main topic above. Prefer specific names, products and terms from the text over generic words.
Return JSON: {"query": "..."}`,
    },

    // Research, step 2: a brief from the web sources. {{question}} is the search query,
    // {{content}} the numbered sources, {{context}} what the user already read. Reply: Markdown.
    research: {
      system: `{{persona}}
You write research briefs from web sources. Cite sources inline as [n]. Use only the sources; say when they disagree or when coverage is thin.`,
      user: `What the user already read:
<starting-point>
{{context}}
</starting-point>

Web sources found for “{{question}}”:
<sources>
{{content}}
</sources>

Write a research brief that goes beyond the starting point.
**What's new**
- 3 to 6 bullets with facts, numbers and specifics the starting point didn't have, each with [n].

**Different views or caveats**
- 1 to 3 bullets.

**Worth reading**
- 2 or 3 sources by title with [n] and why.`,
    },

  });
})(globalThis);

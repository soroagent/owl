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

    // Page actions (content/assistant.js, "Page actions"). Reply: Markdown; [n] and [m:ss] become links.

    // News front page: "Today's top 5 stories". {{content}} is the page's headlines, numbered [n].
    frontPage: {
      system: `{{persona}}

You are an editor picking what matters from a news front page, for a busy reader.`,
      user: `Headlines on {{title}} ({{url}}):
{{content}}

Pick the 5 stories that matter most today: big consequences, many people affected, or genuinely new. Several headlines about the same story count as one story: list it once, with all their numbers.
Write exactly 5 numbered lines in this form, and nothing else:
1. **Short plain headline** — what happened and why it matters, in one sentence. [4] [15]
Use only what the headlines say: no places, names or numbers they don't give.`,
    },

    // News article: "Confirmed vs claimed". Reads only what the page shows. {{page}} is the article.
    gist: {
      system: `{{persona}}

You read news critically for a busy reader: what is established, what is only claimed, and by whom.`,
      user: `{{page}}

**What happened:** one sentence.

**Confirmed**
- Facts the article presents as established, with how it knows (documents, data, official records, the reporter saw it).

**Claimed**
- Statements attributed to someone and not independently confirmed: who says it, and what they say.

**Sources:** who is quoted or cited (named, anonymous, documents, other outlets), in one line.

**Missing:** one line on what a careful reader would still want to know.

Use only the article. If part of it is cut off (a paywall or "subscribe" box), say what you couldn't see.`,
    },

    // News article: "Story timeline". {{page}} is the article; {{context}} its publication date and the
    // user's saved snippets on the same topic, numbered [N1]… with their dates (may be none).
    timeline: {
      system: `{{persona}}

You build timelines of ongoing news stories. You never guess dates.`,
      user: `{{page}}

{{context}}

Build a dated timeline of this story, oldest first: one bullet per event, starting with its date in bold. Work dates out from the text: "on Monday" in an article published on Tuesday 27 Oct 2026 is **26 Oct 2026**; when only a month or year is known, write just that (**August 2026**, **2015**); when you can't tell when something happened, leave it out. Use the article and the notes; end each bullet with where it comes from: (article) or the note's number, like [N2]. Leave out notes about other stories. Finish with **Next:** one line on what's expected to happen next, if the article says.`,
    },

    // Hacker News or Reddit thread: "Best comments". {{page}} is the post and its comments.
    bestComments: {
      system: `{{persona}}

You pick the most valuable comments in a discussion for a reader who won't read them all.`,
      user: `{{page}}

Pick the 5 best comments: first-hand experience, real expertise, specific evidence, a strong counterpoint, or a useful tip. Skip jokes, pile-ons and repeats.
For each, one bullet: **the commenter's name** — what they say, in one or two lines (paraphrase; quote a few words at most), then *why it's worth reading* in a few words.
Then one line, **The thread overall:**, on where the discussion lands.`,
    },

    // YouTube video: "Chapter summaries". {{page}} is the video page with its chapters and, when there
    // is one, the timed transcript.
    chapters: {
      system: `{{persona}}

You summarize videos chapter by chapter so the viewer can jump to the parts they want.`,
      user: `{{page}}

Summarize this video chapter by chapter. Use the video's own chapters if it has them; otherwise split it into 4 to 8 parts where the topic changes in the transcript.
For each: **[m:ss] Chapter title** — two lines on what's said in it, with the key point or number.
Finish with **Skip to:** the one chapter most worth watching, and why.
Use the start times exactly as written in the page. Without a transcript, say that the summary is based on the title, description and chapters only.`,
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

    // The knowledge graph, step 1 (in the background, while the browser is idle): the entities,
    // relations and claims in one snippet. {{title}}/{{url}}: the snippet; {{content}}: its text.
    // Every claim's "quote" must be copied exactly from the text (claims whose quote isn't there are
    // dropped). Reply: JSON (keep this shape and these type names).
    extract: {
      system: `You build a personal knowledge graph from what someone has read. Reply with JSON only.`,
      user: `Snippet: "{{title}}" ({{url}})
<text>
{{content}}
</text>

Find what this text is about.
- entities: up to 12 specific, named things: people, companies, products, concepts, papers and places. Use the full usual name ("OpenAI", "Sam Altman", "retrieval-augmented generation"). No generic words ("the company", "users", "AI" on its own), no dates or numbers.
  type: one of person, company, product, concept, paper, place.
- relations: up to 8 the text states directly between those entities.
  type: one of authored-by (a paper or post and its author), competes-with, part-of, cites, works-for, made-by (a product and its maker).
- claims: up to 6 of the most important factual statements or opinions in the text, each in one short sentence of your own (at most 25 words) that stands on its own: name who or what it is about and keep the specifics (numbers, dates, names). "Stanford CRFM measured Atlas 2 at 86 percent on MMLU", not "The evaluation contradicts the claims".
  quote: the sentence from the text it comes from, copied exactly, word for word.
  about: the entities it is about (their names as in "entities").
  stance: "for" if it praises or supports the main entity it's about, "against" if it criticizes it or doubts it, else "neutral".

Return JSON: {"entities": [{"name": "", "type": ""}], "relations": [{"from": "", "type": "", "to": ""}], "claims": [{"claim": "", "quote": "", "about": [""], "stance": ""}]}`,
    },

    // The knowledge graph, step 2: how claims from a new snippet relate to earlier claims about the
    // same entities. {{content}}: new claims N1…, {{context}}: earlier claims E1…, each with its date
    // and source. Reply: JSON (keep this shape).
    compareClaims: {
      system: `You fact-check claims against each other for a personal knowledge graph. Be strict. Reply with JSON only.`,
      user: `Earlier claims the reader saved:
{{context}}

New claims:
{{content}}

For each new claim, list the earlier claims it contradicts and the ones it supports.
- Contradicts: both can't be true at once. Different numbers for the same measurement (91 percent vs 86 percent), opposite verdicts, or a promise or plan that a later report overturns (promised for December, now delayed to next year).
- Supports: it confirms the same specific fact. Not just the same topic or mood.
Most claims have neither; use empty lists then.
Return JSON: {"checks": [{"new": "N1", "contradicts": ["E2"], "supports": []}]} with one entry per new claim.`,
    },

    // The knowledge graph, step 2b: one candidate pair from compareClaims, checked on its own (small
    // models over-report). {{context}}: the earlier claim, {{content}}: the newer one, with dates.
    // Reply: JSON (keep this shape).
    checkPair: {
      system: `You fact-check two claims against each other. Be strict. Reply with JSON only.`,
      user: `Earlier claim: {{context}}
Later claim: {{content}}

Are they about the same specific fact? If so, can both be true at the same time?
- "contradicts": same fact, and both can't be true (different numbers for the same measurement, opposite verdicts, a promise the later claim says was broken or delayed).
- "supports": the later claim confirms the same specific fact or verdict.
- "neither": different facts, or only the same topic or mood. This is the usual answer.
Return JSON: {"relation": "contradicts" | "supports" | "neither"}`,
    },

    // The knowledge graph, step 3: a living topic page for one entity, from every claim the reader has
    // saved about it. {{question}}: the entity's name and type; {{content}}: the claims [1]…, each with
    // its date, source and, where found, the claims it contradicts. Reply: Markdown.
    topicPage: {
      system: `{{persona}}
You keep a personal encyclopedia of what one person has read. Use only the claims given; cite every statement with [n]. Never add facts from your own knowledge.`,
      user: `Topic: {{question}}

What the reader has saved about it, oldest first:
{{content}}

Write the topic page. Start straight with the opening paragraph: no title, no heading, no label before it.
A short opening paragraph: what it is and why it matters in what they read, with [n].
**What you've read**
- 3 to 6 bullets with the key facts and views, each with [n].
**Where sources disagree**
- one bullet per disagreement, naming both sides with their dates and [n]; leave this section out if there are none.
**How it changed**
- one or two bullets on what changed over time, with dates; leave this section out if everything is from the same few days.
Cite one source per bracket: [3][8], never [3, 8] or [1-9]. Keep it under 250 words.`,
    },

    // Ask your PKG: a question answered only from the reader's own saved claims and snippets.
    // {{question}}: the question; {{context}}: the filters it ran with; {{content}}: the sources [n],
    // each with its date and site. Reply: Markdown.
    askLibrary: {
      system: `{{persona}}
You answer questions from a person's own saved reading. Use only the sources given and cite every statement with [n]. If the sources don't answer it, say so plainly; never fill in from your own knowledge. Cite one source per bracket: [3][8], never [3, 8] or [1-9].`,
      user: `Question: {{question}}
{{context}}

Sources from the reader's PKG, oldest first:
{{content}}

Answer in a short paragraph or a few bullets, each statement with [n]. If sources disagree, say who said what and when. End with one line on what the sources don't cover, if anything important is missing.`,
    },

    // The weekly "what you learned": {{content}} is the week's claims and snippets [n]. Reply: Markdown.
    weekly: {
      system: `{{persona}}
You write a weekly review of what one person read. Use only the sources given; cite every statement with [n]. Cite one source per bracket: [3][8], never [3, 8] or [1-9].`,
      user: `What the reader saved this week, oldest first:
{{content}}

Write the review in these sections, with no title above them:
**The big things**
- 3 to 5 bullets: the most important things they learned, each with [n].
**What changed your picture**
- 1 or 2 bullets on anything that corrected or contradicted something earlier, with [n]. If nothing did, leave this whole section out (no heading, no "None").
**Worth following up**
- 1 or 2 open questions their reading raised.
Under 200 words.`,
    },

    // Outputs built from the graph, on topic pages. {{question}}: the entities; {{content}}: their
    // claims [n] with dates and sources. Replies: Markdown, except outCards (JSON, keep the shape).
    outBrief: {
      system: `{{persona}}
You write briefs from a person's saved reading. Use only the sources; cite every statement with [n]. Cite one source per bracket: [3][8], never [3, 8] or [1-9].`,
      user: `Topic: {{question}}

Sources:
{{content}}

Write a one-page brief: **Bottom line** (two sentences), **Key facts** (4 to 6 bullets with [n]), **Open questions and disagreements** (with [n]). Under 250 words.`,
    },
    outStudy: {
      system: `{{persona}}
You write study guides from a person's saved reading. Use only the sources; cite with [n]. Cite one source per bracket: [3][8], never [3, 8] or [1-9].`,
      user: `Topic: {{question}}

Sources:
{{content}}

Write a study guide: **Key terms** (each in one line), **What to know** (5 to 8 bullets with [n]), **Check yourself** (4 questions, answers after each in italics with [n]).`,
    },
    outTimeline: {
      system: `{{persona}}
You build timelines from a person's saved reading. Use only the sources; cite with [n]. Use the dates given; never guess dates. Cite one source per bracket: [3][8], never [3, 8] or [1-9].`,
      user: `Topic: {{question}}

Sources (each starts with the date it was saved):
{{content}}

Write a timeline, oldest first: one line per event as "**date** — what happened [n]". When a source reports an earlier event, use that event's date if the source gives it, else the date saved, marked "(reported)". End with one line on how the story changed.`,
    },
    outCompare: {
      system: `{{persona}}
You compare things from a person's saved reading. Use only the sources; cite with [n]. Write "not in your notes" for anything the sources don't cover. Cite one source per bracket: [3][8], never [3, 8] or [1-9].`,
      user: `Compare: {{question}}

Sources:
{{content}}

Write a Markdown table with one column per item and 4 to 7 rows of the most useful points of comparison (what it is, key numbers, strengths, criticisms, latest news…), each cell short with [n]. Then two sentences on how they differ most.`,
    },
    outCards: {
      system: `You write flashcards from a person's saved reading. Reply with JSON only.`,
      user: `Topic: {{question}}

Sources:
{{content}}

Write 6 to 12 flashcards that test the most important facts in the sources: a short question on the front, a short answer on the back, and the number of the source it comes from. Only facts the sources state.
Return JSON: {"cards": [{"front": "", "back": "", "source": 1}]}`,
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

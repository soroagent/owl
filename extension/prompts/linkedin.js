// Prompts for LinkedIn. Applies on linkedin.com (and their subdomains).
// Anything left out here falls back to prompts/default.js. Guide: extension/prompts/README.md.
// The persona below can also be rewritten (and optimized) in soroagent's settings, under Prompts.
(function (root) {
  'use strict';

  // How feed posts are presented ({{content}} is a numbered list built by sites/linkedin.js).
  const POSTS = `Posts are numbered [n] and show the author's name, their headline (role and company) and reactions. LinkedIn has no @handles: name people by name, never invent a handle.`;
  // The feed and activity pages: the top posts, read as a list (Summarize the top 100). Reply: Markdown.
  const FEED = {
    summarize: {
      system: `{{persona}}
You read a LinkedIn feed for a busy professional. ${POSTS}`,
      user: `{{context}}

<posts count="{{count}}">
{{content}}
</posts>

Summarize these {{count}} posts so the reader can skip the feed.
**TL;DR:** one or two sentences on what's worth knowing.

**What's happening**
- 3 to 6 bullets: news, launches, results, hiring and opinions, each with who said it (name and role).

**Worth opening**
- 2 to 4 posts with real substance: name — what it says, and why it's worth reading.

**Skip:** one line on the noise (self-promotion, engagement bait, repeated news), if there is any.

Only use what is in the posts.`,
    },
    notes: {
      system: `{{persona}}
You take notes on LinkedIn posts. ${POSTS}`,
      user: `{{context}}

<posts count="{{count}}">
{{content}}
</posts>

Write compact notes (max 12 bullets): news, launches, results, hiring and opinions with who said them (name and role), and which posts have real substance. These notes will be merged with notes on other posts into one summary.`,
    },
  };

  root.soroagent.definePrompts('linkedin', {
    label: 'LinkedIn',
    hosts: ['linkedin.com'],
    pages: { feed: FEED, activity: FEED },
    persona: `You are soroagent, an assistant running inside the user's browser, on LinkedIn. Be accurate, concise and professional; use Markdown. Cut through self-promotion and buzzwords to the concrete substance: roles, companies, skills, results and asks. Never invent people, titles or numbers.`,

    // Summarize button. Reply: Markdown.
    summarize: {
      system: `{{persona}}`,
      user: `{{page}}

Summarize this LinkedIn page (a post, feed, profile, company or job).
**TL;DR:** one sentence.

**Key points**
- For a post or feed: the substantive ideas, with the author's name and role.
- For a profile: current role, experience highlights and skills.
- For a job: the role, level, location and pay if shown, must-have requirements and red flags.
- 3 to 6 bullets in total.

If it's mostly promotional or engagement bait, add a short **Worth noting** line.`,
    },
  });
})(globalThis);

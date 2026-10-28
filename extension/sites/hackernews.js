// Site profile for Hacker News. A story page is read as the story plus its comment tree, with each
// reply's depth kept, so the model can tell top-level opinions from back-and-forth; the front page
// and lists are read as ranked stories. Its prompts (discussion consensus) are in prompts/hackernews.js.
(function (root) {
  'use strict';

  const soroagent = root.soroagent;
  const MAX_COMMENTS = 120;

  // ---------------------------------------------------------------------------
  // Pure helpers (unit tested)
  // ---------------------------------------------------------------------------

  function pageInfo(location) {
    if (location.pathname === '/item') {
      return {
        type: 'thread',
        label: 'Hacker News · Discussion consensus',
        context: 'This is a Hacker News story followed by its comments. "↳" and indentation mark replies; top-level comments are separate viewpoints.',
      };
    }
    return { type: 'list', label: 'Hacker News · Front page', context: 'These are stories from a Hacker News list, in ranked order, with points and comment counts.' };
  }

  /** Pure: story + comments → text. comments: [{ author, depth, text }] (depth 0 = top level). */
  function formatThread({ title, url, points, author, text, comments }) {
    const head = [`STORY: ${title}`, [url && `Link: ${url}`, points && `${points} points`, author && `by ${author}`, `${comments.length} comments`].filter(Boolean).join(' · '), text].filter(Boolean).join('\n');
    const shown = comments.slice(0, MAX_COMMENTS);
    const topLevel = comments.filter((c) => c.depth === 0).length;
    const lines = shown.map((c) => `${'  '.repeat(Math.min(c.depth, 6))}${c.depth ? '↳ ' : '• '}${c.author || 'someone'}: ${c.text}`);
    return [head, `Comments (${topLevel} top-level${comments.length > shown.length ? `, first ${shown.length} shown` : ''}):`, ...lines].join('\n');
  }

  /** Pure: list stories → text. stories: [{ rank, title, site, points, comments }] */
  function formatList(stories) {
    return stories.map((s) => `${s.rank}. ${s.title}${s.site ? ` (${s.site})` : ''} · ${s.points} points · ${s.comments} comments`).join('\n');
  }

  // ---------------------------------------------------------------------------
  // Reading the page
  // ---------------------------------------------------------------------------

  const text = (el) => ((el && el.textContent) || '').trim();

  function extract(doc, location) {
    if (pageInfo(location).type === 'thread') {
      const story = doc.querySelector('.fatitem');
      if (!story) return null;
      const link = story.querySelector('.titleline > a');
      const comments = [...doc.querySelectorAll('tr.athing.comtr')].map((row) => {
        const ind = row.querySelector('td.ind');
        const depth = ind ? Number(ind.getAttribute('indent')) || Math.round((Number((ind.querySelector('img') || {}).width) || 0) / 40) : 0;
        const body = row.querySelector('.commtext');
        return { author: text(row.querySelector('.hnuser')), depth, text: soroagent.readableText(body, 900).replace(/\n+/g, ' ') };
      }).filter((c) => c.text);
      const title = text(link) || doc.title;
      return {
        title,
        text: formatThread({
          title,
          url: link && !/^item\?/.test(link.getAttribute('href') || '') ? link.href : '',
          points: soroagent.numberIn(text(story.querySelector('.score'))),
          author: text(story.querySelector('.hnuser')),
          text: soroagent.readableText(story.querySelector('.toptext'), 2000),
          comments,
        }),
      };
    }
    const stories = [...doc.querySelectorAll('tr.athing.submission, tr.athing')].map((row) => {
      const meta = row.nextElementSibling;
      const commentsLink = meta ? [...meta.querySelectorAll('a')].find((a) => /comment|discuss/.test(a.textContent)) : null;
      return {
        rank: soroagent.numberIn(text(row.querySelector('.rank'))),
        title: text(row.querySelector('.titleline > a')),
        site: text(row.querySelector('.sitestr')),
        points: soroagent.numberIn(text(meta && meta.querySelector('.score'))),
        comments: commentsLink && /\d/.test(commentsLink.textContent) ? soroagent.numberIn(commentsLink.textContent) : 0,
      };
    }).filter((s) => s.title);
    return stories.length ? { title: doc.title, text: formatList(stories) } : null;
  }

  // Lists as items (stories), so Summarize reads them as a ranked list and the panel can summarize or
  // save the top 100: the front page has 30 per page, so the next pages are fetched (?p=2, 3, 4).
  function storiesIn(doc, { list = false } = {}) {
    if (!list && pageInfo(location).type === 'thread') return [];
    return [...doc.querySelectorAll('tr.athing.submission, tr.athing:not(.comtr)')].map((row) => {
      const meta = row.nextElementSibling;
      const link = row.querySelector('.titleline > a');
      const commentsLink = meta ? [...meta.querySelectorAll('a')].find((a) => /comment|discuss/.test(a.textContent)) : null;
      const href = link ? link.getAttribute('href') || '' : '';
      return {
        id: row.getAttribute('id') || '',
        rank: soroagent.numberIn(text(row.querySelector('.rank'))),
        title: text(link),
        url: href ? new URL(href, location.origin).href : '',
        site: text(row.querySelector('.sitestr')),
        points: soroagent.numberIn(text(meta && meta.querySelector('.score'))),
        comments: commentsLink && /\d/.test(commentsLink.textContent) ? soroagent.numberIn(commentsLink.textContent) : 0,
        discussion: row.getAttribute('id') ? `${location.origin}/item?id=${row.getAttribute('id')}` : '',
        el: row,
      };
    }).filter((s) => s.id && s.title);
  }

  /** Pure: numbered stories for prompts: "[n] Title (site) · 120 points · 45 comments". */
  function formatStories(stories, { start = 1 } = {}) {
    return stories.map((s, i) => `[${start + i}] ${s.title}${s.site ? ` (${s.site})` : ''} · ${s.points || 0} points · ${s.comments || 0} comments`).join('\n');
  }

  /** The top `limit` stories of this list: this page, then the next pages fetched in turn. */
  async function topStories({ limit, signal, onProgress }) {
    const found = new Map(storiesIn(document).map((s) => [s.id, { ...s, el: null }]));
    const path = location.pathname === '/' ? '/news' : location.pathname;
    for (let page = 2; found.size < limit && page <= 6 && !(signal && signal.aborted); page++) {
      if (onProgress) onProgress(found.size);
      const res = await fetch(`${location.origin}${path}?p=${page}`, { credentials: 'include', signal });
      if (!res.ok) break;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const more = storiesIn(doc, { list: true });
      if (!more.length) break;
      for (const s of more) if (!found.has(s.id)) found.set(s.id, { ...s, el: null });
    }
    return [...found.values()].slice(0, limit);
  }

  soroagent.registerSite({
    id: 'hackernews',
    name: 'Hacker News',
    matches: (location) => location.hostname === 'news.ycombinator.com',
    pageInfo,
    extract,
    items: {
      on: (info) => info.type === 'list',
      noun: 'stories',
      batchSize: 30,
      isFeed: (info) => info.type === 'list',
      visible: storiesIn,
      collect: async ({ target, skip = new Set(), signal }) => ({ items: (await topStories({ limit: target + skip.size, signal })).filter((s) => !skip.has(s.id)).slice(0, target), exhausted: true }),
      top: topStories,
      format: formatStories,
      element: (s) => (s.el && s.el.isConnected ? s.el : null),
      describe: (s) => `${s.title}${s.site ? ` (${s.site})` : ''}\n${s.url}`,
    },
  });
  soroagent.siteHelpers = { ...(soroagent.siteHelpers || {}), hackernews: { pageInfo, formatThread, formatList, formatStories } };
})(globalThis);

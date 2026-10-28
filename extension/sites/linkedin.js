// Site profile for LinkedIn: on the feed (and someone's activity page) it reads posts instead of
// page text, so Summarize covers the posts and the panel can summarize or save the top 100. Other
// LinkedIn pages (profiles, jobs) are read as pages. Its prompts are in prompts/linkedin.js.
// LinkedIn needs a login, so the selectors are checked by hand; several are tried as LinkedIn changes.
(function (root) {
  'use strict';

  const soroagent = root.soroagent;

  const POST = '[data-urn^="urn:li:activity:"], [data-id^="urn:li:activity:"], .feed-shared-update-v2';
  const FEED_TYPES = new Set(['feed', 'activity']);

  // ---------------------------------------------------------------------------
  // Pure helpers (unit tested)
  // ---------------------------------------------------------------------------

  /** What kind of LinkedIn page this is, with a label for the panel and context for the prompts. */
  function pageInfo(location) {
    const path = location.pathname || '/';
    if (/^\/feed\/?$/.test(path)) return { type: 'feed', label: 'Feed', context: "These are posts from the user's LinkedIn feed." };
    if (/^\/in\/[^/]+\/recent-activity/.test(path)) return { type: 'activity', label: 'Activity', context: "These are posts from a person's LinkedIn activity." };
    if (/^\/(posts\/|feed\/update\/)/.test(path)) return { type: 'post', label: 'Post', context: 'This is a LinkedIn post.' };
    return { type: 'page', label: '', context: '' };
  }

  /** Numbered post list for prompts: "[n] Name (headline) · 120 reactions\ntext". */
  function formatPosts(posts, { start = 1, maxChars = 700 } = {}) {
    return posts
      .map((p, i) => {
        const who = `${p.name || 'Someone'}${p.headline ? ` (${p.headline})` : ''}`;
        const meta = [p.reactions ? `${p.reactions} reactions` : '', p.comments ? `${p.comments} comments` : ''].filter(Boolean);
        return `[${start + i}] ${who}${meta.length ? ` · ${meta.join(' · ')}` : ''}\n${String(p.text || '').slice(0, maxChars)}`;
      })
      .join('\n\n');
  }

  const toNumber = (text) => {
    const m = String(text || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([KkMm])?/);
    return m ? Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()] || 1)) : 0;
  };

  // ---------------------------------------------------------------------------
  // DOM access
  // ---------------------------------------------------------------------------

  const firstLine = (node, selectors) => {
    for (const sel of selectors) {
      const el = node.querySelector(sel);
      const text = el && (el.innerText || el.textContent || '').trim();
      if (text) return text.split('\n')[0].trim();
    }
    return '';
  };

  function parsePost(node) {
    const urn = node.getAttribute('data-urn') || node.getAttribute('data-id') || '';
    const textEl = node.querySelector('.update-components-text, .feed-shared-update-v2__description, .feed-shared-text');
    const text = textEl ? (textEl.innerText || textEl.textContent || '').replace(/…\s*(more|see more)\s*$/i, '').trim() : '';
    const headline = firstLine(node, ['.update-components-actor__description span[aria-hidden="true"]', '.update-components-actor__description']);
    return {
      id: urn || text.slice(0, 60),
      url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : '',
      name: firstLine(node, ['.update-components-actor__title span[aria-hidden="true"]', '.update-components-actor__name', '.update-components-actor__title']),
      headline,
      text,
      promoted: /^Promoted\b/i.test(headline) || /^Promoted$/im.test(firstLine(node, ['.update-components-actor__sub-description'])),
      reactions: toNumber(firstLine(node, ['.social-details-social-counts__reactions-count', '.social-details-social-counts__reactions'])),
      comments: toNumber(firstLine(node, ['.social-details-social-counts__comments'])),
      el: node,
    };
  }

  /** Posts currently in the page (feed, activity and post pages only; ads left out). */
  function visiblePosts(doc) {
    if (pageInfo(doc.location || location).type === 'page') return [];
    const seen = new Set();
    const posts = [];
    for (const node of doc.querySelectorAll(POST)) {
      if (node.parentElement && node.parentElement.closest(POST)) continue; // a reshared post inside another
      const post = parsePost(node);
      if (!post.text || post.promoted || seen.has(post.id)) continue;
      seen.add(post.id);
      posts.push(post);
    }
    return posts;
  }

  /** The post to save when nothing is selected: the one nearest the middle of the screen. */
  function focusedPost(doc) {
    const posts = visiblePosts(doc);
    const middle = window.innerHeight / 2;
    let best = posts[0] || null;
    let bestDistance = Infinity;
    for (const post of posts) {
      const rect = post.el.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - middle);
      if (distance < bestDistance) {
        best = post;
        bestDistance = distance;
      }
    }
    return best;
  }

  soroagent.registerSite({
    id: 'linkedin',
    name: 'LinkedIn',
    matches: (location) => /(^|\.)linkedin\.com$/i.test(location.hostname),
    pageInfo,
    items: {
      on: (info) => info.type !== 'page',
      noun: 'posts',
      batchSize: 50,
      isFeed: (info) => FEED_TYPES.has(info.type),
      visible: visiblePosts,
      collect: (args) => soroagent.collectByScrolling({ ...args, visible: visiblePosts }),
      format: formatPosts,
      focused: focusedPost,
      element: (post) => (post.el && post.el.isConnected ? post.el : null),
      describe: (post) => `${post.name}${post.headline ? ` (${post.headline})` : ''}: ${post.text}${post.url ? `\n${post.url}` : ''}`,
    },
  });

  soroagent.siteHelpers = { ...(soroagent.siteHelpers || {}), linkedin: { pageInfo, formatPosts, toNumber } };
})(globalThis);

// Site profile for X (formerly Twitter): reads posts instead of page text, reads more of a feed on
// request, and adds a "Verified only" filter. Promoted posts are left out of summaries. Its prompts are in prompts/x.js.
// A worked example for extension/sites/README.md.
(function (root) {
  'use strict';

  const soroagent = root.soroagent;

  const TWEET = 'article[data-testid="tweet"]';
  // First path segments that are app pages, not usernames.
  const RESERVED = new Set([
    'home', 'explore', 'search', 'notifications', 'messages', 'settings', 'i', 'compose', 'login', 'signup',
    'logout', 'tos', 'privacy', 'jobs', 'communities', 'premium_sign_up', 'account', 'hashtag', 'lists',
  ]);
  const FEED_TYPES = new Set(['search', 'timeline', 'profile', 'bookmarks', 'list']);

  // ---------------------------------------------------------------------------
  // Pure helpers (unit tested)
  // ---------------------------------------------------------------------------

  /** What kind of X page this is, with a label for the panel and context for the prompts. */
  function pageInfo(location) {
    const path = location.pathname || '/';
    const params = new URLSearchParams(location.search || '');
    if (path.startsWith('/search')) {
      const query = params.get('q') || '';
      const tab = params.get('f') === 'live' ? 'Latest' : params.get('f') === 'user' ? 'People' : 'Top';
      return {
        type: 'search',
        query,
        label: `Search · ${query || 'results'}`,
        context: `These are ${tab.toLowerCase()} posts from X search results for the query "${query}".`,
      };
    }
    const status = path.match(/^\/([^/]+)\/status\/(\d+)/);
    if (status) {
      return {
        type: 'thread',
        label: `Post by @${status[1]}`,
        context: `This is a post by @${status[1]} on X (item [1]) followed by replies in the conversation.`,
      };
    }
    if (path === '/' || path === '/home') {
      return { type: 'timeline', label: 'Home timeline', context: "These are posts from the user's X home timeline." };
    }
    if (path.startsWith('/i/bookmarks')) return { type: 'bookmarks', label: 'Bookmarks', context: "These are posts the user bookmarked on X." };
    if (/^\/i\/lists\/\d+/.test(path)) return { type: 'list', label: 'List', context: 'These are posts from an X list.' };
    const profile = path.match(/^\/([A-Za-z0-9_]{1,15})(?:\/(with_replies|media|highlights|articles))?\/?$/);
    if (profile && !RESERVED.has(profile[1].toLowerCase())) {
      return { type: 'profile', label: `@${profile[1]}`, context: `These are posts from the X profile @${profile[1]}.` };
    }
    return { type: 'other', label: 'X', context: 'These are posts from X.' };
  }

  /** Parses counts from X's aria-labels ("1,234 Likes. Like") or compact text ("1.2K"). */
  function parseCount(label) {
    const match = String(label || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([KkMmBb])?/);
    if (!match) return 0;
    const scale = { k: 1e3, m: 1e6, b: 1e9 }[(match[2] || '').toLowerCase()] || 1;
    return Math.round(Number(match[1]) * scale);
  }

  function compact(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`;
    return String(n);
  }

  /** Numbered post list for prompts: "[n] @handle (Name, verified) · date · engagement\ntext". */
  function formatPosts(posts, { start = 1, maxChars = 600 } = {}) {
    return posts
      .map((p, i) => {
        const about = [p.name, p.verified ? 'verified' : ''].filter(Boolean).join(', ');
        const who = `${p.handle || '@unknown'}${about ? ` (${about})` : ''}`;
        const meta = [
          p.time ? p.time.slice(0, 10) : '',
          p.likes ? `${compact(p.likes)} likes` : '',
          p.reposts ? `${compact(p.reposts)} reposts` : '',
          p.replies ? `${compact(p.replies)} replies` : '',
          p.promoted ? 'AD' : '',
        ].filter(Boolean);
        const text = (p.text || (p.hasMedia ? '[media only]' : '')).slice(0, maxChars);
        return `[${start + i}] ${who}${meta.length ? ` · ${meta.join(' · ')}` : ''}\n${text}`;
      })
      .join('\n\n');
  }

  // ---------------------------------------------------------------------------
  // DOM access
  // ---------------------------------------------------------------------------

  function parsePost(article) {
    const userBlock = article.querySelector('[data-testid="User-Name"]');
    const parts = userBlock ? userBlock.innerText.split('\n').map((s) => s.trim()).filter(Boolean) : [];
    const handle = parts.find((s) => /^@\w+$/.test(s)) || '';
    const name = parts[0] && parts[0] !== handle ? parts[0] : '';
    const time = article.querySelector('time');
    const link = time && time.closest('a[href*="/status/"]');
    const url = link ? new URL(link.getAttribute('href'), document.location.origin).href : '';
    const id = (url.match(/\/status\/(\d+)/) || [])[1] || `${handle}:${(article.innerText || '').slice(0, 60)}`;
    const metric = (...ids) => {
      for (const testId of ids) {
        const el = article.querySelector(`[data-testid="${testId}"]`);
        if (el) return parseCount(el.getAttribute('aria-label') || el.innerText);
      }
      return 0;
    };
    const textEl = article.querySelector('[data-testid="tweetText"]');
    return {
      id,
      url,
      name,
      handle,
      verified: Boolean(userBlock && userBlock.querySelector('[data-testid="icon-verified"], svg[aria-label*="erified"]')),
      promoted:
        Boolean(article.querySelector('[data-testid="placementTracking"]')) ||
        [...article.querySelectorAll('span')]
          .slice(0, 60)
          .some((s) => /^(Ad|Promoted)$/.test(s.textContent.trim()) && !s.closest('[data-testid="tweetText"]')),
      time: time ? time.getAttribute('datetime') || '' : '',
      text: textEl ? textEl.innerText.trim() : '',
      hasMedia: Boolean(article.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="card.wrapper"]')),
      replies: metric('reply'),
      reposts: metric('retweet', 'unretweet'),
      likes: metric('like', 'unlike'),
      el: article,
    };
  }

  function passes(post, options) {
    if (options.verifiedOnly && !post.verified) return false;
    if (post.promoted) return false; // ads never go into a summary
    return Boolean(post.text || post.hasMedia);
  }

  /** Posts currently in the page (X only keeps the ones near the viewport in the DOM). */
  function visiblePosts(doc, options = {}) {
    const seen = new Set();
    const posts = [];
    for (const article of doc.querySelectorAll(TWEET)) {
      if (article.parentElement && article.parentElement.closest(TWEET)) continue; // quoted post inside another
      const post = parsePost(article);
      if (seen.has(post.id) || !passes(post, options)) continue;
      seen.add(post.id);
      posts.push(post);
    }
    return posts;
  }

  // ---------------------------------------------------------------------------
  // X Articles (long-form): a /status/ page whose post is an article. The post's own text is only a
  // link, so reading it as a thread finds nothing; it's read as an article instead. X renders it as
  // plain headings and paragraphs when logged out, and inside the post with its rich-text editor
  // markup when logged in, so it's found by structure, not one selector.
  // ---------------------------------------------------------------------------

  const LONGFORM = '[data-testid*="article" i]:not([data-testid="tweet"]), [class*="longform" i], .DraftEditor-root, main article:not([data-testid="tweet"])';

  /** Pure: whether a candidate's text looks like an article rather than a post or a reply list. */
  function looksLikeArticle({ textLength, blocks, postTextLength = 0 }) {
    return textLength >= 1200 && (blocks >= 4 || textLength >= 2500) && postTextLength < textLength / 3;
  }

  /** The element holding an X Article on this page, or null. */
  function longformRoot(doc, location) {
    if (pageInfo(location).type !== 'thread') return null;
    const firstPostText = ((doc.querySelector('article[data-testid="tweet"] [data-testid="tweetText"]') || {}).innerText || '').length;
    const pick = (candidates, postTextLength = 0) => {
      let best = null;
      let bestLength = 0;
      for (const el of candidates) {
        const textLength = (el.innerText || '').length;
        const blocks = el.querySelectorAll('h1, h2, h3, p, li, [data-block="true"]').length;
        if (textLength > bestLength && looksLikeArticle({ textLength, blocks, postTextLength })) {
          best = el;
          bestLength = textLength;
        }
      }
      return best;
    };
    // The article's own container first; the whole main post (with its header) only as a last resort.
    const mainPost = doc.querySelector('article[data-testid="tweet"]');
    return pick(doc.querySelectorAll(LONGFORM)) || (mainPost ? pick([mainPost], firstPostText) : null);
  }

  let longformCache = { url: '', at: 0, root: null };
  /** Cheap enough to ask often: the answer is kept for a moment per address. */
  function isLongform(doc, location) {
    if (longformCache.url !== location.href || Date.now() - longformCache.at > 1500) longformCache = { url: location.href, at: Date.now(), root: longformRoot(doc, location) };
    return Boolean(longformCache.root && longformCache.root.isConnected);
  }

  /** The article as text: headings kept when the markup has them, else the rendered lines. */
  function extract(doc, location) {
    const root = longformRoot(doc, location);
    if (!root) return null;
    const handle = (location.pathname.match(/^\/([^/]+)\/status\//) || [])[1] || '';
    const titleEl = root.querySelector('h1, [data-testid*="title" i]') || doc.querySelector('main h1');
    const title = titleEl ? titleEl.innerText.trim() : doc.title.replace(/ \/ X$/, '');
    const rendered = (root.innerText || '').replace(/\n{2,}/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).join('\n\n');
    // Real headings and paragraphs (logged out) keep their structure; rich-text blocks (logged in)
    // have none, so their rendered lines are the paragraphs.
    const hasBlocks = root.querySelectorAll('h1, h2, h3, p, li').length >= 4;
    const structured = hasBlocks && soroagent.htmlToText ? soroagent.htmlToText(root.innerHTML) : '';
    const body = structured.length >= rendered.length * 0.7 ? structured : rendered;
    return { title, text: `X ARTICLE${handle ? ` by @${handle}` : ''}${title ? `: ${title}` : ''}\n\n${body}` };
  }

  /** Gathers more posts by scrolling (bounded; see collectByScrolling in registry.js). */
  const collect = (args) => soroagent.collectByScrolling({ ...args, visible: visiblePosts });

  /** The post to save when nothing is selected: the main post of a thread, else the one in view. */
  function focusedPost(doc, location) {
    const posts = visiblePosts(doc, {});
    if (!posts.length) return null;
    if (pageInfo(location).type === 'thread') return posts[0];
    const middle = window.innerHeight / 2;
    let best = posts[0];
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

  // Keeps "Verified only" applied as X loads more posts.
  let filterOptions = {};
  let observer = null;
  let pending = 0;

  function runFilter() {
    pending = 0;
    for (const article of document.querySelectorAll(TWEET)) {
      const post = parsePost(article);
      const hide = filterOptions.verifiedOnly && !post.verified;
      if (hide) article.setAttribute('data-soroagent-filtered', '');
      else article.removeAttribute('data-soroagent-filtered');
    }
  }

  function applyOptions(options) {
    filterOptions = { ...options };
    runFilter();
    const active = filterOptions.verifiedOnly;
    if (active && !observer) {
      observer = new MutationObserver(() => {
        if (!pending) pending = setTimeout(runFilter, 250);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } else if (!active && observer) {
      observer.disconnect();
      observer = null;
    }
  }

  soroagent.registerSite({
    id: 'x',
    name: 'X',
    matches: (location) => /(^|\.)(x|twitter)\.com$/i.test(location.hostname),
    extract,
    extractTypes: ['article'], // extract() reads X Articles only; posts are read through items
    longform: isLongform,
    options: [
      { id: 'verifiedOnly', label: 'Verified only', title: 'Show and analyze only posts from verified accounts', default: false },
    ],
    pageInfo,
    applyOptions,
    items: {
      noun: 'posts',
      // Feeds: Summarize reads what's loaded, then offers "Read more" in batches of this size.
      batchSize: 50,
      isFeed: (info) => FEED_TYPES.has(info.type),
      visible: visiblePosts,
      collect,
      format: formatPosts,
      focused: focusedPost,
      element: (post) => (post.el && post.el.isConnected ? post.el : null),
      describe: (post) => `${post.handle}${post.name ? ` (${post.name})` : ''}: ${post.text}${post.url ? `\n${post.url}` : ''}`,
    },
  });

  soroagent.siteHelpers = { ...(soroagent.siteHelpers || {}), x: { pageInfo, parseCount, compact, formatPosts, looksLikeArticle } };
})(globalThis);

// Feed pages (X timelines, bookmarks and likes; the LinkedIn feed): instead of the usual suggested
// questions, the panel offers two things: summarize the top 100 posts, and save the posts to the
// PKG. assistant.js scrolls the page and collects them; the pure parts are here: which page offers
// what, the key that marks a post as saved, what a post becomes as a snippet, and reading the AI's
// topic tags for a batch.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});
  const TOP = 100; // posts read for "Summarize the top 100", and saved on endless feeds

  /** Pure: whether this is the user's X bookmarks page (x.com/i/bookmarks, folders, or /i/history). */
  function isBookmarksPage(location) {
    const host = String(location.hostname || '').toLowerCase().replace(/^www\.|^mobile\./, '');
    return /^(x|twitter)\.com$/.test(host) && /^\/i\/(bookmarks|history)(\/|$)/.test(location.pathname || '');
  }

  // What each feed offers. `all`: the save button scrolls to the end (bookmarks and likes end);
  // otherwise it saves the top posts (a home timeline never ends).
  const FEEDS = {
    x: {
      timeline: { title: 'Your X timeline' },
      search: { title: 'X search results' },
      list: { title: 'This X list' },
      profile: { title: 'These posts' },
      bookmarks: { title: 'Your X bookmarks', all: 'bookmarks' },
      likes: { title: 'Your X likes', all: 'likes' },
    },
    linkedin: {
      feed: { title: 'Your LinkedIn feed' },
      activity: { title: 'These LinkedIn posts' },
    },
  };

  /**
   * Pure: the feed actions for a site and page type, or null on other pages:
   * { title, summarize: label, save: label, limit (posts to save), all (scroll to the end) }.
   */
  function feedActions(siteId, pageType) {
    const feed = (FEEDS[siteId] || {})[pageType];
    if (!feed) return null;
    return {
      title: feed.title,
      summarize: `Summarize the top ${TOP} posts`,
      save: feed.all ? `Save all ${feed.all} to your PKG` : `Save the top ${TOP} posts to your PKG`,
      limit: feed.all ? 5000 : TOP,
      all: Boolean(feed.all),
      noun: feed.all || 'posts',
    };
  }

  /** Pure: the keys that mark a post as saved; the first is the one a new snippet gets. */
  function postKeys(siteId, post, pageType) {
    if (siteId === 'linkedin') return [`lipost:${post.id}`];
    // X: bookmarks keep the key they had before other X feeds could be saved.
    const keys = [`xbookmark:${post.id}`, `xpost:${post.id}`];
    return pageType === 'bookmarks' ? keys : keys.reverse();
  }

  /** Pure: the post's @handle on X, from the page or else from its address (x.com/<handle>/status/…). */
  function bookmarkHandle(post) {
    if (post.handle && /^@\w+$/.test(post.handle)) return post.handle;
    const m = String(post.url || '').match(/^https?:\/\/[^/]+\/(\w{1,30})\/status\//);
    return m ? `@${m[1]}` : '@unknown';
  }

  const clip = (text, n) => (text.length > n ? `${text.slice(0, n).replace(/\s+\S*$/, '')}…` : text);

  /** Pure: the snippet for one post ({ id, url, handle, name, headline, text, time, hasMedia }). */
  function postSnippet(post, { siteId = 'x', pageType = 'bookmarks', now = new Date().toISOString(), tags = [] } = {}) {
    const text = String(post.text || '').trim() || (post.hasMedia ? '[media only]' : '');
    const oneLine = text.replace(/\s+/g, ' ');
    const linkedin = siteId === 'linkedin';
    const who = linkedin ? post.name || 'Someone' : bookmarkHandle(post);
    return {
      kind: 'page',
      source: linkedin ? 'linkedin-post' : pageType === 'bookmarks' ? 'x-bookmark' : pageType === 'likes' ? 'x-like' : 'x-post',
      title: `${who}: ${clip(oneLine, 90)}`.slice(0, 160),
      pageTitle: linkedin ? `${who}${post.headline ? ` (${post.headline})` : ''} on LinkedIn` : `${post.name ? `${post.name} (${who})` : who} on X`,
      summary: clip(oneLine, 260),
      text,
      url: post.url,
      site: linkedin ? 'LinkedIn' : 'X',
      tags,
      postedAt: post.time || '',
      createdAt: now,
      dedupeKey: postKeys(siteId, post, pageType)[0],
    };
  }

  /**
   * Pure: topic tags per item from the model's reply to the tagBatch prompt
   * ({"tags": {"1": ["ai", "agents"], …}} or a list of lists): an array of `count` tag lists
   * (lowercase, hyphenated, at most 3 each; [] where the reply has none).
   */
  function parseTagBatch(reply, count) {
    const json = soroagent.parseJsonLoose ? soroagent.parseJsonLoose(reply) : null;
    const raw = json && (json.tags || json.items || json);
    const out = [];
    for (let i = 0; i < count; i++) {
      const list = Array.isArray(raw) ? raw[i] : raw && typeof raw === 'object' ? raw[String(i + 1)] : null;
      const tags = (Array.isArray(list) ? list : [])
        .map((t) => String(t || '').toLowerCase().trim().replace(/^#/, '').replace(/[^a-z0-9+#. -]/g, '').replace(/\s+/g, '-'))
        .filter((t) => t.length >= 2 && t.length <= 30);
      out.push([...new Set(tags)].slice(0, 3));
    }
    return out;
  }

  soroagent.feeds = { TOP, BATCH: 5, FEEDS, isBookmarksPage, feedActions, postKeys, bookmarkHandle, postSnippet, parseTagBatch };
})(globalThis);

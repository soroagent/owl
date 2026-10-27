// X bookmarks into the PKG: on the bookmarks page soroagent offers to scroll to the end and save
// every bookmark as a snippet (assistant.js runs it; next time only new ones are added). The pure
// parts: which page, what a bookmark becomes, and reading the AI's topic tags for a batch.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});
  const PREFIX = 'xbookmark:';

  /** Pure: whether this is the user's X bookmarks page (x.com/i/bookmarks, folders, or /i/history). */
  function isBookmarksPage(location) {
    const host = String(location.hostname || '').toLowerCase().replace(/^www\.|^mobile\./, '');
    return /^(x|twitter)\.com$/.test(host) && /^\/i\/(bookmarks|history)(\/|$)/.test(location.pathname || '');
  }

  /** Pure: the key that marks a post as imported (snippet.dedupeKey). */
  const bookmarkKey = (post) => `${PREFIX}${post.id}`;

  /** Pure: the post's @handle, from the page or else from its address (x.com/<handle>/status/…). */
  function bookmarkHandle(post) {
    if (post.handle && /^@\w+$/.test(post.handle)) return post.handle;
    const m = String(post.url || '').match(/^https?:\/\/[^/]+\/(\w{1,30})\/status\//);
    return m ? `@${m[1]}` : '@unknown';
  }

  /** Pure: the snippet for one bookmarked post ({ id, url, handle, name, text, time, hasMedia }). */
  function bookmarkSnippet(post, { now = new Date().toISOString(), tags = [] } = {}) {
    const text = String(post.text || '').trim() || (post.hasMedia ? '[media only]' : '');
    const oneLine = text.replace(/\s+/g, ' ');
    const who = bookmarkHandle(post);
    return {
      kind: 'page',
      source: 'x-bookmark',
      title: `${who}: ${oneLine.length > 90 ? `${oneLine.slice(0, 90).replace(/\s+\S*$/, '')}…` : oneLine}`.slice(0, 160),
      pageTitle: `${post.name ? `${post.name} (${who})` : who} on X`,
      summary: oneLine.length > 260 ? `${oneLine.slice(0, 260).replace(/\s+\S*$/, '')}…` : oneLine,
      text,
      url: post.url,
      site: 'X',
      tags,
      postedAt: post.time || '',
      createdAt: now,
      dedupeKey: bookmarkKey(post),
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

  soroagent.xBookmarks = { PREFIX, BATCH: 5, isBookmarksPage, bookmarkKey, bookmarkHandle, bookmarkSnippet, parseTagBatch };
})(globalThis);

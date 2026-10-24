// "Hide non-tech": on feeds (X timelines, Reddit feeds, YouTube video lists) each post or video is
// its own element, so the posts the user's AI says aren't about tech can be folded away. This file
// finds those elements and hides or shows them; assistant.js asks the AI (the techSort prompt) and
// keeps it going as the page loads more. Hidden with an attribute and PAGE_CSS, the same way X's
// "Verified only" works, so turning it off restores the page exactly.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});
  const ATTR = 'data-soroagent-offtopic';
  const clean = (s, max = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const text = (el, sel) => clean(el && el.querySelector(sel) && el.querySelector(sel).textContent);
  const host = (location) => String(location.hostname || '').toLowerCase().replace(/^www\.|^m\.|^old\./, '');

  // Each feed: which pages, which elements are the posts, and each post's key and text.
  const FEEDS = {
    x: {
      label: 'posts',
      matches: (loc) => /^(x|twitter)\.com$/.test(host(loc)) && !/\/status\/\d+/.test(loc.pathname),
      cards: (doc) => [...doc.querySelectorAll('article[data-testid="tweet"]')],
      key: (el) => {
        const link = el.querySelector('a[href*="/status/"] time') && el.querySelector('a[href*="/status/"] time').closest('a');
        return (link && link.getAttribute('href')) || clean(el.textContent, 120);
      },
      text: (el) => {
        const handle = (clean(el.querySelector('[data-testid="User-Name"]') && el.querySelector('[data-testid="User-Name"]').innerText, 120).match(/@\w+/) || [''])[0];
        return clean(`${handle} ${text(el, '[data-testid="tweetText"]') || (el.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]') ? '[media only]' : '')}`);
      },
    },
    reddit: {
      label: 'posts',
      matches: (loc) => host(loc) === 'reddit.com' && !/\/comments\//.test(loc.pathname),
      cards: (doc) => [...doc.querySelectorAll('shreddit-post, div.thing.link')],
      key: (el) => el.getAttribute('id') || el.getAttribute('permalink') || el.getAttribute('data-fullname') || clean(el.textContent, 120),
      text: (el) => clean(`${el.getAttribute('subreddit-prefixed-name') || el.getAttribute('data-subreddit') || ''} ${el.getAttribute('post-title') || text(el, 'a.title, [slot="title"]')}`),
    },
    youtube: {
      label: 'videos',
      matches: (loc) => host(loc) === 'youtube.com' && !/^\/shorts\//.test(loc.pathname),
      cards: (doc) => [...doc.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model')],
      key: (el) => {
        const a = el.querySelector('a[href*="/watch"], a[href*="/shorts/"]');
        return (a && a.getAttribute('href').replace(/&.*$/, '')) || clean(el.textContent, 120);
      },
      text: (el) => clean(`${text(el, '#video-title, h3, .yt-lockup-metadata-view-model-wiz__title')} · ${text(el, '#channel-name a, ytd-channel-name, .yt-content-metadata-view-model-wiz__metadata-text')}`),
    },
  };

  /** Pure: the feed id for a page ('x' | 'reddit' | 'youtube'), or '' where there's no feed to filter. */
  function feedFor(location) {
    for (const [id, feed] of Object.entries(FEEDS)) if (feed.matches(location)) return id;
    return '';
  }

  /** The posts on the page now: [{ el, key, text }] (posts without text are left alone). */
  function feedCards(id, doc = document) {
    const feed = FEEDS[id];
    if (!feed) return [];
    const out = [];
    for (const el of feed.cards(doc)) {
      const t = feed.text(el);
      if (t.replace(/[@\w]+\s*/, '').length < 3) continue;
      out.push({ el, key: feed.key(el), text: t });
    }
    return out;
  }

  /** Hides (or shows) one post. */
  function setHidden(el, hidden) {
    if (hidden) el.setAttribute(ATTR, '');
    else el.removeAttribute(ATTR);
  }

  /** Shows every post this filter hid. */
  function showAll(doc = document) {
    for (const el of doc.querySelectorAll(`[${ATTR}]`)) el.removeAttribute(ATTR);
  }

  /** Pure: the item numbers (1-based, within count) the model says are on the topic. */
  function parseTopicIds(reply, count) {
    const json = soroagent.parseJsonLoose ? soroagent.parseJsonLoose(reply) : null;
    const list = Array.isArray(json) ? json : json && (json.tech || json.items || json.ids);
    if (!Array.isArray(list)) return null; // unreadable: the caller keeps everything visible
    return new Set(list.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= count));
  }

  soroagent.feedFilter = { ATTR, FEEDS, feedFor, feedCards, setHidden, showAll, parseTopicIds };
})(globalThis);

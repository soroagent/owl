// Browsing helpers for the page actions on news sites, Hacker News, Reddit and YouTube (see
// "Page actions" in content/assistant.js): which page is a news front page or article, which links
// are headlines, what's new since the last visit, references made into links, and the names of the
// page parts "Hide clutter" folds away. All pure, all unit tested.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  const hostOf = (location) => String(location.hostname || '').toLowerCase().replace(/^(www|m|edition|amp)\./, '');
  const on = (host, domain) => host === domain || host.endsWith(`.${domain}`);
  const isNewsHost = (location) => (soroagent.NEWS_HOSTS || []).some((d) => on(hostOf(location), d));

  /** Pure: a news site's home or section page (bbc.com/, theguardian.com/world, ndtv.com/india). */
  function isNewsFront(location) {
    if (!isNewsHost(location)) return false;
    const parts = String(location.pathname || '/').split('/').filter(Boolean);
    if (!parts.length) return true;
    return parts.length <= 2 && parts.every((p) => /^[a-z][a-z-]{1,24}$/i.test(p)) && !/\.(html?|cms|php)$/i.test(parts[parts.length - 1]);
  }

  /** Pure: a news article (a news site's page that isn't a front page, or a page that calls itself news). */
  function isNewsArticle(location, kind = '') {
    if (isNewsFront(location)) return false;
    return kind === 'news' || (isNewsHost(location) && String(location.pathname || '/').length > 12);
  }

  /** Pure: whether a link looks like a headline: a sentence-like text, to a story on the same site. */
  function isHeadline(text, href, pageHost) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length < 25 || t.length > 220 || t.split(' ').length < 4) return false;
    let url;
    try {
      url = new URL(href);
    } catch {
      return false;
    }
    if (!/^https?:$/.test(url.protocol)) return false;
    const host = url.hostname.replace(/^(www|m|edition|amp)\./, '');
    const page = String(pageHost || '').replace(/^(www|m|edition|amp)\./, '');
    if (host !== page && !host.endsWith(`.${page}`) && !page.endsWith(`.${host}`)) return false;
    const path = url.pathname;
    return path.length > 12 && !/^\/(login|signin|subscribe|account|newsletters?|podcasts?|video|live-tv|games|crossword|weather)\b/i.test(path);
  }

  /** Pure: the key that identifies a headline across visits (its address without query or hash). */
  const headlineKey = (href) => String(href || '').replace(/[?#].*$/, '').replace(/\/$/, '');

  /**
   * Pure: what's new on a page since the last visit. seen: the keys stored last time (or null for a
   * first visit). Returns { fresh: keys not seen before (in page order), keep: the keys to store,
   * newest first, at most `cap` }.
   */
  function diffSeen(keys, seen, cap = 600) {
    const before = new Set(seen || []);
    const fresh = seen ? keys.filter((k, i) => !before.has(k) && keys.indexOf(k) === i) : [];
    const keep = [...new Set([...keys, ...(seen || [])])].slice(0, cap);
    return { fresh, keep };
  }

  /**
   * Pure: references in a reply made into links: [n] → urls[n-1] (only web links), and on a video
   * [m:ss] / [h:mm:ss] → that moment (videoUrl gets &t=…s). Existing links are left alone.
   */
  function linkRefs(text, { urls = [], videoUrl = '' } = {}) {
    const link = (n) => {
      const url = urls[Number(n) - 1];
      return url && /^https?:\/\//i.test(url) ? `[${n}](${url})` : '';
    };
    let out = String(text || '').replace(/\[(\d{1,3})\](?!\()/g, (m, n) => link(n) || m);
    // "(4, 15)": a list of item numbers in parentheses, when every one of them is an item.
    if (urls.length) {
      out = out.replace(/\((\d{1,3}(?:\s*,\s*\d{1,3})*)\)/g, (m, list) => {
        const links = list.split(',').map((n) => link(n.trim()));
        return links.every(Boolean) ? links.join(' ') : m;
      });
    }
    if (videoUrl) {
      out = out.replace(/\[((?:\d{1,2}:)?\d{1,2}:\d{2})\](?!\()/g, (m, t) => {
        try {
          const u = new URL(videoUrl);
          u.searchParams.set('t', `${t.split(':').map(Number).reduce((a, b) => a * 60 + b, 0)}s`);
          return `[${t}](${u.href})`;
        } catch {
          return m;
        }
      });
    }
    return out;
  }

  // Page parts that aren't the story: related and recommended links, newsletter and subscribe boxes,
  // comments, "most read" lists, sponsored blocks.
  const CLUTTER = /(^|[\s_-])(related|recommend(ed|ation)?s?|more-?(stories|news|from)|read-?(more|next)|also-?read|newsletter|subscribe|subscription|signup|sign-up|comments?|disqus|outbrain|taboola|trending|most-?(popular|read|viewed)|promo|sponsored|partner|paid-?content|social-?share|share-?bar|you-?may-?like)([\s_-]|$)/i;

  /** Pure: whether an element's class, id, role or label names a part of the page that's clutter. */
  function isClutterName(name) {
    return CLUTTER.test(String(name || '').replace(/([a-z])([A-Z])/g, '$1-$2'));
  }

  soroagent.browse = { isNewsFront, isNewsArticle, isHeadline, headlineKey, diffSeen, linkRefs, isClutterName };
})(globalThis);

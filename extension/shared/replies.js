// Reply ideas on X and LinkedIn: the owl suggests replies to a post, written for the person who
// posted it (their role, what they asked, how they write). On a post's own page it's that post; on
// a feed, the post in the middle of the screen. Nothing is ever posted: the user copies a reply or
// puts it in the reply box and posts it themselves. The pure parts are unit tested; reading
// LinkedIn's markup (linkedinPosts) is not, as LinkedIn needs a login.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  const host = (location) => String(location.hostname || '').toLowerCase().replace(/^(www|mobile|m)\./, '');

  /** Pure: 'x', 'linkedin' or '' for this address. */
  function platformOf(location) {
    const h = host(location);
    if (/^(x|twitter)\.com$/.test(h)) return 'x';
    if (h === 'linkedin.com' || h.endsWith('.linkedin.com')) return 'linkedin';
    return '';
  }

  /** Pure: whether this address is one post's own page (an X post, a LinkedIn post or activity). */
  function isPostPage(location) {
    const path = location.pathname || '';
    const platform = platformOf(location);
    if (platform === 'x') return /^\/[^/]+\/status\/\d+/.test(path);
    if (platform === 'linkedin') return /^\/(posts\/[^/]+|feed\/update\/urn:li:(activity|share|ugcPost):[^/]+)/.test(path);
    return false;
  }

  /** Pure: the X post id in the address (x.com/<handle>/status/<id>), or ''. */
  const statusId = (location) => ((location.pathname || '').match(/^\/[^/]+\/status\/(\d+)/) || [])[1] || '';

  /** Pure: what each platform's replies look like, for the prompt. */
  const PLATFORM = {
    x: { label: 'X', rule: 'X replies: under 280 characters each, plain text, no hashtags.', limit: 280 },
    linkedin: { label: 'LinkedIn', rule: 'LinkedIn comments: 1 to 4 sentences each, professional but human, no hashtags.', limit: 1250 },
  };

  /**
   * Pure: the index of the box nearest the middle of the screen ({ top, bottom } in viewport
   * pixels), preferring one that covers the middle; -1 when none is on screen.
   */
  function pickCentral(boxes, viewportHeight) {
    const mid = viewportHeight / 2;
    let best = -1;
    let bestDistance = Infinity;
    boxes.forEach((b, i) => {
      if (!b || b.bottom <= 0 || b.top >= viewportHeight) return;
      const distance = b.top <= mid && b.bottom >= mid ? 0 : Math.min(Math.abs(b.top - mid), Math.abs(b.bottom - mid));
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
  }

  /** Pure: a short name for the author, for the panel ("@handle" on X, the name on LinkedIn). */
  const whoOf = (post) => post.handle || post.name || 'the author';

  /**
   * Pure: the post as the prompt sees it: who posted it (name, handle, headline), the post, and on
   * X the author's own follow-ups in the thread and replies already there (so ideas don't repeat).
   */
  function formatTarget(post, { thread = [], replies = [], maxChars = 2500 } = {}) {
    const about = [post.name, post.handle, post.verified ? 'verified' : ''].filter(Boolean).join(' · ');
    const lines = [`Author: ${about || 'unknown'}`];
    if (post.headline) lines.push(`Author's headline: ${post.headline}`);
    if (post.time) lines.push(`Posted: ${String(post.time).slice(0, 10)}`);
    const text = String(post.text || '').trim() || (post.hasMedia ? '[an image or video with no text]' : '');
    lines.push('', 'Post:', text.slice(0, maxChars));
    const own = thread.filter((p) => p.text).slice(0, 3);
    if (own.length) lines.push('', 'The author continued the thread:', ...own.map((p) => `- ${p.text.replace(/\s+/g, ' ').slice(0, 400)}`));
    const others = replies.filter((p) => p.text).slice(0, 5);
    if (others.length) lines.push('', 'Replies already posted (do not repeat these):', ...others.map((p) => `- ${p.handle || p.name || 'someone'}: ${p.text.replace(/\s+/g, ' ').slice(0, 200)}`));
    return lines.join('\n');
  }

  /**
   * Pure: reply ideas from the model's reply to the reply prompt ({"replies": [{"tone", "text"}]},
   * a plain list, or numbered lines): at most 3, quotes and leftover labels stripped.
   */
  function parseReplies(reply) {
    const json = soroagent.parseJsonLoose ? soroagent.parseJsonLoose(reply) : null;
    let list = json && (Array.isArray(json) ? json : json.replies || json.suggestions);
    if (!Array.isArray(list)) {
      list = soroagent.stripThinking ? soroagent.stripThinking(String(reply || '')) : String(reply || '');
      list = list.split('\n').map((l) => l.match(/^\s*(?:\d+[.)]|[-*•])\s+(.+)/)).filter(Boolean).map((m) => m[1]);
    }
    const out = [];
    for (const item of list) {
      const raw = typeof item === 'string' ? { text: item } : item && typeof item === 'object' ? item : null;
      if (!raw) continue;
      let text = String(raw.text || raw.reply || '').trim();
      let tone = String(raw.tone || raw.label || '').trim();
      const labelled = text.match(/^\*{0,2}(Add|Ask|Short)\*{0,2}\s*[:—–-]\s*(.+)$/is);
      if (labelled) [, tone, text] = labelled;
      text = text.replace(/^["“'](.*)["”']$/s, '$1').trim();
      if (text.length < 2 || out.some((r) => r.text === text)) continue;
      out.push({ tone: tone.slice(0, 20), text });
      if (out.length === 3) break;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // LinkedIn's markup (needs a login, so checked by hand; several selectors as LinkedIn changes)
  // ---------------------------------------------------------------------------

  const LI_POST = '[data-urn^="urn:li:activity:"], [data-id^="urn:li:activity:"], .feed-shared-update-v2, [data-test-id="main-feed-activity-card"]';
  const firstText = (root, selectors) => {
    for (const sel of selectors) {
      const node = root.querySelector(sel);
      const text = node && (node.innerText || node.textContent || '').trim();
      if (text) return text.split('\n')[0].trim();
    }
    return '';
  };

  /** The LinkedIn posts in the page: { id, url, name, headline, text, el }. */
  function linkedinPosts(doc) {
    const posts = [];
    for (const node of doc.querySelectorAll(LI_POST)) {
      if (node.parentElement && node.parentElement.closest(LI_POST)) continue; // a reshared post inside another
      const urn = node.getAttribute('data-urn') || node.getAttribute('data-id') || '';
      const textNode = node.querySelector('.update-components-text, .feed-shared-update-v2__description, .feed-shared-text, [data-test-id="main-feed-activity-card__commentary"]');
      const text = textNode ? (textNode.innerText || textNode.textContent || '').replace(/…\s*(more|see more)$/i, '').trim() : '';
      if (!text) continue;
      posts.push({
        id: urn || text.slice(0, 60),
        url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : '',
        name: firstText(node, ['.update-components-actor__title span[aria-hidden="true"]', '.update-components-actor__name', '.update-components-actor__title', '[data-test-id="main-feed-activity-card__entity-lockup"] a', '.base-main-feed-card__entity-lockup a']),
        headline: firstText(node, ['.update-components-actor__description span[aria-hidden="true"]', '.update-components-actor__description', '[data-test-id="main-feed-activity-card__entity-lockup"] p']),
        text,
        el: node,
      });
    }
    return posts;
  }

  /** A LinkedIn post page whose markup wasn't recognised: the post from the page's own description. */
  function linkedinFromMeta(doc) {
    const meta = (p) => ((doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`) || {}).content || '').trim();
    const title = meta('og:title') || doc.title;
    const text = meta('og:description') || meta('description');
    if (!text) return null;
    const name = (title.match(/^(.+?) (?:on LinkedIn|posted on the topic)/) || [])[1] || '';
    return { id: '', url: meta('og:url'), name, headline: '', text, el: null };
  }

  /** The reply box for a post, when it's open: X's composer, or the LinkedIn comment box. */
  function replyBox(doc, platform, post) {
    const visible = (n) => n && n.isConnected && n.getClientRects().length > 0;
    const sel = platform === 'x'
      ? '[data-testid^="tweetTextarea_"][contenteditable="true"], [data-testid^="tweetTextarea_"] [contenteditable="true"]'
      : '.comments-comment-box__form .ql-editor, .comments-comment-texteditor [contenteditable="true"], [contenteditable="true"][role="textbox"]';
    const scope = post && post.el ? post.el : null;
    return [...(scope ? scope.querySelectorAll(sel) : []), ...doc.querySelectorAll(sel)].find(visible) || null;
  }

  /** Puts text in the reply box (as if typed, so the site's editor notices); false when there's none. */
  function fillReplyBox(doc, platform, post, text) {
    const box = replyBox(doc, platform, post);
    if (!box) return false;
    box.focus();
    const selection = doc.getSelection();
    if (selection) {
      selection.selectAllChildren(box);
      selection.collapseToEnd();
    }
    const done = doc.execCommand && doc.execCommand('insertText', false, text);
    if (!done) box.textContent = text;
    return true;
  }

  soroagent.replies = { PLATFORM, platformOf, isPostPage, statusId, pickCentral, whoOf, formatTarget, parseReplies, linkedinPosts, linkedinFromMeta, replyBox, fillReplyBox };
})(globalThis);

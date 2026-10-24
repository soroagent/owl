// Passive capture (opt-in, off by default): pages you actually read are saved to your library on
// their own, so your history becomes a record of what you read, not just where you went.
// "Actually read" = active on the page (tab in front, recent input) for a while AND scrolled
// through at least half of it. Sensitive and low-value pages are never captured. The capture
// itself is local; optionally the AI adds a title, summary and tags (background "capture:label").
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});
  if (soroagent.capture || !root.document || !/^https?:$/.test(root.location.protocol)) return;

  // Never captured: mail, chat, banking, AI chats, search results, local pages.
  const DEFAULT_EXCLUDED = [
    'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'mail.yahoo.com', 'proton.me', 'web.whatsapp.com', 'messages.google.com',
    'web.telegram.org', 'discord.com', 'slack.com', 'teams.microsoft.com', 'calendar.google.com', 'docs.google.com', 'drive.google.com',
    'paypal.com', 'chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'copilot.microsoft.com', 'perplexity.ai',
    'localhost', '127.0.0.1',
  ];
  const SENSITIVE_PATH = /\/(login|log-in|signin|sign-in|signup|sign-up|register|checkout|cart|basket|account|accounts|settings|preferences|password|admin|oauth|auth|billing|payment|inbox|messages)(\/|$|\?)/i;
  const SENSITIVE_HOST = /(^|\.)(accounts|login|auth|signin|secure|banking|bank|mybank|onlinebanking|wallet)\./i;
  const SEARCH_PAGE = /(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|startpage)\.[a-z.]+$|(^|\.)search\.brave\.com$/i;

  // ---------------------------------------------------------------------------
  // Pure helpers (unit tested)
  // ---------------------------------------------------------------------------

  const hostMatches = (host, pattern) => {
    const p = String(pattern || '').trim().toLowerCase().replace(/^\*\./, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return Boolean(p) && (host === p || host.endsWith(`.${p}`));
  };

  /**
   * Pure: whether a page may be captured at all. page: { url, hasPassword, textLength, isFeed },
   * excluded: the reader's own list of sites. Returns { ok, reason }.
   */
  function captureAllowed({ url, hasPassword = false, textLength = 0, isFeed = false }, excluded = []) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return { ok: false, reason: 'not a web page' };
    }
    const host = u.hostname.toLowerCase();
    if ([...DEFAULT_EXCLUDED, ...excluded].some((p) => hostMatches(host, p))) return { ok: false, reason: 'excluded site' };
    if (SENSITIVE_HOST.test(`${host}.`) || SENSITIVE_PATH.test(u.pathname)) return { ok: false, reason: 'sensitive page' };
    if (SEARCH_PAGE.test(host) && /\/search|[?&]q=/.test(u.pathname + u.search)) return { ok: false, reason: 'search results' };
    if (hasPassword) return { ok: false, reason: 'has a password field' };
    if (isFeed) return { ok: false, reason: 'feed' };
    if (textLength < 1200) return { ok: false, reason: 'too little text' };
    return { ok: true, reason: '' };
  }

  /** Pure: whether the reader has actually read the page. reading: { activeMs, depth, scrollable } */
  function hasBeenRead({ activeMs, depth, scrollable }, minSeconds = 45) {
    return activeMs >= minSeconds * 1000 && (!scrollable || depth >= 0.5);
  }

  // ---------------------------------------------------------------------------
  // Watching the page
  // ---------------------------------------------------------------------------

  const ext = soroagent.ext || root.browser || root.chrome;
  const TICK_MS = 3000;
  const IDLE_MS = 2 * 60 * 1000;
  let settings = null;
  let reading = null;
  let lastTick = Date.now();
  let lastInput = Date.now();

  const keyOf = (href) => (soroagent.pageKey ? soroagent.pageKey(href) : href.split('#')[0]);
  const reset = () => {
    if (reading) flushReading(); // the page being left (single-page sites change URL in place)
    reading = { url: keyOf(location.href), href: location.href, title: document.title, activeMs: 0, depth: 0, done: false, logged: 0 };
  };

  // Reading log (Settings → "Keep a reading log", on): the active time on each page, with its site and
  // title, kept on this device for the Stats page (shared/patterns.js). Never synced or
  // sent anywhere; skipped on the pages capture never touches (mail, banking, sign-in…) and in private
  // windows. Sent in parts (when leaving, hiding the tab, and every minute) as time since the last part.
  const LOG_MIN_MS = 10000; // under 10 s is a glance, not a read
  function flushReading() {
    if (!settings || settings.readingLog === false || !reading || reading.activeMs < LOG_MIN_MS) return;
    if (ext.extension && ext.extension.inIncognitoContext) return;
    const ms = reading.activeMs - reading.logged;
    if (ms < 1000) return;
    const sensitive = reading.href === location.href && Boolean(document.querySelector('input[type="password"]'));
    if (!captureAllowed({ url: reading.href, hasPassword: sensitive, textLength: Infinity }, settings.captureExclude || []).ok) return;
    const visit = reading.logged === 0;
    reading.logged = reading.activeMs;
    let host = '';
    try {
      host = new URL(reading.href).hostname;
    } catch {
      return;
    }
    ext.runtime.sendMessage({ type: 'reading:log', host, title: reading.title || host, ms, visit }).catch(() => {});
  }
  reset();

  function measureDepth() {
    const doc = document.scrollingElement || document.documentElement;
    const total = Math.max(doc.scrollHeight, 1);
    reading.depth = Math.max(reading.depth, Math.min(1, (root.scrollY + root.innerHeight) / total));
    return total > root.innerHeight * 1.5;
  }

  async function capture() {
    const site = soroagent.siteFor ? soroagent.siteFor(location) : { id: 'default' };
    const info = site.pageInfo ? site.pageInfo(location) : {};
    const isFeed = Boolean(site.items && site.items.isFeed && site.items.isFeed(info));
    let page = null;
    try {
      page = site.extract ? site.extract(document, location) : null;
    } catch {
      page = null;
    }
    if (!page || !page.text || page.text.length < 400) page = soroagent.extractPage(document, { maxChars: 8000 });
    const allowed = captureAllowed({ url: location.href, hasPassword: Boolean(document.querySelector('input[type="password"]')), textLength: (page.text || '').length, isFeed }, settings.captureExclude || []);
    if (!allowed.ok) return;
    // Already in the library (summarized, saved or captured before): nothing to add.
    const existing = await soroagent.snippetsForPage(location.href);
    if (existing.some((s) => s.kind !== 'screenshot')) return;
    const description = document.querySelector('meta[name="description"], meta[property="og:description"]');
    const firstParagraph = [...document.querySelectorAll('article p, main p, p')].map((p) => p.textContent.trim()).find((t) => t.length > 100 && /[.!?]/.test(t));
    const excerpt = ((description && description.content) || firstParagraph || page.text).replace(/\s+/g, ' ').trim();
    const snippet = await soroagent.upsertSnippet({
      kind: 'read',
      source: 'capture',
      title: (page.title || document.title || location.hostname).slice(0, 160),
      pageTitle: document.title,
      summary: excerpt.length > 260 ? `${excerpt.slice(0, 260).replace(/\s+\S*$/, '')}…` : excerpt,
      text: page.text.slice(0, 8000),
      url: location.href,
      tags: [],
      readSeconds: Math.round(reading.activeMs / 1000),
      scrollDepth: Math.round(reading.depth * 100),
      dedupeKey: `read:${keyOf(location.href)}`,
    });
    if (settings.captureLabel !== false && soroagent.buildMessages) {
      const messages = soroagent.buildMessages('save', soroagent.pageVars({ title: document.title, url: location.href, text: page.text.slice(0, 5000) }));
      ext.runtime.sendMessage({ type: 'capture:label', id: snippet.id, messages }).catch(() => {});
    }
    if (soroagent.onCaptured) soroagent.onCaptured(snippet);
  }

  function tick() {
    const now = Date.now();
    if (keyOf(location.href) !== reading.url) reset(); // single-page sites
    const active = document.visibilityState === 'visible' && document.hasFocus() && now - lastInput < IDLE_MS;
    if (active) reading.activeMs += Math.min(now - lastTick, TICK_MS * 2);
    if (active && document.title) reading.title = document.title; // titles often settle after load
    lastTick = now;
    if (reading.activeMs - reading.logged >= 60000) flushReading();
    if (!settings || settings.autoCapture !== 'on' || reading.done) return;
    const scrollable = measureDepth();
    if (hasBeenRead({ ...reading, scrollable }, Number(settings.captureMinSeconds) || 45)) {
      reading.done = true;
      // Quietly: it's background work; problems go to the diagnostic log, not the console.
      capture().catch((err) => ext.runtime.sendMessage({ type: 'diag:record', event: { area: 'error', code: 'capture-failed', message: err.message, detail: { where: 'capture' } } }).catch(() => {}));
    }
  }

  for (const type of ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart']) {
    root.addEventListener(type, () => (lastInput = Date.now()), { passive: true, capture: true });
  }
  root.addEventListener('scroll', () => reading && measureDepth(), { passive: true });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushReading());
  root.addEventListener('pagehide', flushReading);
  setInterval(tick, TICK_MS);

  const apply = (s) => {
    settings = s || {};
  };
  ext.storage.local.get('settings').then((stored) => apply(stored.settings), () => {});
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) apply(changes.settings.newValue);
  });

  soroagent.capture = { captureAllowed, hasBeenRead, DEFAULT_EXCLUDED };
})(globalThis);

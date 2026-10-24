// Web research for the "Research" action: search the web, read the top results, and hand
// their text to the model. Runs in the background worker. The parsing helpers are pure (no DOM,
// which a service worker doesn't have) and unit tested.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
  function decodeEntities(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, code) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    });
  }
  const stripTags = (html) => decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

  /** Results from DuckDuckGo's lite page: [{ url, title, snippet }] (ads and DDG links skipped). */
  function parseDuckDuckGoLite(html) {
    const results = [];
    const seen = new Set();
    const linkRe = /<a[^>]*href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
    const snippets = [...String(html).matchAll(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
    let match;
    let i = 0;
    while ((match = linkRe.exec(html))) {
      const href = decodeEntities(match[1]);
      const target = href.match(/[?&]uddg=([^&]+)/);
      const url = target ? decodeURIComponent(target[1]) : href.startsWith('http') ? href : '';
      const snippet = snippets[i++] || '';
      if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js|[?&]ad_domain=/.test(href) || seen.has(url)) continue;
      seen.add(url);
      results.push({ url, title: stripTags(match[2]), snippet });
    }
    return results;
  }

  /** Results from Brave Search's HTML page. */
  function parseBrave(html) {
    const results = [];
    const seen = new Set();
    for (const block of String(html).split('data-type="web"').slice(1)) {
      const seg = block.slice(0, 4000);
      const href = (seg.match(/href="(https?:\/\/[^"]+)"/) || [])[1];
      if (!href) continue;
      const url = decodeEntities(href);
      if (/^https?:\/\/([a-z0-9-]+\.)?(brave\.com|search\.brave\.com)\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      const title = stripTags((seg.match(/class="title[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || url);
      const snippet = stripTags((seg.match(/class="(?:snippet-description|generic-snippet|content)[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '');
      results.push({ url, title, snippet });
    }
    return results;
  }

  /** Results from Bing's HTML page (links are wrapped in a redirect with a base64 target). */
  function parseBing(html) {
    const results = [];
    const seen = new Set();
    const re = /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>([\s\S]{0,1500})/g;
    let m;
    while ((m = re.exec(String(html)))) {
      const href = decodeEntities(m[1]);
      const wrapped = href.match(/[?&]u=a1([^&]+)/);
      let url = href;
      if (wrapped) {
        try {
          const b64 = wrapped[1].replace(/-/g, '+').replace(/_/g, '/');
          url = decodeURIComponent(escape(atob(b64 + '==='.slice((b64.length + 3) % 4))));
        } catch {
          continue;
        }
      }
      if (!/^https?:\/\//.test(url) || /bing\.com\//.test(url) || seen.has(url)) continue;
      seen.add(url);
      results.push({ url, title: stripTags(m[2]), snippet: stripTags((m[3].match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '') });
    }
    return results;
  }

  /** Results from a SearXNG instance's JSON API. */
  function parseSearx(json) {
    return ((json && json.results) || [])
      .filter((r) => r && /^https?:\/\//.test(r.url))
      .map((r) => ({ url: r.url, title: String(r.title || r.url), snippet: String(r.content || '') }));
  }

  /**
   * Readable text from an HTML page without a DOM: keeps the title, headings, paragraphs and list
   * items from the main content; drops scripts, navigation, footers, forms and asides.
   */
  function htmlToText(html, maxChars = 6000) {
    let doc = String(html);
    const title = stripTags((doc.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    doc = doc.replace(/<!--[\s\S]*?-->/g, ' ');
    for (const tag of ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'select']) {
      doc = doc.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
    }
    // Prefer the main content when the page marks it.
    const main = doc.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i);
    if (main && main[2].length > 1500) doc = main[2];
    const blocks = [];
    const blockRe = /<(h[1-6]|p|li|blockquote|pre|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = blockRe.exec(doc))) {
      const text = stripTags(m[2]);
      if (!text) continue;
      if (/^h/i.test(m[1])) blocks.push(`## ${text}`);
      else if (m[1].toLowerCase() === 'li') {
        if (text.length >= 30) blocks.push(`- ${text}`); // short items are mostly menus
      } else if (text.length >= 40) blocks.push(text);
    }
    let text = blocks.join('\n');
    if (text.length < 300) text = stripTags(doc); // pages without semantic blocks
    return { title, text: text.slice(0, maxChars) };
  }

  /** Numbered sources for the research prompt. */
  function formatSources(sources) {
    return sources
      .map((s, i) => `[${i + 1}] ${s.title || s.url}\nURL: ${s.url}\n${s.text || s.snippet || ''}`)
      .join('\n\n');
  }

  /**
   * Pure: true for http(s) URLs on the public internet. Search results pointing at this computer
   * or the local network (routers, NAS, intranet) are never fetched, so their contents can't end
   * up in a prompt.
   */
  function isPublicUrl(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host.includes('.') && !host.includes(':')) return false; // "localhost", "router", "nas"
    if (/(^|\.)(localhost|local|lan|home|internal|intranet|corp|home\.arpa)$/.test(host)) return false;
    const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (v4) {
      const [a, b] = [Number(v4[1]), Number(v4[2])];
      return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
    }
    if (host.includes(':')) return !/^(::1?$|::ffff:|f[cd][0-9a-f]{0,2}:|fe[89ab][0-9a-f]?:)/.test(host);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Network (background worker only)
  // ---------------------------------------------------------------------------

  async function fetchText(url, { timeoutMs = 9000, maxBytes = 1500000, signal, publicOnly = false } = {}) {
    if (publicOnly && !isPublicUrl(url)) throw new Error('Not a public web address.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      // No cookies: research never acts as the user on other sites.
      const res = await root.fetch(url, { credentials: 'omit', redirect: 'follow', signal: controller.signal, headers: { Accept: 'text/html,application/json;q=0.9,*/*;q=0.5' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // A public page that redirected into the local network is not read.
      if (publicOnly && res.url && !isPublicUrl(res.url)) throw new Error('Redirected to a private address.');
      const type = res.headers.get('content-type') || '';
      if (!/html|json|text\/plain/i.test(type)) throw new Error(`Not a web page (${type || 'unknown type'})`);
      const text = await res.text();
      return text.slice(0, maxBytes);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  // Search engines, tried in this order in "auto" mode (privacy-friendly first). Public engines
  // sometimes rate-limit automated searches, so the next one takes over.
  const ENGINES = {
    duckduckgo: { label: 'DuckDuckGo', url: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, parse: parseDuckDuckGoLite },
    brave: { label: 'Brave Search', url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`, parse: parseBrave },
    bing: { label: 'Bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en`, parse: parseBing },
  };
  const AUTO_ORDER = ['duckduckgo', 'brave', 'bing'];

  /** Resolves with { engine, results }. engine: 'auto' | 'duckduckgo' | 'brave' | 'bing' | 'searxng'. */
  async function searchWeb(query, { engine = 'auto', searxUrl = '', signal } = {}) {
    if (engine === 'searxng') {
      if (!searxUrl) throw Object.assign(new Error('No SearXNG URL set.'), { hint: 'Add your SearXNG server in soroagent settings, or choose another search engine.' });
      const base = searxUrl.replace(/\/+$/, '');
      const json = JSON.parse(await fetchText(`${base}/search?format=json&q=${encodeURIComponent(query)}`, { signal }));
      return { engine: 'SearXNG', results: parseSearx(json) };
    }
    const order = ENGINES[engine] ? [engine, ...AUTO_ORDER.filter((e) => e !== engine)] : AUTO_ORDER;
    let lastError = null;
    for (const id of order) {
      try {
        const results = ENGINES[id].parse(await fetchText(ENGINES[id].url(query), { signal }));
        if (results.length) return { engine: ENGINES[id].label, results };
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        lastError = err;
      }
    }
    throw Object.assign(new Error('The search engines didn\'t return results right now.'), {
      hint: `${lastError ? `(${lastError.message}) ` : ''}Try again in a minute, or set your own SearXNG search in settings.`,
    });
  }

  /** Searches, then reads the top `count` results in parallel. Unreadable pages are skipped. */
  async function gatherSources(query, { count = 5, engine, searxUrl, signal, onStatus } = {}) {
    if (onStatus) onStatus(`Searching the web for “${query}”…`);
    const { engine: used, results: all } = await searchWeb(query, { engine, searxUrl, signal });
    const results = all.filter((r) => isPublicUrl(r.url)).slice(0, count + 3);
    if (!results.length) throw Object.assign(new Error(`No web results for “${query}”.`), { hint: 'Try Research again with a different snippet.' });
    if (onStatus) onStatus(`Reading ${Math.min(count, results.length)} sources from ${used}…`);
    const read = await Promise.all(
      results.map(async (r) => {
        try {
          const page = htmlToText(await fetchText(r.url, { signal, publicOnly: true }));
          return page.text.length > 200 ? { ...r, title: r.title || page.title, text: page.text } : null;
        } catch {
          return null;
        }
      })
    );
    const sources = read.filter(Boolean).slice(0, count);
    // Fall back to search snippets when pages can't be read (paywalls, blocked fetches).
    const final = sources.length ? sources : results.slice(0, count).map((r) => ({ ...r, text: r.snippet }));
    final.engine = used;
    return final;
  }

  Object.assign(soroagent, { isPublicUrl, parseDuckDuckGoLite, parseBrave, parseBing, parseSearx, htmlToText, formatSources, decodeEntities, searchWeb, gatherSources });
})(globalThis);

// Reads the useful text out of a live page: the main readable content for summaries,
// questions and saving.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  const SKIP =
    'script, style, noscript, template, svg, canvas, iframe, nav, footer, aside, button, select, textarea, ' +
    '[aria-hidden="true"], [hidden], [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]';
  const BLOCKS = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figcaption, dt, dd, td, th';

  const squash = (text) => String(text || '').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

  function isVisible(el) {
    if (!el.getClientRects().length) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.opacity !== '0';
  }

  // True if any ancestor between el and container (exclusive) matches the selector or is in the set.
  function hasAncestor(el, container, { selector, set }) {
    for (let node = el.parentElement; node && node !== container; node = node.parentElement) {
      if (selector && node.matches(selector)) return true;
      if (set && set.has(node)) return true;
    }
    return false;
  }

  function pickContentRoot(doc) {
    let best = null;
    let bestLength = 0;
    for (const el of doc.querySelectorAll('article, main, [role="main"]')) {
      const length = (el.innerText || '').length;
      if (length > bestLength) {
        best = el;
        bestLength = length;
      }
    }
    return best && bestLength > 500 ? best : doc.body;
  }

  function formatBlock(el, text) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${text.replace(/\n/g, ' ')}`;
    if (tag === 'li') return `- ${text}`;
    if (tag === 'blockquote') return text.split('\n').map((line) => `> ${line}`).join('\n');
    if (tag === 'pre') return '```\n' + text + '\n```';
    return text;
  }

  function truncate(text, maxChars) {
    if (text.length <= maxChars) return { text, truncated: false };
    const cut = text.lastIndexOf('\n', maxChars);
    return { text: text.slice(0, cut > maxChars * 0.8 ? cut : maxChars), truncated: true };
  }

  /** Returns { title, url, text, truncated } with the page's main readable text as light Markdown. */
  function extractPage(doc = document, { maxChars = 12000 } = {}) {
    return { title: doc.title, url: doc.location ? doc.location.href : '', ...truncate(readPage(doc), maxChars) };
  }

  /** The page's main readable text as light Markdown, in full. */
  function readPage(doc = document) {
    const container = pickContentRoot(doc);
    const parts = [];
    const taken = new Set();

    for (const el of container.querySelectorAll(BLOCKS)) {
      if (hasAncestor(el, container, { selector: SKIP, set: taken })) continue;
      if (el.matches(SKIP) || !isVisible(el)) continue;
      const raw = el.tagName === 'PRE' ? el.innerText.trim() : squash(el.innerText);
      if (!raw) continue;
      taken.add(el);
      const block = formatBlock(el, raw);
      if (parts[parts.length - 1] !== block) parts.push(block);
    }

    let text = parts.join('\n\n');
    // Sites built from <div>s (social feeds, web apps) have few semantic blocks; use rendered text then.
    const fullText = squash(container.innerText);
    if (text.length < fullText.length * 0.4) text = fullText;
    return text;
  }

  // Blocks of detached HTML (no layout, so no visibility checks) as light Markdown.
  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const parts = [];
    for (const el of doc.body.querySelectorAll(BLOCKS)) {
      if (el.parentElement && el.parentElement.closest(BLOCKS)) continue; // a block inside a block
      const raw = el.tagName === 'PRE' ? el.textContent.trim() : squash(el.textContent);
      if (raw && parts[parts.length - 1] !== raw) parts.push(formatBlock(el, raw));
    }
    return parts.join('\n\n') || squash(doc.body.textContent);
  }

  /**
   * The generic fallback when a site profile's selectors find nothing (sites change their markup):
   * Mozilla's Readability on a copy of the page (vendor/readability), else our own reader.
   * Returns { text, parser: 'readability' | 'generic' }.
   */
  function readFallback(doc = document) {
    if (typeof root.Readability === 'function') {
      try {
        const article = new root.Readability(doc.cloneNode(true), { charThreshold: 300 }).parse();
        const text = article && htmlToText(article.content);
        if (text && text.length > 300) return { text: `${article.title ? `# ${article.title}\n\n` : ''}${text}`, parser: 'readability' };
      } catch {
        // fall through to our own reader
      }
    }
    return { text: readPage(doc), parser: 'generic' };
  }

  // ---------------------------------------------------------------------------
  // High-resolution pictures on the page (offered for download; see assistant.js)
  // ---------------------------------------------------------------------------

  /** Pure: srcset candidates as [{ url, w, x }] (w: width descriptor, x: density), widest first. */
  function parseSrcset(srcset, base = '') {
    const out = [];
    for (const part of String(srcset || '').split(/,\s+(?=\S)/)) {
      const [raw, desc = ''] = part.trim().split(/\s+/);
      if (!raw) continue;
      let url;
      try {
        url = new URL(raw, base || undefined).href;
      } catch {
        continue;
      }
      const w = /^\d+w$/.test(desc) ? parseInt(desc, 10) : 0;
      const x = /^[\d.]+x$/.test(desc) ? parseFloat(desc) : desc ? 0 : 1;
      out.push({ url, w, x });
    }
    return out.sort((a, b) => b.w - a.w || b.x - a.x);
  }

  /**
   * Pure: the high-resolution pictures among candidates [{ url, width, height, shownWidth,
   * shownHeight, alt }]: http(s) only (no data:/blob:, no SVG), at least `minLong` px on the long side
   * and `minShort` on the short one (or `minPixels` in total), shown at a real size on the page (not
   * an icon, sprite or hidden image), no duplicates; largest first, at most `max`.
   */
  function pickPictures(candidates, { minLong = 1600, minShort = 900, minPixels = 2000000, minShown = 160, max = 40 } = {}) {
    const seen = new Set();
    const out = [];
    for (const c of candidates || []) {
      const url = String(c.url || '');
      if (!/^https?:\/\//i.test(url) || /\.svg(\?|#|$)/i.test(url)) continue;
      const long = Math.max(c.width || 0, c.height || 0);
      const short = Math.min(c.width || 0, c.height || 0);
      const big = (long >= minLong && short >= minShort) || (c.width || 0) * (c.height || 0) >= minPixels;
      if (!big || Math.max(c.shownWidth || 0, c.shownHeight || 0) < minShown) continue;
      const key = url.replace(/[?#].*$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url, width: c.width, height: c.height, alt: String(c.alt || '').replace(/\s+/g, ' ').trim().slice(0, 120) });
    }
    return out.sort((a, b) => b.width * b.height - a.width * a.height).slice(0, max);
  }

  /** Pure: a file name for a picture: its own name when it has one, else the page's site and a number. */
  function pictureFileName(url, { host = '', index = 1, alt = '' } = {}) {
    let name = '';
    let ext = 'jpg';
    try {
      const path = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
      const m = path.match(/^(.+?)\.(jpe?g|png|webp|avif|gif|tiff?|bmp|heic)$/i);
      if (m) {
        name = m[1];
        ext = m[2].toLowerCase().replace('jpeg', 'jpg');
      } else if (/format=(png|webp|avif)/i.test(url)) ext = url.match(/format=(png|webp|avif)/i)[1].toLowerCase();
    } catch {
      // keep the defaults
    }
    if (!name || name.length < 3 || /^[0-9a-f-]{24,}$/i.test(name)) name = alt || `${host || 'picture'}-${index}`;
    const safe = name.replace(/[\\/:*?"<>|#%{}~&\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || `picture-${index}`;
    return `${safe}.${ext}`;
  }

  /** The page's pictures as candidates for pickPictures (the largest version each one offers). */
  function pagePictures(doc = document) {
    const candidates = [];
    for (const img of doc.images) {
      const rect = img.getBoundingClientRect();
      const natural = { w: img.naturalWidth, h: img.naturalHeight };
      if (!natural.w || !natural.h) continue; // not loaded (yet)
      let url = img.currentSrc || img.src;
      let width = natural.w;
      let height = natural.h;
      // A bigger version in srcset (or a <picture> source) than the one the page loaded.
      const sources = [img.getAttribute('srcset'), ...[...(img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement.querySelectorAll('source[srcset]') : [])].map((s) => s.getAttribute('srcset'))];
      for (const set of sources) {
        const best = parseSrcset(set, doc.baseURI)[0];
        if (best && best.w > width) {
          height = Math.round((height * best.w) / width);
          width = best.w;
          url = best.url;
        }
      }
      candidates.push({ url, width, height, shownWidth: rect.width, shownHeight: rect.height, alt: img.alt });
    }
    return pickPictures(candidates);
  }

  Object.assign(soroagent, { extractPage, readPage, readFallback, htmlToText, parseSrcset, pickPictures, pictureFileName, pagePictures });
})(globalThis);

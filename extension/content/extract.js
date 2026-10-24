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

  Object.assign(soroagent, { extractPage, readPage, readFallback, htmlToText });
})(globalThis);

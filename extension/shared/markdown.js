// Small, safe Markdown renderer for model output. Everything is HTML-escaped first;
// only a fixed set of tags is produced and links must be http(s).
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Removes model reasoning: <think>…</think> blocks, an unfinished block at the end of a stream,
  // and reasoning that ends in a lone </think> (some chat templates put the opening tag in the prompt).
  function stripThinking(text) {
    let out = String(text);
    const close = out.toLowerCase().lastIndexOf('</think>');
    if (close >= 0 && out.toLowerCase().lastIndexOf('<think>', close) < 0) out = out.slice(close + '</think>'.length);
    return out.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/^\s+/, '');
  }

  function renderInline(escaped) {
    const codeSpans = [];
    let html = escaped.replace(/`([^`\n]+)`/g, (_, code) => {
      codeSpans.push(`<code>${code}</code>`);
      return `\u0000${codeSpans.length - 1}\u0000`;
    });
    html = html
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    return html.replace(/\u0000(\d+)\u0000/g, (_, i) => codeSpans[Number(i)]);
  }

  function renderMarkdown(text) {
    const lines = escapeHtml(String(text || '').replace(/\r\n?/g, '\n')).split('\n');
    const out = [];
    let paragraph = [];
    let list = null; // { tag: 'ul' | 'ol', items: [] }
    let code = null;
    let table = null; // rows of cells

    // Simple tables: | a | b | rows; the |---| line under the header is left out.
    const flushTable = () => {
      if (!table) return;
      const rows = table.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c.trim())));
      const [head, ...body] = rows;
      const cells = (r, tag) => r.map((c) => `<${tag}>${renderInline(c.trim())}</${tag}>`).join('');
      out.push(`<table><thead><tr>${cells(head, 'th')}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('')}</tbody></table>`);
      table = null;
    };
    const flushParagraph = () => {
      if (paragraph.length) out.push(`<p>${renderInline(paragraph.join('<br>'))}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${list.tag}>`);
      list = null;
    };

    for (const line of lines) {
      if (code) {
        if (/^\s*```/.test(line)) {
          out.push(`<pre><code>${code.join('\n')}</code></pre>`);
          code = null;
        } else code.push(line);
        continue;
      }
      if (/^\s*```/.test(line)) {
        flushParagraph();
        flushList();
        code = [];
        continue;
      }

      if (/^\s*\|.*\|\s*$/.test(line)) {
        flushParagraph();
        flushList();
        (table = table || []).push(line.trim().slice(1, -1).split('|'));
        continue;
      }
      flushTable();

      const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

      if (heading) {
        flushParagraph();
        flushList();
        const level = Math.min(6, heading[1].length + 2); // keep headings small inside the panel
        out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      } else if (bullet || numbered) {
        flushParagraph();
        const tag = bullet ? 'ul' : 'ol';
        if (list && list.tag !== tag) flushList();
        list = list || { tag, items: [] };
        list.items.push((bullet || numbered)[1]);
      } else if (!line.trim()) {
        flushParagraph();
        flushList();
      } else if (list && /^\s{2,}\S/.test(line)) {
        list.items[list.items.length - 1] += ' ' + line.trim(); // wrapped list item
      } else {
        flushList();
        paragraph.push(line.trim());
      }
    }
    if (code) out.push(`<pre><code>${code.join('\n')}</code></pre>`);
    flushTable();
    flushParagraph();
    flushList();
    return out.join('');
  }

  /**
   * Makes account names in a summary clickable, as Markdown links: @handle on X, u/name and
   * r/subreddit on Reddit. `site` is the page's hostname or URL. Code spans and existing links
   * are left alone.
   */
  function linkHandles(text, site) {
    let host = String(site || '');
    try {
      host = new URL(host).hostname;
    } catch {
      // already a hostname
    }
    const isX = /(^|\.)(x|twitter)\.com$/i.test(host);
    const isReddit = /(^|\.)reddit\.com$/i.test(host);
    if (!isX && !isReddit) return String(text || '');
    // Before a name: start, whitespace, or opening punctuation and Markdown emphasis.
    const lead = '(^|[\\s(\\[“"\'*_—–:,;-])';
    return String(text || '')
      .split(/(`[^`\n]*`|\[[^\]\n]*\]\([^)\s]*\))/)
      .map((part, i) => {
        if (i % 2) return part; // code span or existing link
        if (isX) return part.replace(new RegExp(`${lead}@([A-Za-z0-9_]{1,15})\\b(?![@.]\\w)`, 'g'), '$1[@$2](https://x.com/$2)');
        return part
          .replace(new RegExp(`${lead}/?u/([A-Za-z0-9_-]{3,20})\\b`, 'g'), '$1[u/$2](https://www.reddit.com/user/$2)')
          .replace(new RegExp(`${lead}/?r/([A-Za-z0-9_]{2,21})\\b`, 'g'), '$1[r/$2](https://www.reddit.com/r/$2)');
      })
      .join('');
  }

  Object.assign(soroagent, { escapeHtml, renderMarkdown, stripThinking, linkHandles });
})(globalThis);

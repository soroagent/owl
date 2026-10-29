// Showing what the AI wrote from the knowledge graph (answers, the weekly review, outputs): Markdown
// with every [n] linked to its source below, and the sources with the passage each came from.
// Used by the PKG and topic pages.
(function () {
  'use strict';

  const S = globalThis.soroagent;
  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  const dateOf = (at) => (at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  /** [n], [3, 8] and [1-4] in the nodes' text become links to `#<prefix>-<n>`. */
  function linkCitations(nodes, count, prefix = 'cite') {
    const CITE = /(\[\d+(?:\s*[,–-]\s*\d+)*\])/;
    const numbers = (p) => p.slice(1, -1).split(/\s*,\s*/).flatMap((part) => {
      const [a, b] = part.split(/\s*[–-]\s*/).map(Number);
      return b && b > a && b - a < 30 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
    }).filter((n) => n >= 1 && n <= count);
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE && CITE.test(child.textContent)) {
          const parts = child.textContent.split(CITE);
          child.replaceWith(...parts.flatMap((p) => {
            const list = /^\[/.test(p) && CITE.test(p) ? numbers(p) : [];
            return list.length ? list.map((n) => el('a', { className: 'cite', href: `#${prefix}-${n}`, textContent: `[${n}]` })) : [document.createTextNode(p)];
          }));
        } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'A') walk(child);
      }
    };
    nodes.forEach((n) => n.nodeType === Node.ELEMENT_NODE && walk(n));
    return nodes;
  }

  /** Markdown → nodes, with citations linked. */
  function prose(text, count, prefix) {
    // Small models write a section that only says "None" when told to leave it out; it goes.
    const clean = S.stripThinking(String(text || '')).replace(/^\s*#+\s.*\n+/, '').replace(/^\*\*[^*\n]+\*\*\s*\n+(?:[-*]\s*)?none\.?\s*(?:\n|$)/gim, '');
    return el('div', { className: 'prose' }, linkCitations([...new DOMParser().parseFromString(`<body>${S.renderMarkdown(clean)}</body>`, 'text/html').body.childNodes], count, prefix));
  }

  /** The numbered sources (from S.kguse.resolveCites), each with its passage and links. */
  function sourcesList(sources, prefix = 'cite') {
    return el('ol', { className: 'cites' }, sources.map((s) => {
      const links = [el('span', { textContent: dateOf(s.at) }), el('a', { href: `snippets.html#${encodeURIComponent(s.noteId || '')}`, textContent: s.title ? `“${s.title.slice(0, 70)}${s.title.length > 70 ? '…' : ''}”` : 'your snippet' })];
      if (s.passage) links.push(el('a', { href: S.safeUrl(s.passage), target: '_blank', rel: 'noopener noreferrer', textContent: `the passage on ${s.host} ↗` }));
      else if (/^https?:/.test(s.url)) links.push(el('a', { href: S.safeUrl(s.url), target: '_blank', rel: 'noopener noreferrer', textContent: `${s.host} ↗` }));
      return el('li', { id: `${prefix}-${s.n}` }, [
        el('span', { className: 'n', textContent: `[${s.n}]` }),
        el('div', {}, [
          el('div', { className: 'claim-text' }, [document.createTextNode(s.text || s.title || ''), ...(s.contradicted ? [el('span', { className: 'flag', textContent: ' disputed' })] : [])]),
          ...(s.quote ? [el('blockquote', { className: 'quote', textContent: s.quote })] : []),
          el('div', { className: 'src' }, links),
        ]),
      ]);
    }));
  }

  /** An answer: the text, then its sources folded away; a citation opens them and jumps there. */
  function answer(text, sources, { prefix = 'cite', open = false } = {}) {
    const details = el('details', { className: 'sources', open }, [el('summary', { textContent: `Sources · ${sources.length}` }), sourcesList(sources, prefix)]);
    const box = el('div', { className: 'answer' }, [prose(text, sources.length, prefix), ...(sources.length ? [details] : [])]);
    box.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('a.cite')) details.open = true;
    });
    return box;
  }

  S.kgview = { linkCitations, prose, sourcesList, answer };
})();

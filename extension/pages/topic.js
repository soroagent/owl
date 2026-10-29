// A topic page: everything you've read about one entity (topic.html?e=<key>). The living page your
// AI keeps (kgpage:<key>, written by background/kgworker.js and rewritten when new claims come in),
// with every [n] linked to the claim and the exact passage it came from; where sources disagree;
// the claims over time; what it's connected to; and the snippets. You correct the graph here:
// rename, change the type, merge into another entity, split off a name filed here by mistake, hide.
(function () {
  'use strict';

  const S = globalThis.soroagent;
  S.watchPageErrors('topic');
  const { ext } = S;
  const K = S.kg;
  const $ = (id) => document.getElementById(id);
  let key = new URLSearchParams(location.search).get('e') || '';
  let data = null; // { notes, notesById, kg, page, edits }
  let writing = false;

  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  const dateOf = (at) => (at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'undated');
  const topicHref = (k) => `topic.html?e=${encodeURIComponent(k)}`;
  const snippetHref = (id) => `snippets.html#${encodeURIComponent(id)}`;
  // Snippets whose text is the page's own (not an AI summary) can link to the passage on the page.
  const PAGE_TEXT = new Set(['page', 'selection', 'read']);

  async function loadAll() {
    const all = await ext.storage.local.get(null);
    const notes = [];
    const pick = (prefix) => Object.fromEntries(Object.keys(all).filter((k) => k.startsWith(prefix)).map((k) => [k.slice(prefix.length), all[k]]));
    for (const k of Object.keys(all)) if (k.startsWith('snippet:') && all[k] && all[k].id) notes.push(all[k]);
    const edits = all.kgEdits || K.EMPTY_EDITS;
    const kg = K.buildKG({ notes, extractions: pick('kgx:'), comparisons: pick('kgcmp:'), edits });
    // A merged entity's old address leads to where it went.
    if (!kg.entities.has(key) && edits.merges && edits.merges[key]) key = K.resolveKey(key, { ...K.EMPTY_EDITS, merges: edits.merges });
    return { notes, notesById: new Map(notes.map((n) => [n.id, n])), kg, page: all[`kgpage:${key}`] || null, edits };
  }

  async function saveEdits(next) {
    await ext.storage.local.set({ kgEdits: next });
  }

  // ---------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------

  function sourceLine(c) {
    const note = data.notesById.get(c.noteId) || {};
    const host = K.hostOf(note.url);
    const parts = [el('span', { textContent: dateOf(c.at) }), el('a', { href: snippetHref(c.noteId), textContent: note.title ? `“${note.title.slice(0, 70)}${note.title.length > 70 ? '…' : ''}”` : 'your snippet' })];
    const passage = PAGE_TEXT.has(note.kind) ? K.passageUrl(note.url, c.quote) : '';
    if (passage) parts.push(el('a', { href: S.safeUrl ? S.safeUrl(passage) : passage, target: '_blank', rel: 'noopener noreferrer', textContent: `the passage on ${host} ↗` }));
    else if (/^https?:/.test(note.url || '')) parts.push(el('a', { href: S.safeUrl ? S.safeUrl(note.url) : note.url, target: '_blank', rel: 'noopener noreferrer', textContent: `${host} ↗` }));
    return el('div', { className: 'src' }, parts);
  }

  function claimItem(c, n = 0) {
    const flags = [];
    if (c.stance !== 'neutral') flags.push(el('span', { className: `stance ${c.stance}`, textContent: c.stance === 'for' ? 'in favour' : 'critical' }));
    if (c.contradicts.length) flags.push(el('span', { className: 'flag', textContent: `disputed by ${plural(c.contradicts.length, 'other claim')}` }));
    if (c.supports.length) flags.push(el('span', { className: 'flag ok', textContent: `backed by ${plural(c.supports.length, 'other claim')}` }));
    const body = el('div', {}, [
      el('div', { className: 'claim-text' }, [document.createTextNode(`${c.text} `), ...flags]),
      el('blockquote', { className: 'quote', textContent: c.quote }),
      sourceLine(c),
    ]);
    return n ? el('li', { id: `cite-${n}` }, [el('span', { className: 'n', textContent: `[${n}]` }), body]) : el('li', {}, [body]);
  }

  // [n], [3, 8] and [1-4] in the page's text become links to their sources below.
  function linkCitations(nodes, count) {
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
            const list = CITE.test(p) && /^\[/.test(p) ? numbers(p) : [];
            return list.length ? list.map((n) => el('a', { className: 'cite', href: `#cite-${n}`, textContent: `[${n}]` })) : [document.createTextNode(p)];
          }));
        } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'A') walk(child);
      }
    };
    nodes.forEach((n) => n.nodeType === Node.ELEMENT_NODE && walk(n));
    return nodes;
  }

  function livingPage(ent) {
    const page = data.page;
    const box = el('section', { className: 'panel' });
    const fresh = page && page.basis === K.pageBasis(ent);
    const update = el('button', { type: 'button', className: 'btn small', textContent: page ? 'Update now' : 'Write it now' });
    update.addEventListener('click', writePage);
    const head = el('div', { className: 'head' }, [el('h2', { textContent: 'What you know' }), update]);
    if (writing) return box.replaceChildren(head, el('div', { className: 'working', textContent: 'Your AI is writing this page from everything you saved about it…' })), box;
    if (!page) {
      box.append(head, el('p', { className: 'sub', textContent: ent.noteIds.length >= 2 ? 'Your AI writes this page while you are away, from every claim you saved about it, and keeps it up to date as you read more.' : 'A page is written once you have saved two snippets about this. You can also write it now.' }));
      return box;
    }
    const cites = page.cites || [];
    // Small models sometimes start with the topic as a heading or label the first paragraph.
    const text = S.stripThinking(page.text || '').replace(/^\s*#+\s.*\n+/, '').replace(/^\s*\*{0,2}(opening paragraph|overview|introduction):?\*{0,2}:?\s*\n?/i, '');
    const prose = el('div', { className: 'prose' }, linkCitations([...new DOMParser().parseFromString(`<body>${S.renderMarkdown(text)}</body>`, 'text/html').body.childNodes], cites.length));
    const sub = el('p', { className: 'sub', textContent: `Written ${dateOf(page.at)} from ${plural(cites.length, 'source')}${fresh ? '' : '. You have saved more since; it is updated the next time you are away, or now.'}` });
    const list = el('ol', { className: 'cites' }, cites.map((id, i) => {
      if (id.startsWith('note:')) {
        const note = data.notesById.get(id.slice(5));
        if (!note) return el('li', { id: `cite-${i + 1}` }, [el('span', { className: 'n', textContent: `[${i + 1}]` }), el('span', { className: 'muted', textContent: 'A snippet you deleted.' })]);
        return el('li', { id: `cite-${i + 1}` }, [el('span', { className: 'n', textContent: `[${i + 1}]` }), el('div', {}, [el('a', { href: snippetHref(note.id), textContent: note.title || 'Your snippet' }), el('div', { className: 'src', textContent: `${dateOf(note.createdAt)} · ${K.hostOf(note.url)}` })])]);
      }
      const c = data.kg.claims.get(id);
      return c ? claimItem(c, i + 1) : el('li', { id: `cite-${i + 1}` }, [el('span', { className: 'n', textContent: `[${i + 1}]` }), el('span', { className: 'muted', textContent: 'A claim from a snippet that has changed or was deleted.' })]);
    }));
    const sources = el('details', { className: 'sources' }, [el('summary', { textContent: `Sources · ${cites.length}` }), list]);
    box.append(head, sub, prose, sources);
    return box;
  }

  function disputesPanel(ent) {
    const d = K.disagreements(data.kg, ent.key);
    if (!d.length) return null;
    return el('section', { className: 'panel' }, [
      el('h2', { textContent: 'Where your sources disagree' }),
      el('p', { className: 'sub', textContent: 'Claims your AI found that cannot both be true. The newer one is on the right.' }),
      ...d.map(({ a, b }) => el('div', { className: 'dispute' }, [
        el('div', {}, [el('div', { className: 'claim-text', textContent: b.text }), el('blockquote', { className: 'quote', textContent: b.quote }), sourceLine(b)]),
        el('div', {}, [el('div', { className: 'claim-text', textContent: a.text }), el('blockquote', { className: 'quote', textContent: a.quote }), sourceLine(a)]),
      ])),
    ]);
  }

  function timelinePanel(ent) {
    const claims = ent.claimIds.map((id) => data.kg.claims.get(id)).filter(Boolean);
    if (!claims.length) return null;
    const groups = K.claimTimeline(claims);
    return el('section', { className: 'panel' }, [
      el('h2', { textContent: 'Claims over time' }),
      el('p', { className: 'sub', textContent: 'Every claim about it in your snippets, in the order you saved them, each with the passage it came from.' }),
      ...groups.flatMap((g) => [el('div', { className: 'month', textContent: g.month }), el('ul', { className: 'claims' }, g.items.map((c) => claimItem(c)))]),
    ]);
  }

  function sidePanels(ent) {
    const near = K.neighbours(data.kg, ent.key).slice(0, 16);
    const out = [];
    if (near.length) {
      out.push(el('section', { className: 'panel' }, [
        el('h2', { textContent: 'Connected' }),
        el('p', { className: 'sub', textContent: 'Relations your sources state, then things you read about together.' }),
        el('div', { className: 'chips' }, near.map((n) => {
          const other = data.kg.entities.get(n.key);
          return el('a', { href: topicHref(n.key), className: other ? `t-${other.type}` : '' }, [
            ...(n.rels.length ? [el('small', { textContent: `${n.rels.join(', ')} ` })] : []),
            document.createTextNode(other ? other.name : n.key),
            ...(n.shared ? [el('small', { textContent: ` · ${n.shared}` })] : []),
          ]);
        })),
      ]));
    }
    const notes = ent.noteIds.map((id) => data.notesById.get(id)).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    out.push(el('section', { className: 'panel' }, [
      el('h2', { textContent: `Your snippets · ${notes.length}` }),
      el('ul', { className: 'notes' }, notes.slice(0, 40).map((s) => el('li', {}, [
        el('a', { href: snippetHref(s.id), textContent: s.title || s.pageTitle || 'Untitled' }),
        el('small', { textContent: [dateOf(s.createdAt), K.hostOf(s.url)].filter(Boolean).join(' · ') }),
      ]))),
    ]));
    out.push(toolsPanel(ent));
    return out;
  }

  // Corrections: everything here is stored as an edit (kgEdits) and can be undone.
  function toolsPanel(ent) {
    const rename = el('button', { type: 'button', className: 'btn small', textContent: 'Rename' });
    rename.addEventListener('click', async () => {
      const name = prompt('New name', ent.name);
      if (name && name.trim() && name.trim() !== ent.name) await saveEdits(K.setEdit(data.edits, 'names', ent.key, name.trim().slice(0, 80)));
    });
    const type = el('select', {}, K.TYPES.map((t) => el('option', { value: t, textContent: K.TYPE_LABEL[t], selected: t === ent.type })));
    type.setAttribute('aria-label', 'Type');
    type.addEventListener('change', () => saveEdits(K.setEdit(data.edits, 'types', ent.key, type.value)));
    const others = K.rankEntities(data.kg).filter((e) => e.key !== ent.key);
    const list = el('datalist', { id: 'entityNames' }, others.slice(0, 400).map((e) => el('option', { value: e.name })));
    const target = el('input', { type: 'text', placeholder: 'Merge into…', maxLength: 80 });
    target.setAttribute('list', 'entityNames');
    target.setAttribute('aria-label', 'Merge into');
    const merge = el('button', { type: 'button', className: 'btn small', textContent: 'Merge' });
    merge.addEventListener('click', async () => {
      const other = others.find((e) => e.name.toLowerCase() === target.value.trim().toLowerCase());
      if (!other) return (target.value = ''), (target.placeholder = 'Pick a name from the list');
      if (!confirm(`Merge “${ent.name}” into “${other.name}”? Everything about it moves there. You can split a name off again later.`)) return;
      await saveEdits(K.mergeEdit(data.edits, ent.key, other.key));
      location.replace(topicHref(other.key));
    });
    const hide = el('button', { type: 'button', className: 'btn small danger', textContent: 'Hide from the graph' });
    hide.addEventListener('click', async () => {
      if (!confirm(`Hide “${ent.name}”? It disappears from the graph and its pages; your snippets stay. Settings → PKG → Clear the graph brings everything back.`)) return;
      await saveEdits(K.setEdit(data.edits, 'hidden', ent.key, true));
      location.replace('pkg.html');
    });
    const merged = Object.entries(data.edits.merges || {}).filter(([, into]) => into === ent.key);
    const undo = merged.map(([from]) => {
      const b = el('button', { type: 'button', className: 'btn small', textContent: `Unmerge ${from}` });
      b.addEventListener('click', async () => {
        const next = { ...K.EMPTY_EDITS, ...data.edits, merges: { ...data.edits.merges } };
        delete next.merges[from];
        await saveEdits(next);
      });
      return b;
    });
    return el('section', { className: 'panel' }, [
      el('h2', { textContent: 'Fix the graph' }),
      el('p', { className: 'sub', textContent: 'Your AI files names automatically and sometimes gets it wrong. To take a name out of this entity, click × next to it at the top.' }),
      el('div', { className: 'tools' }, [rename, type]),
      el('div', { className: 'tools', style: 'margin-top:8px' }, [target, list, merge]),
      ...(undo.length ? [el('div', { className: 'tools', style: 'margin-top:8px' }, undo)] : []),
      el('div', { className: 'tools', style: 'margin-top:8px' }, [hide]),
    ]);
  }

  function header(ent) {
    const aliases = [ent.name, ...ent.aliases];
    const chips = ent.aliases.length
      ? el('div', { className: 'aliases' }, [el('span', { className: 'muted', textContent: 'Written as:', style: 'font-size:12px;align-self:center' }), ...aliases.map((name) => {
        const b = el('button', { type: 'button', title: `Split “${name}” off into an entity of its own`, textContent: '×' });
        b.setAttribute('aria-label', `Split ${name} off`);
        b.addEventListener('click', async () => {
          if (!confirm(`Split “${name}” off? Snippets that call it “${name}” move to an entity of their own.`)) return;
          await saveEdits(K.splitEdit(data.edits, name));
        });
        return el('span', { className: 'alias' }, [document.createTextNode(name), b]);
      })])
      : null;
    const disputes = K.disagreements(data.kg, ent.key).length;
    return el('div', {}, [
      el('h1', { textContent: ent.name }),
      el('div', { className: 'meta' }, [
        el('span', { className: `type t-${ent.type}`, textContent: K.TYPE_LABEL[ent.type] }),
        el('span', { textContent: `${plural(ent.noteIds.length, 'snippet')} · ${plural(ent.claimIds.length, 'claim')}${disputes ? ` · ${plural(disputes, 'disagreement')}` : ''}` }),
        el('span', { textContent: ent.first === ent.last ? `read ${dateOf(ent.first)}` : `read from ${dateOf(ent.first)} to ${dateOf(ent.last)}` }),
      ]),
      ...(chips ? [chips] : []),
    ]);
  }

  function render() {
    const ent = data.kg.entities.get(key);
    if (!ent) {
      document.title = 'Topic · soroagent';
      $('page').replaceChildren(el('div', { className: 'empty', textContent: 'This topic is not in your knowledge graph (any more). It may have been merged, hidden, or its snippets deleted.' }));
      return;
    }
    document.title = `${ent.name} · soroagent`;
    $('page').replaceChildren(
      header(ent),
      el('div', { className: 'layout' }, [
        el('div', {}, [livingPage(ent), disputesPanel(ent), timelinePanel(ent)].filter(Boolean)),
        el('aside', {}, sidePanels(ent)),
      ]),
    );
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }
  // A citation opens the sources and jumps to its own.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.cite');
    if (!a) return;
    const box = document.querySelector('details.sources');
    if (box) box.open = true;
  });

  async function writePage() {
    writing = true;
    render();
    const res = await ext.runtime.sendMessage({ type: 'kg:page', key }).catch((err) => ({ ok: false, error: err.message }));
    writing = false;
    if (!res || !res.ok || !res.page) alert(`Couldn't write the page: ${(res && res.error) || 'nothing to write from yet.'}`);
    await load();
  }

  async function load() {
    data = await loadAll();
    if (new URLSearchParams(location.search).get('e') !== key) history.replaceState(null, '', topicHref(key));
    render();
  }

  let timer = 0;
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || writing || !Object.keys(changes).some((k) => /^(kg|snippet:)/.test(k) && k !== 'kgState')) return;
    clearTimeout(timer);
    timer = setTimeout(load, 400);
  });
  load();
})();

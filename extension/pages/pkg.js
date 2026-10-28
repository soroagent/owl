// PKG page: the personal knowledge graph (shared/pkg.js builds and lays it out). Read from this
// browser's storage only; nothing is sent anywhere.
(function () {
  'use strict';

  const S = globalThis.soroagent;
  S.watchPageErrors('pkg');
  const { ext } = S;
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';
  const W = 800;
  const H = 520;
  let graph = { topics: [], edges: [], totals: {} };
  let positions = {};
  let selected = '';
  let notesById = new Map();

  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  const svg = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  const tile = (k, v, s = '') => el('div', { className: 'tile' }, [el('div', { className: 'k', textContent: k }), el('div', { className: 'v', textContent: v }), el('div', { className: 's', textContent: s })]);
  const radius = (t, max) => 9 + 26 * Math.sqrt(t.weight / max);
  const neighbours = (id) => graph.edges.filter((e) => e.a === id || e.b === id).map((e) => ({ id: e.a === id ? e.b : e.a, shared: e.shared }));
  const describe = (t) => `${plural(t.notes, 'snippet')}${t.dwellMs ? ` · ${S.readingTime(t.dwellMs)} reading` : ''}`;

  // Scales the layout into the box with room for each circle and the label under it.
  function fit(pos) {
    const max = Math.max(...graph.topics.map((t) => t.weight), 1);
    const ids = Object.keys(pos);
    if (!ids.length) return pos;
    const xs = ids.map((id) => pos[id].x);
    const ys = ids.map((id) => pos[id].y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = { left: 70, right: 70, top: 45, bottom: 60 };
    const sx = maxX > minX ? (W - pad.left - pad.right) / (maxX - minX) : 0;
    const sy = maxY > minY ? (H - pad.top - pad.bottom) / (maxY - minY) : 0;
    const out = {};
    for (const t of graph.topics) {
      const r = radius(t, max);
      out[t.id] = {
        x: sx ? pad.left + (pos[t.id].x - minX) * sx : W / 2,
        y: Math.min(H - r - 22, Math.max(r + 6, sy ? pad.top + (pos[t.id].y - minY) * sy : H / 2)),
      };
    }
    return out;
  }

  function renderTiles() {
    const t = graph.totals;
    const top = graph.topics[0];
    const deep = [...graph.topics].filter((x) => x.notes >= 2 && x.dwellMs).sort((a, b) => b.dwellMs / b.notes - a.dwellMs / a.notes)[0];
    const growing = [...graph.topics].sort((a, b) => b.recent - a.recent)[0];
    $('tiles').replaceChildren(
      tile('Snippets', (t.notes || 0).toLocaleString(), t.notes ? `${t.tagged} with topics` : ''),
      tile('Topics', (t.topics || 0).toLocaleString(), graph.edges.length ? plural(graph.edges.length, 'connection') : ''),
      tile('Reading time on saved pages', S.readingTime(t.dwellMs) || '–', t.dwellMs ? 'adds weight to their topics' : 'counted as you read saved pages'),
      tile('Strongest topic', top ? top.label : '–', top ? describe(top) : ''),
      tile('Growing', growing && growing.recent ? growing.label : '–', growing && growing.recent ? `${plural(growing.recent, 'snippet')} in 30 days` : 'nothing new in 30 days'),
      tile('Deepest reading', deep ? deep.label : '–', deep ? `${S.readingTime(deep.dwellMs / deep.notes)} per snippet` : ''),
    );
  }

  function renderGraph() {
    const box = $('graph');
    const max = Math.max(...graph.topics.map((t) => t.weight), 1);
    const maxShared = Math.max(...graph.edges.map((e) => e.shared), 1);
    const near = selected ? new Set([selected, ...neighbours(selected).map((n) => n.id)]) : null;
    const edges = graph.edges.map((e) => {
      const a = positions[e.a];
      const b = positions[e.b];
      const on = selected && (e.a === selected || e.b === selected);
      const line = svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `edge${on ? ' on' : ''}`, 'stroke-width': 1 + 4 * (e.shared / maxShared) });
      line.dataset.tip = `${e.a} ↔ ${e.b}: ${plural(e.shared, 'snippet')} in common`;
      return line;
    });
    // Labels go under their circle, or above it when that would run into a label already placed.
    const placed = [];
    const overlaps = (box) => placed.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1);
    const nodes = graph.topics.map((t) => {
      const p = positions[t.id];
      const r = radius(t, max);
      const half = t.label.length * 3.6 + 4;
      const below = { x1: p.x - half, x2: p.x + half, y1: p.y + r + 2, y2: p.y + r + 18 };
      const above = { x1: p.x - half, x2: p.x + half, y1: p.y - r - 18, y2: p.y - r - 2 };
      const useAbove = overlaps(below) && !overlaps(above);
      placed.push(useAbove ? above : below);
      const g = svg('g', { class: `node${selected === t.id ? ' on' : ''}${near && !near.has(t.id) ? ' dim' : ''}`, transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`, tabindex: '0', role: 'button', 'aria-label': `${t.label}: ${describe(t)}` });
      g.append(svg('circle', { r: r.toFixed(1) }));
      const label = svg('text', { 'text-anchor': 'middle', y: (useAbove ? -r - 6 : r + 14).toFixed(1) });
      label.textContent = t.label;
      g.append(label);
      g.dataset.tip = `${t.label}: ${describe(t)}`;
      g.addEventListener('click', () => select(t.id));
      g.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), select(t.id)));
      return g;
    });
    box.replaceChildren(...edges, ...nodes);
  }

  function renderOverview() {
    const max = Math.max(...graph.topics.map((t) => t.weight), 1);
    const list = el('div', { className: 'rank' }, graph.topics.slice(0, 15).map((t) => {
      const bar = el('div', { className: 'bar' });
      bar.style.width = `${Math.max(3, (t.weight / max) * 100)}%`;
      const b = el('button', { type: 'button' }, [el('span', { className: 'name', textContent: t.label }), el('span', { className: 'val', textContent: describe(t) }), el('div', { className: 'track' }, [bar])]);
      b.addEventListener('click', () => select(t.id));
      return b;
    }));
    $('detail').replaceChildren(el('h2', { textContent: 'Where your knowledge is' }), el('p', { className: 'sub', textContent: 'Topics by weight: snippets plus reading time.' }), list);
  }

  function renderTopic(t) {
    const near = neighbours(t.id);
    const back = el('button', { type: 'button', className: 'btn small', textContent: '← All topics' });
    back.addEventListener('click', () => select(''));
    const facts = el('dl', { className: 'facts' }, [
      el('dt', { textContent: 'Snippets' }), el('dd', { textContent: `${t.notes}${t.recent ? ` (${t.recent} in the last 30 days)` : ''}` }),
      el('dt', { textContent: 'Reading time' }), el('dd', { textContent: S.readingTime(t.dwellMs) || 'none counted yet' }),
      el('dt', { textContent: 'Weight' }), el('dd', { textContent: `${t.weight.toFixed(1)} (${t.notes} + ${(t.dwellMs / 300000).toFixed(1)} from time)` }),
      el('dt', { textContent: 'Sources' }), el('dd', { textContent: t.sites.slice(0, 5).join(', ') + (t.sites.length > 5 ? ` and ${t.sites.length - 5} more` : '') || '–' }),
      el('dt', { textContent: 'Last added' }), el('dd', { textContent: t.last ? new Date(t.last).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–' }),
    ]);
    const nodes = [back, el('h3', { textContent: t.label }), facts];
    if (near.length) {
      nodes.push(el('div', { className: 'label', textContent: 'Connected topics' }), el('div', { className: 'chips' }, near.sort((a, b) => b.shared - a.shared).map((n) => {
        const b = el('button', { type: 'button', textContent: `${n.id} · ${n.shared}`, title: `${plural(n.shared, 'snippet')} in common` });
        b.addEventListener('click', () => select(n.id));
        return b;
      })));
    } else nodes.push(el('p', { className: 'sub', textContent: 'Not connected to other topics yet: no snippet shares this tag with another.' }));
    const notes = t.noteIds.map((id) => notesById.get(id)).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    nodes.push(el('div', { className: 'label', textContent: 'Snippets' }), el('ul', { className: 'notes' }, notes.slice(0, 30).map((s) => el('li', {}, [
      el('a', { href: `snippets.html#${encodeURIComponent(s.id)}`, textContent: s.title || s.pageTitle || 'Untitled' }),
      el('small', { textContent: [new Date(s.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), (() => { try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return ''; } })()].filter(Boolean).join(' · ') }),
    ]))));
    $('detail').replaceChildren(...nodes);
  }

  function select(id) {
    selected = id;
    renderGraph();
    const t = graph.topics.find((x) => x.id === id);
    if (t) renderTopic(t);
    else renderOverview();
  }

  // The digest: what you saved today, yesterday or this week, by topic (no AI; from your snippets).
  let digestDays = 0;
  let allSnippets = [];
  function renderDigest() {
    const now = new Date();
    const range = digestDays === 1 ? { from: S.dayStart(now, 1), to: S.dayStart(now, 0) } : { from: S.dayStart(now, digestDays === 7 ? 6 : 0) };
    const d = S.dailyDigest(allSnippets, range);
    const when = digestDays === 0 ? 'today' : digestDays === 1 ? 'yesterday' : 'in the last 7 days';
    $('digestSub').textContent = d.count ? `${plural(d.count, 'snippet')} saved ${when}, from ${plural(d.sites, 'source')}, in ${plural(d.topics.length, 'topic')}.` : `Nothing saved ${when}.`;
    const list = (items) => el('ul', { className: 'notes' }, items.slice(0, 12).map((s) => el('li', {}, [
      el('a', { href: `snippets.html#${encodeURIComponent(s.id)}`, textContent: s.title || s.pageTitle || 'Untitled' }),
      el('small', { textContent: s.summary && !String(s.title || '').startsWith(s.summary.replace(/…$/, '')) ? s.summary.slice(0, 140) : s.site || '' }),
    ])));
    const groups = d.topics.map((t) => el('div', {}, [el('h3', { textContent: `${t.topic} · ${t.items.length}` }), list(t.items)]));
    if (d.other.length) groups.push(el('div', {}, [el('h3', { textContent: `No topic yet · ${d.other.length}` }), list(d.other)]));
    $('digestBody').replaceChildren(el('div', { className: 'digest-topics' }, groups));
  }
  document.querySelectorAll('#digest .seg button').forEach((b) => b.addEventListener('click', () => {
    digestDays = Number(b.dataset.days);
    document.querySelectorAll('#digest .seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderDigest();
  }));

  async function load() {
    const all = await ext.storage.local.get(null);
    const snippets = Object.keys(all).filter((k) => k.startsWith('snippet:')).map((k) => all[k]).filter((s) => s && s.id);
    notesById = new Map(snippets.map((s) => [s.id, s]));
    allSnippets = snippets;
    renderDigest();
    graph = S.buildGraph(snippets, all.pkgDwell || {});
    positions = fit(S.layoutGraph(graph.topics, graph.edges, { width: W, height: H }));
    renderTiles();
    if (!graph.topics.length) {
      $('layout').replaceChildren(el('div', { className: 'empty', textContent: snippets.length ? 'Your snippets have no topics yet. Your AI adds topic tags when it saves a snippet; they appear here as a graph.' : 'Nothing in your PKG yet. Summarize or save a few pages; their topics and how they connect appear here.' }));
      return;
    }
    if (selected && !graph.topics.some((t) => t.id === selected)) selected = '';
    select(selected);
  }

  // Tooltips for nodes and lines.
  const tip = $('tip');
  document.addEventListener('pointermove', (e) => {
    const target = e.target.closest && e.target.closest('[data-tip]');
    if (!target) return (tip.hidden = true);
    tip.textContent = target.dataset.tip;
    tip.style.left = `${e.clientX}px`;
    tip.style.top = `${e.clientY}px`;
    tip.hidden = false;
  });

  let timer = 0;
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.keys(changes).some((k) => k.startsWith('snippet:') || k === 'pkgDwell')) return;
    clearTimeout(timer);
    timer = setTimeout(load, 600);
  });
  load();
})();

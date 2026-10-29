// PKG page: the personal knowledge graph. Two views: the entities your AI found in your snippets
// (shared/kg.js; people, companies, products, ideas, papers, places, linked by typed relations and by
// being read about together) and your tags (shared/pkg.js). Read from this browser's storage; the
// only thing sent anywhere is "Build now", which asks the background to run the graph worker.
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
  const K = S.kg;
  let kg = null; // the knowledge graph (S.kg.buildKG)
  let mode = 'entities'; // 'entities' | 'tags'
  let typeFilter = '';
  let query = '';
  let tagGraph = { topics: [], edges: [], totals: {} };

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
  const describe = (t) => t.ent
    ? `${K.TYPE_LABEL[t.ent.type]} · ${plural(t.ent.noteIds.length, 'snippet')}${t.ent.claimIds.length ? ` · ${plural(t.ent.claimIds.length, 'claim')}` : ''}`
    : `${plural(t.notes, 'snippet')}${t.dwellMs ? ` · ${S.readingTime(t.dwellMs)} reading` : ''}`;
  const dateOf = (at) => (at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
  const topicHref = (key) => `topic.html?e=${encodeURIComponent(key)}`;

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
      const line = svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `edge${on ? ' on' : ''}${e.rels && e.rels.length ? ' typed' : ''}`, 'stroke-width': 1 + 4 * (e.shared / maxShared) });
      const name = (id) => (graph.topics.find((t) => t.id === id) || { label: id }).label;
      line.dataset.tip = e.rels && e.rels.length ? `${name(e.a)} ${e.rels.join(', ')} ${name(e.b)}` : `${name(e.a)} ↔ ${name(e.b)}: ${plural(e.shared, 'snippet')} in common`;
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
      const g = svg('g', { class: `node${t.ent ? ` t-${t.ent.type}` : ''}${selected === t.id ? ' on' : ''}${near && !near.has(t.id) ? ' dim' : ''}`, transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`, tabindex: '0', role: 'button', 'aria-label': `${t.label}: ${describe(t)}` });
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

  // The entities view: the most-read entities of the chosen type, linked by typed relations
  // (darker lines) and by snippets they share.
  function entityGraph() {
    const list = K.rankEntities(kg, { type: typeFilter, query }).slice(0, 40);
    const keys = new Set(list.map((e) => e.key));
    const topics = list.map((e) => ({ id: e.key, label: e.name, weight: e.noteIds.length + e.claimIds.length * 0.3, ent: e }));
    const edges = new Map();
    for (const l of kg.links) if (keys.has(l.a) && keys.has(l.b)) edges.set(`${l.a}|${l.b}`, { a: l.a, b: l.b, shared: l.shared, rels: [] });
    for (const r of kg.relations) {
      if (!keys.has(r.a) || !keys.has(r.b)) continue;
      const k = [r.a, r.b].sort().join('|');
      const [a, b] = k.split('|');
      if (!edges.has(k)) edges.set(k, { a, b, shared: 0, rels: [] });
      edges.get(k).shared += 1;
      edges.get(k).rels.push(K.RELATION_LABEL[r.rel]);
    }
    return { topics, edges: [...edges.values()].filter((e) => e.rels.length || e.shared >= (list.length > 25 ? 2 : 1)), totals: tagGraph.totals };
  }

  function renderFilters() {
    const box = $('filters');
    box.hidden = mode !== 'entities';
    if (box.hidden) return;
    const search = el('input', { type: 'search', placeholder: 'Find a person, company, idea…', value: query });
    search.setAttribute('aria-label', 'Find an entity');
    search.addEventListener('input', () => {
      query = search.value;
      clearTimeout(search.timer);
      search.timer = setTimeout(() => draw(true), 200);
    });
    const counts = {};
    for (const e of kg.entities.values()) counts[e.type] = (counts[e.type] || 0) + 1;
    const chip = (type, label) => {
      const b = el('button', { type: 'button', className: type ? `type t-${type}` : '', textContent: label });
      b.setAttribute('aria-pressed', String(typeFilter === type));
      b.addEventListener('click', () => {
        typeFilter = type;
        draw();
      });
      return b;
    };
    box.replaceChildren(search, chip('', `All · ${kg.entities.size}`), ...K.TYPES.filter((t) => counts[t]).map((t) => chip(t, `${K.TYPE_PLURAL[t]} · ${counts[t]}`)));
  }

  function renderEntity(e) {
    const back = el('button', { type: 'button', className: 'btn small', textContent: '← All' });
    back.addEventListener('click', () => select(''));
    const near = K.neighbours(kg, e.key).slice(0, 12);
    const disputes = K.disagreements(kg, e.key);
    const facts = el('dl', { className: 'facts' }, [
      el('dt', { textContent: 'Snippets' }), el('dd', { textContent: String(e.noteIds.length) }),
      el('dt', { textContent: 'Claims' }), el('dd', { textContent: `${e.claimIds.length}${disputes.length ? ` (${plural(disputes.length, 'disagreement')})` : ''}` }),
      el('dt', { textContent: 'First read' }), el('dd', { textContent: dateOf(e.first) }),
      el('dt', { textContent: 'Last read' }), el('dd', { textContent: dateOf(e.last) }),
      ...(e.aliases.length ? [el('dt', { textContent: 'Also written' }), el('dd', { textContent: e.aliases.slice(0, 4).join(', ') })] : []),
    ]);
    const nodes = [back, el('h3', { textContent: e.name }), el('span', { className: `type t-${e.type}`, textContent: K.TYPE_LABEL[e.type] }), facts];
    if (near.length) {
      nodes.push(el('div', { className: 'label', textContent: 'Connected' }), el('div', { className: 'chips' }, near.map((n) => {
        const other = kg.entities.get(n.key);
        const b = el('button', { type: 'button', textContent: `${n.rels.length ? `${n.rels[0]} ` : ''}${other ? other.name : n.key}`, title: n.shared ? `${plural(n.shared, 'snippet')} in common` : '' });
        b.addEventListener('click', () => select(n.key));
        return b;
      })));
    }
    const recent = e.claimIds.map((id) => kg.claims.get(id)).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 3);
    if (recent.length) {
      nodes.push(el('div', { className: 'label', textContent: 'Latest claims' }), el('ul', { className: 'claims' }, recent.map((c) => el('li', {}, [
        document.createTextNode(c.text),
        el('small', { textContent: `${dateOf(c.at)} · ${K.hostOf((notesById.get(c.noteId) || {}).url) || 'your notes'}${c.contradicts.length ? ' · disputed' : ''}` }),
      ]))));
    }
    nodes.push(el('a', { className: 'btn primary open-topic', href: topicHref(e.key), textContent: 'Open the topic page →' }));
    $('detail').replaceChildren(...nodes);
  }

  function renderOverview() {
    if (mode === 'entities') return renderEntityOverview();
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

  function renderEntityOverview() {
    const list = K.rankEntities(kg, { type: typeFilter, query }).slice(0, 15);
    const max = Math.max(...list.map((e) => e.noteIds.length), 1);
    const rank = el('div', { className: 'rank' }, list.map((e) => {
      const bar = el('div', { className: 'bar' });
      bar.style.width = `${Math.max(3, (e.noteIds.length / max) * 100)}%`;
      bar.style.background = `var(--t-${e.type})`;
      const b = el('button', { type: 'button' }, [el('span', { className: 'name', textContent: e.name }), el('span', { className: 'val', textContent: `${plural(e.noteIds.length, 'snippet')}` }), el('div', { className: 'track' }, [bar])]);
      b.addEventListener('click', () => select(e.key));
      return b;
    }));
    const disputes = K.disagreements(kg).slice(0, 4);
    const nodes = [el('h2', { textContent: 'What you read about most' }), el('p', { className: 'sub', textContent: 'By snippets. Click one for what you know about it.' }), rank];
    if (disputes.length) {
      nodes.push(el('div', { className: 'label', textContent: 'Where your sources disagree' }), el('ul', { className: 'claims' }, disputes.map((d) => {
        const key = d.a.about[0];
        const ent = kg.entities.get(key);
        return el('li', {}, [
          el('a', { href: topicHref(key), textContent: ent ? ent.name : key }),
          el('small', { textContent: `${dateOf(d.b.at)}: ${d.b.text}` }),
          el('small', { textContent: `${dateOf(d.a.at)}: ${d.a.text}` }),
        ]);
      })));
    }
    $('detail').replaceChildren(...nodes);
  }

  function select(id) {
    selected = id;
    renderGraph();
    const t = graph.topics.find((x) => x.id === id);
    if (mode === 'entities' && kg.entities.has(id)) renderEntity(kg.entities.get(id));
    else if (t && mode === 'tags') renderTopic(t);
    else renderOverview();
  }

  // Draws the chosen view. `keepFilters`: while typing in the search box (so it keeps focus).
  function draw(keepFilters = false) {
    const entities = mode === 'entities';
    $('viewTitle').textContent = entities ? 'What you read about' : 'Your topics';
    $('viewSub').textContent = entities
      ? 'The people, companies, products, ideas, papers and places in your snippets. Bigger means more snippets and claims; darker lines are relations your sources state (made by, competes with…), lighter ones join things you read about together. Click one.'
      : 'Bigger means more weight: one point per snippet, plus one per 5 minutes you spent reading those pages. Lines join topics that share snippets. Click a topic.';
    $('legend').hidden = entities;
    document.querySelectorAll('.view-head .seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    if (!keepFilters) renderFilters();
    graph = entities ? entityGraph() : tagGraph;
    positions = fit(S.layoutGraph(graph.topics, graph.edges, { width: W, height: H }));
    if (!graph.topics.length) {
      $('graph').replaceChildren();
      $('detail').replaceChildren(el('p', { className: 'sub', textContent: entities ? (query || typeFilter ? 'Nothing matches.' : 'Nothing in the graph yet. It is built from your snippets while you are away from the computer, or now with "Build now" above.') : 'Your snippets have no topics yet.' }));
      return;
    }
    if (selected && !graph.topics.some((t) => t.id === selected) && !(entities && kg.entities.has(selected))) selected = '';
    select(selected);
  }
  document.querySelectorAll('.view-head .seg button').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    selected = '';
    draw();
  }));

  // The bar above: how much of the library is in the graph, and Build now / Stop.
  function renderBar(all) {
    const bar = $('kgBar');
    const notes = [...notesById.values()];
    const extractions = Object.fromEntries(Object.keys(all).filter((k) => k.startsWith('kgx:')).map((k) => [k.slice(4), all[k]]));
    const left = K.extractionQueue(notes, extractions).length;
    const state = all.kgState || {};
    const read = Object.keys(extractions).filter((id) => notesById.has(id)).length;
    const steps = { extract: 'reading snippets', compare: 'comparing claims', pages: 'writing topic pages' };
    const text = state.running
      ? `Building your knowledge graph: ${steps[state.step] || 'working'}${state.total ? ` (${state.done} of ${state.total})` : ''}…`
      : `${plural(read, 'snippet')} in your knowledge graph${left ? `, ${left} still to read` : ''}: ${plural(kg.entities.size, 'entity').replace('entitys', 'entities')}, ${plural(kg.claims.size, 'claim')}, ${plural(K.disagreements(kg).length, 'disagreement')}.${state.noCompare ? ' Finding claims that contradict each other needs a model of 7B or more, or a cloud AI.' : ''}${state.error ? ` Last run stopped: ${state.error}` : ''}`;
    const button = el('button', { type: 'button', className: `btn small${state.running ? '' : ' primary'}`, textContent: state.running ? 'Stop' : left ? 'Build now' : 'Update now' });
    button.addEventListener('click', () => ext.runtime.sendMessage({ type: state.running ? 'kg:stop' : 'kg:run' }).catch(() => {}));
    const note = el('small', { className: 'muted', textContent: all.settings && S.autoOn(all.settings, 'knowledgeGraph') ? 'Runs by itself while you are away.' : 'Automatic building is off (Settings → PKG).' });
    bar.replaceChildren(el('span', { className: 'grow', textContent: text }), note, button);
    bar.hidden = !notes.length;
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
    tagGraph = S.buildGraph(snippets, all.pkgDwell || {});
    graph = tagGraph;
    const pick = (prefix) => Object.fromEntries(Object.keys(all).filter((k) => k.startsWith(prefix)).map((k) => [k.slice(prefix.length), all[k]]));
    kg = K.buildKG({ notes: snippets, extractions: pick('kgx:'), comparisons: pick('kgcmp:'), edits: all.kgEdits });
    renderTiles();
    renderBar(all);
    if (!snippets.length) {
      $('layout').replaceChildren(el('div', { className: 'empty', textContent: 'Nothing in your PKG yet. Summarize or save a few pages; what they are about and how it connects appears here.' }));
      return;
    }
    if (firstLoad && !kg.entities.size) mode = 'tags';
    firstLoad = false;
    draw();
  }
  let firstLoad = true;

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
    if (area !== 'local' || !Object.keys(changes).some((k) => k.startsWith('snippet:') || k === 'pkgDwell' || /^kg/.test(k))) return;
    clearTimeout(timer);
    timer = setTimeout(load, 600);
  });
  load();
})();

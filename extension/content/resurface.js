// What you already know, while you browse (no AI; read from your knowledge graph in the background):
// - Hovercards: rest the pointer on a name you've read about (a person, company, product…) and a
//   small card says what your notes say about it, with a link to its topic page (`hovercards`).
// - "You've seen this before": when a page repeats a story you saved from another site, contradicts
//   something you read, or is about things you've read a lot about, a small note says so for a few
//   seconds (`resurface`). The panels show the same lines (S.resurface.lines()).
(function (root) {
  'use strict';

  const S = root.soroagent;
  const ext = S.ext;
  if (!ext || !ext.runtime || !ext.runtime.id || root.top !== root) return;

  const HOVER_MS = 450;
  const state = { settings: null, index: null, matcher: null, loading: null, result: null, url: '', shownFor: '', listeners: [] };
  const send = (msg) => ext.runtime.sendMessage(msg);
  const neverHere = () => Boolean(S.capture && S.capture.neverRead(location.href, { adult: S.capture.isAdultPage(document) }));
  const dateOf = (at) => (at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const TYPE = { person: 'Person', company: 'Company', product: 'Product', concept: 'Idea', paper: 'Paper', place: 'Place' };

  // ---------------------------------------------------------------------------
  // The layer: a closed shadow root of our own, so pages can't restyle or read it
  // ---------------------------------------------------------------------------

  let shadow = null;
  let hostEl = null;
  function layer() {
    if (shadow) return shadow;
    hostEl = document.createElement('soroagent-resurface');
    hostEl.style.cssText = 'all: initial; position: fixed; inset: 0 auto auto 0; width: 0; height: 0; z-index: 2147483646;';
    shadow = hostEl.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { --bg: #fff; --fg: #111613; --muted: #5f6763; --border: #e3e7e5; --accent: #047857; --soft: #ecfdf5; --warn: #b45309; --warn-soft: #fff7ed;
        --t-person: #d97706; --t-company: #2563eb; --t-product: #059669; --t-concept: #7c3aed; --t-paper: #475569; --t-place: #db2777; }
      @media (prefers-color-scheme: dark) { :host { --bg: #171a19; --fg: #eef2f0; --muted: #9aa39f; --border: #2c312e; --accent: #34d399; --soft: #11291f; --warn: #fbbf24; --warn-soft: #2a2213;
        --t-person: #fbbf24; --t-company: #60a5fa; --t-product: #34d399; --t-concept: #a78bfa; --t-paper: #94a3b8; --t-place: #f472b6; } }
      .card, .note { position: fixed; box-sizing: border-box; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,.16); font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: left; }
      .card { width: 300px; padding: 10px 12px; }
      .note { top: 16px; right: 16px; width: 330px; padding: 10px 12px 10px 12px; }
      .head { display: flex; align-items: baseline; gap: 8px; }
      .name { font-weight: 700; font-size: 14px; }
      .type { font-size: 11px; font-weight: 600; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
      .type::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--t, var(--accent)); }
      .stats { color: var(--muted); font-size: 12px; margin-top: 2px; }
      .line { margin-top: 6px; }
      .dispute { color: var(--warn); font-weight: 600; }
      .brand { font-size: 11px; font-weight: 700; color: var(--accent); letter-spacing: .02em; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }
      .row { margin-top: 4px; }
      button.link { all: unset; cursor: pointer; color: var(--accent); font-weight: 600; }
      button.link:hover { text-decoration: underline; }
      button.link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
      .actions { margin-top: 8px; display: flex; gap: 12px; }
      button.close { all: unset; cursor: pointer; color: var(--muted); font-size: 15px; line-height: 1; padding: 0 2px; }
      .warn { background: var(--warn-soft); border-radius: 6px; padding: 4px 6px; }
      @media (prefers-reduced-motion: no-preference) { .note { animation: in .18s ease-out; } @keyframes in { from { opacity: 0; transform: translateY(-4px); } } }
    `;
    shadow.append(style);
    (document.body || document.documentElement).append(hostEl);
    return shadow;
  }
  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  const link = (text, onClick) => {
    const b = el('button', { type: 'button', className: 'link', textContent: text });
    b.addEventListener('click', onClick);
    return b;
  };
  const openTopic = (key) => send({ type: 'open:topic', key }).catch(() => {});
  const openSnippet = (id) => send({ type: 'open:snippets', id }).catch(() => {});

  // ---------------------------------------------------------------------------
  // "You've seen this before"
  // ---------------------------------------------------------------------------

  /** Lines for the panels and the note: [{ text, warn?, open? }]. */
  function lines(result = state.result) {
    if (!result) return [];
    const out = [];
    if (result.sameStory) out.push({ text: `You already read this story on ${result.sameStory.host} (${dateOf(result.sameStory.at)}).`, open: () => openSnippet(result.sameStory.id), action: 'Open it' });
    for (const c of result.contradicts || []) out.push({ text: `This contradicts what you read on ${c.other.host} (${dateOf(c.other.at)}): “${c.other.text}”`, warn: true, open: c.other.key ? () => openTopic(c.other.key) : () => openSnippet(c.other.id), action: 'See both' });
    const known = (result.mentions || []).filter((m) => m.notes >= 2);
    if (known.length) out.push({ text: `You've read about ${known.slice(0, 3).map((m) => `${m.name} (${plural(m.notes, 'snippet')})`).join(', ')}.`, open: () => openTopic(known[0].key), action: 'Open topic' });
    if (result.saved) out.push({ text: `You saved this page${result.saved > 1 ? ` (${result.saved} snippets)` : ''}.` });
    return out;
  }

  // Worth interrupting for: the same story elsewhere, a contradiction, or a page about things you've
  // read a lot about (two entities with three or more snippets each). Once per page per visit.
  function worthNoting(result) {
    return Boolean(result.sameStory || (result.contradicts || []).length || (result.mentions || []).filter((m) => m.notes >= 3).length >= 2);
  }

  let noteTimer = 0;
  function showNote(result) {
    const sh = layer();
    sh.querySelectorAll('.note').forEach((n) => n.remove());
    const close = el('button', { type: 'button', className: 'close', textContent: '×', title: 'Close' });
    close.setAttribute('aria-label', 'Close');
    const box = el('div', { className: 'note', role: 'status' }, [el('div', { className: 'brand' }, [document.createTextNode('From your PKG'), close])]);
    for (const l of lines(result).filter((l) => l.open)) {
      box.append(el('div', { className: `row${l.warn ? ' warn' : ''}` }, [document.createTextNode(`${l.text} `), link(l.action, l.open)]));
    }
    const hide = () => box.remove();
    close.addEventListener('click', hide);
    const arm = () => {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(hide, 10000);
    };
    box.addEventListener('pointerenter', () => clearTimeout(noteTimer));
    box.addEventListener('pointerleave', arm);
    sh.append(box);
    arm();
  }

  async function checkPage() {
    if (state.url === location.href) return;
    state.url = location.href;
    state.result = null;
    if (neverHere() || !(state.settings.resurface !== false || state.settings.hovercards !== false)) return;
    try {
      const text = (document.body && document.body.innerText) || '';
      const res = await send({ type: 'kg:page-check', url: location.href, title: document.title, text: text.slice(0, 20000) });
      if (!res || res.ok === false || state.url !== location.href) return;
      state.result = res;
      state.listeners.forEach((fn) => fn());
      if (state.settings.resurface !== false && worthNoting(res) && state.shownFor !== location.href) {
        state.shownFor = location.href;
        showNote(res);
      }
    } catch {
      // the background is restarting; next page
    }
  }

  // ---------------------------------------------------------------------------
  // Hovercards
  // ---------------------------------------------------------------------------

  function loadIndex() {
    if (state.loading) return state.loading;
    state.loading = send({ type: 'kg:names' }).then((res) => {
      state.index = (res && res.index) || [];
      state.matcher = state.index.length ? S.kg.nameMatcher(state.index) : null;
    }).catch(() => {
      state.index = [];
    });
    return state.loading;
  }

  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      return p && { node: p.offsetNode, offset: p.offset };
    }
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      return r && { node: r.startContainer, offset: r.startOffset };
    }
    return null;
  }

  /** The entity name under the pointer: { entry, rect } or null. */
  function nameAt(x, y) {
    if (!state.matcher) return null;
    const at = caretAt(x, y);
    if (!at || !at.node || at.node.nodeType !== Node.TEXT_NODE) return null;
    const parent = at.node.parentElement;
    if (!parent || parent.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], soroagent-resurface, soroagent-assistant')) return null;
    const text = at.node.textContent;
    for (const m of state.matcher(text)) {
      if (at.offset < m.index || at.offset > m.index + m.length) continue;
      const range = document.createRange();
      range.setStart(at.node, m.index);
      range.setEnd(at.node, m.index + m.length);
      const rect = range.getBoundingClientRect();
      // The caret lands on the nearest character even beside the text: check the pointer is on it.
      if (x < rect.left - 2 || x > rect.right + 2 || y < rect.top - 2 || y > rect.bottom + 2) return null;
      return { entry: m.entry, rect };
    }
    return null;
  }

  let card = null;
  let cardKey = '';
  let hideTimer = 0;
  function hideCard() {
    clearTimeout(hideTimer);
    if (card) card.remove();
    card = null;
    cardKey = '';
  }
  function showCard({ entry, rect }) {
    if (cardKey === entry.key && card) return;
    hideCard();
    const sh = layer();
    const stats = [plural(entry.notes, 'snippet'), entry.claims ? plural(entry.claims, 'claim') : ''].filter(Boolean).join(' · ');
    card = el('div', { className: 'card', role: 'tooltip' }, [
      el('div', { className: 'brand', textContent: 'In your PKG' }),
      el('div', { className: 'head' }, [el('span', { className: 'name', textContent: entry.name }), el('span', { className: 'type', textContent: TYPE[entry.type] || '' })]),
      el('div', { className: 'stats' }, [document.createTextNode(`${stats}${entry.last ? ` · last ${dateOf(entry.last)}` : ''}`), ...(entry.disputes ? [document.createTextNode(' · '), el('span', { className: 'dispute', textContent: plural(entry.disputes, 'disagreement') })] : [])]),
      ...(entry.line ? [el('div', { className: 'line', textContent: entry.line })] : []),
      el('div', { className: 'actions' }, [link('Open topic page', () => openTopic(entry.key))]),
    ]);
    card.querySelector('.type').style.setProperty('--t', `var(--t-${entry.type})`);
    const left = Math.min(Math.max(8, rect.left), innerWidth - 308);
    const below = rect.bottom + 8;
    sh.append(card);
    const h = card.offsetHeight;
    card.style.left = `${left}px`;
    card.style.top = `${below + h > innerHeight - 8 ? Math.max(8, rect.top - h - 8) : below}px`;
    cardKey = entry.key;
    card.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    card.addEventListener('pointerleave', () => (hideTimer = setTimeout(hideCard, 250)));
  }

  let hoverTimer = 0;
  let last = { x: 0, y: 0 };
  function onMove(e) {
    if (e.buttons || state.settings.hovercards === false) return;
    if (hostEl && e.composedPath().includes(hostEl)) return;
    last = { x: e.clientX, y: e.clientY };
    clearTimeout(hoverTimer);
    if (card) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        const hit = nameAt(last.x, last.y);
        if (!hit || hit.entry.key !== cardKey) hideCard();
      }, 250);
    }
    hoverTimer = setTimeout(async () => {
      if (!state.index) await loadIndex();
      const hit = nameAt(last.x, last.y);
      if (hit) showCard(hit);
    }, HOVER_MS);
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  async function start() {
    state.settings = { ...S.DEFAULT_SETTINGS, ...(await S.getSettings()) };
    if (neverHere()) return;
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('scroll', hideCard, { passive: true, capture: true });
    document.addEventListener('keydown', (e) => e.key === 'Escape' && hideCard());
    setTimeout(checkPage, 2500);
    // Single-page sites change the address without loading a page.
    setInterval(() => location.href !== state.url && state.url && checkPage(), 2000);
    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.settings) state.settings = { ...S.DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
      // The graph changed: names are read again on the next hover.
      if (Object.keys(changes).some((k) => k.startsWith('kgx:') || k.startsWith('kgpage:') || k === 'kgEdits')) {
        state.index = null;
        state.loading = null;
      }
    });
  }
  if (S.kg) start().catch(() => {});

  S.resurface = {
    lines,
    hide: () => {
      hideCard();
      if (shadow) shadow.querySelectorAll('.note').forEach((n) => n.remove());
    },
    result: () => state.result,
    onResult: (fn) => state.listeners.push(fn),
  };
})(globalThis);

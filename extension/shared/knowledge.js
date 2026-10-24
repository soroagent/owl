// Your saved notes as knowledge: find the notes related to a page or a question (locally, no
// model needed), and present them to the model as numbered sources it must cite. Pure functions,
// unit tested; used by the panel (related notes) and library search.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  // Notes worth searching: everything except screenshots (pictures, no text).
  const SEARCHABLE = new Set(['summary', 'research', 'selection', 'page', 'deliverable', 'read']);
  const kindOf = (s) => s.kind || (s.source === 'selection' ? 'selection' : s.source === 'summary' ? 'summary' : 'page');

  const STOP = new Set(('a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself '
    + 'one two three new also may like get got use used using said says say make made many much way well even still back time year years day days week weeks month months today yesterday per via etc inc com www http https html amp nbsp '
    + 'tldr key points summary worth noting page post posts thread comments article source sources')
    .split(/\s+/));

  /** Pure: lowercase word stems, without stop words and very short words. */
  function tokenize(text) {
    // Hyphens and dots split words ("multi-agent" → multi, agent); + and # stay (c++, c#).
    const words = String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9][a-z0-9+#]*/g) || [];
    const out = [];
    for (let w of words) {
      if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
      // Light stemming so "agents"/"agent" and "learning"/"learned" meet.
      w = w.replace(/(ies)$/, 'y').replace(/(?<=[a-z]{3})(ing|ed|es|s)$/, '');
      if (w.length >= 3 && !STOP.has(w)) out.push(w);
    }
    return out;
  }

  // The text a note is searched by: its title and tags count most.
  function noteText(s) {
    const tags = (s.tags || []).join(' ');
    const research = s.research && s.research.text ? String(s.research.text).slice(0, 1500) : '';
    return [s.title, s.title, s.title, tags, tags, s.summary, s.summary, String(s.text || '').slice(0, 4000), research].join(' ');
  }

  /** Pure: a search index over notes: { docs: [{ note, tf, len }], df, avgLen }. */
  function buildIndex(notes) {
    const docs = [];
    const df = new Map();
    for (const note of notes || []) {
      if (!note || !SEARCHABLE.has(kindOf(note))) continue;
      const terms = tokenize(noteText(note));
      if (!terms.length) continue;
      const tf = new Map();
      for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
      docs.push({ note, tf, len: terms.length });
    }
    const avgLen = docs.reduce((n, d) => n + d.len, 0) / (docs.length || 1);
    return { docs, df, avgLen };
  }

  // The most telling words of a text (a page, a question), weighted by how often they appear.
  function queryTerms(text, max = 40) {
    const counts = new Map();
    for (const t of tokenize(text)) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
  }

  /**
   * Pure: notes ranked by relevance to `text` (BM25). Options: limit, since (ISO date or ms),
   * excludeUrl (the page you're on), minMatches (distinct shared words required).
   * Returns [{ note, score, matches: [words] }].
   */
  function searchNotes(index, text, { limit = 8, since = 0, excludeUrl = '', minMatches = 1 } = {}) {
    const query = queryTerms(text);
    if (!query.length || !index.docs.length) return [];
    const N = index.docs.length;
    const sinceMs = since ? new Date(since).getTime() : 0;
    const exclude = excludeUrl && soroagent.pageKey ? soroagent.pageKey(excludeUrl) : '';
    const k1 = 1.2;
    const b = 0.75;
    const results = [];
    for (const doc of index.docs) {
      const n = doc.note;
      if (sinceMs && new Date(n.createdAt).getTime() < sinceMs) continue;
      if (exclude && n.url && soroagent.pageKey(n.url) === exclude) continue;
      let score = 0;
      const matches = [];
      for (const [term, qtf] of query) {
        const f = doc.tf.get(term);
        if (!f) continue;
        const df = index.df.get(term) || 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.len) / index.avgLen))) * Math.min(3, qtf);
        matches.push(term);
      }
      if (matches.length >= minMatches && score > 0) results.push({ note: n, score, matches });
    }
    return results.sort((x, y) => y.score - x.score).slice(0, limit);
  }

  /**
   * Pure: notes that are clearly about the same thing as a page: several distinctive shared
   * words, and a score well above the noise. At most `limit`.
   */
  function relatedNotes(index, pageText, { excludeUrl = '', limit = 3 } = {}) {
    const hits = searchNotes(index, pageText, { limit: 10, excludeUrl, minMatches: 2 });
    if (!hits.length) return [];
    // The best match must share several distinctive words; others need a fair share of its score.
    const best = hits[0];
    if (best.matches.length < 3 || best.score < 4) return [];
    return hits.filter((h) => h.score >= Math.max(1.5, best.score * 0.12)).slice(0, limit);
  }

  const dateOf = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  };
  const hostOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };

  /**
   * Pure: notes as a numbered block for a prompt: [S1] Title (saved 2026-10-20, site, kind) then
   * the note's text, each capped so many notes fit in the model's context.
   */
  function formatNotes(notes, { prefix = 'S', perNote = 1800, total = 16000 } = {}) {
    const blocks = [];
    let used = 0;
    notes.forEach((n, i) => {
      if (used >= total) return;
      const kind = kindOf(n);
      const label = kind === 'read' ? `read for ${Math.max(1, Math.round((n.readSeconds || 60) / 60))} min` : kind === 'page' ? 'saved page' : kind;
      const body = soroagent.stripThinking ? soroagent.stripThinking(n.text || '') : String(n.text || '');
      const research = n.research && n.research.text ? `\nResearch on it: ${String(n.research.text).slice(0, 600)}` : '';
      const text = `${n.summary ? `${n.summary}\n` : ''}${body}${research}`.replace(/\n{3,}/g, '\n\n').trim().slice(0, Math.min(perNote, total - used));
      used += text.length;
      blocks.push(`[${prefix}${i + 1}] ${n.title || n.pageTitle || 'Untitled'} (saved ${dateOf(n.createdAt)}, ${hostOf(n.url) || 'no site'}, ${label})\n${text}`);
    });
    return blocks.join('\n\n');
  }

  /**
   * Pure: a long text cut to `limit` characters so that it still represents the whole document,
   * instead of only its beginning. Paragraphs (blank-line separated blocks) are kept by priority:
   * headings, the first and last paragraphs, the first then the last paragraph of each section,
   * then the paragraphs that best match the document's own main terms (BM25 against its headings,
   * title and most frequent words). Kept paragraphs stay in reading order; "[…]" marks each gap.
   * Very long paragraphs are shortened at a sentence. Returns { text, condensed }.
   */
  function condenseText(text, limit, { title = '', maxBlock = 700 } = {}) {
    const source = String(text || '');
    if (source.length <= limit) return { text: source, condensed: false };
    const blocks = source.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);
    const heading = (t) => /^#{1,6}\s/.test(t);
    const shorten = (t, max) => {
      if (t.length <= max) return t;
      const cut = t.slice(0, max);
      const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '), cut.lastIndexOf('\n'));
      return `${end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')} …`;
    };
    const order = [];
    const add = (i) => i >= 0 && i < blocks.length && !order.includes(i) && order.push(i);
    // 1. Structure: headings, the opening and the ending.
    blocks.forEach((b, i) => heading(b) && add(i));
    add(blocks.findIndex((b) => !heading(b)));
    for (let i = blocks.length - 1; i >= 0; i--) if (!heading(blocks[i])) { add(i); break; }
    // 2. Each section's first paragraph, then each section's last.
    const sections = [];
    let current = [];
    blocks.forEach((b, i) => {
      if (heading(b)) {
        if (current.length) sections.push(current);
        current = [];
      } else current.push(i);
    });
    if (current.length) sections.push(current);
    sections.forEach((s) => add(s[0]));
    sections.forEach((s) => add(s[s.length - 1]));
    // 3. The rest by relevance to the document's main terms.
    const counts = new Map();
    for (const t of tokenize(source)) counts.set(t, (counts.get(t) || 0) + 1);
    const main = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([t]) => t);
    const query = [title, title, ...blocks.filter(heading), main.join(' ')].join(' ');
    const notes = blocks.map((b, i) => ({ id: i, title: '', summary: '', text: b, kind: 'page' }));
    const scored = searchNotes(buildIndex(notes), query, { limit: blocks.length }).map((h) => h.note.id);
    scored.forEach(add);
    blocks.forEach((b, i) => add(i));
    // Fill the budget in priority order; then print in reading order with gap marks.
    const kept = new Map();
    let used = 0;
    for (const i of order) {
      const piece = heading(blocks[i]) ? shorten(blocks[i], 160) : shorten(blocks[i], maxBlock);
      const cost = piece.length + 6; // the paragraph break and a possible "[…]"
      if (used + cost > limit) continue;
      kept.set(i, piece);
      used += cost;
    }
    const out = [];
    let last = -1;
    for (const i of [...kept.keys()].sort((a, b) => a - b)) {
      if (i !== last + 1) out.push('[…]');
      out.push(kept.get(i));
      last = i;
    }
    if (last !== blocks.length - 1) out.push('[…]');
    return { text: out.join('\n\n').slice(0, limit), condensed: true };
  }

  /**
   * Pure: headline-like links from a page's anchors ([{ href, text }]): absolute http(s), 20–160
   * characters of text, no account/legal links, no duplicates, the page's own site first.
   */
  function pickLinks(anchors, baseUrl, { max = 40 } = {}) {
    let base;
    try {
      base = new URL(baseUrl);
    } catch {
      return [];
    }
    const site = (host) => host.replace(/^www\./, '').split('.').slice(-2).join('.');
    const seen = new Set();
    const same = [];
    const other = [];
    for (const a of anchors || []) {
      let url;
      try {
        url = new URL(String(a.href || ''), base);
      } catch {
        continue;
      }
      if (!/^https?:$/.test(url.protocol)) continue;
      const text = String(a.text || '').replace(/\s+/g, ' ').trim();
      if (text.length < 20 || text.length > 160 || /\b(sign ?in|log ?in|sign ?up|register|subscribe|cookie|privacy|terms of)\b/i.test(text)) continue;
      const key = url.href.replace(/#.*$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      (site(url.hostname) === site(base.hostname) ? same : other).push({ text, url: key });
    }
    return [...same, ...other].slice(0, max);
  }

  Object.assign(soroagent, { pickLinks, condenseText, SEARCHABLE_KINDS: SEARCHABLE, tokenize, buildIndex, searchNotes, relatedNotes, formatNotes });
})(globalThis);

// Using the knowledge graph (shared/kg.js): asking your PKG with filters and citations to the exact
// passage, the weekly "what you learned", on this day, gaps in your reading, spaced repetition of
// highlights and claims, and outputs built from the graph (brief, study guide, timeline, comparison,
// flashcards). Pure and unit tested; background.js and the PKG and topic pages use it.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});
  const DAY = 86400000;
  const K = () => soroagent.kg;

  // ---------------------------------------------------------------------------
  // Asking your PKG
  // ---------------------------------------------------------------------------

  const PERIODS = [
    { re: /\b(today)\b/i, days: 1, label: 'today' },
    { re: /\b(yesterday)\b/i, days: 2, label: 'since yesterday' },
    { re: /\b(this|last|past) week\b/i, days: 7, label: 'in the last week' },
    { re: /\b(this|last|past) month\b/i, days: 31, label: 'in the last month' },
    { re: /\b(?:last|past) (\d{1,2}) (day|week|month)s?\b/i, days: 0, label: '' },
    { re: /\b(this|last|past) year\b/i, days: 366, label: 'in the last year' },
  ];

  /**
   * Pure: a time limit written in the question ("what did I read about RAG last month?"):
   * { since (ms, 0 for none), label }. An explicit `days` filter wins.
   */
  function parseTimeFilter(question, { now = Date.now(), days = 0 } = {}) {
    if (days) return { since: now - days * DAY, label: days === 7 ? 'in the last week' : days === 31 ? 'in the last month' : days === 366 ? 'in the last year' : `in the last ${days} days` };
    for (const p of PERIODS) {
      const m = String(question || '').match(p.re);
      if (!m) continue;
      if (!p.days) {
        const n = Number(m[1]);
        const per = { day: 1, week: 7, month: 31 }[m[2].toLowerCase()];
        return { since: now - n * per * DAY, label: `in the last ${n} ${m[2].toLowerCase()}${n === 1 ? '' : 's'}` };
      }
      return { since: now - p.days * DAY, label: p.label };
    }
    return { since: 0, label: '' };
  }

  /** Pure: the question without its time words, for searching ("what did I read last week" → "what did I read"). */
  function withoutTime(question) {
    let q = String(question || '');
    for (const p of PERIODS) q = q.replace(new RegExp(p.re.source, 'gi'), ' ');
    return q.replace(/\s+/g, ' ').trim();
  }

  /** Pure: whether a snippet passes the Ask filters ({ since, site, kind }). */
  function passes(note, { since = 0, site = '', kind = '' } = {}) {
    if (!note) return false;
    if (since && Date.parse(note.createdAt) < since) return false;
    if (site && K().hostOf(note.url) !== site) return false;
    if (kind && (note.kind || 'summary') !== kind) return false;
    return true;
  }

  /**
   * Pure: what the AI is given to answer a question from the PKG: the claims of the matching snippets
   * and of the entities the question names, then one hop further along typed relations; then the
   * snippets themselves for anything without claims. Each source is numbered [n]:
   * { content, cites: [claimId | "note:<id>"], entities: [key] }.
   * hits: the snippets library search found (best first), already filtered.
   */
  function askContext({ kg, notesById, hits = [], question = '', filters = {}, maxClaims = 24, maxNotes = 6 }) {
    const k = K();
    const q = String(question).toLowerCase();
    // Entities named in the question (any spelling), then those in the best snippets.
    const named = k.rankEntities(kg).filter((e) => [e.name, ...e.aliases].some((n) => n.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(q)));
    const keys = new Set(named.map((e) => e.key));
    const hitIds = new Set(hits.map((n) => n.id));
    for (const e of kg.entities.values()) if (e.noteIds.some((id) => hitIds.has(id)) && keys.size < 8) keys.add(e.key);
    // One hop along stated relations from what the question names.
    for (const r of kg.relations) {
      if (named.some((e) => e.key === r.a) && !keys.has(r.b)) keys.add(r.b);
      if (named.some((e) => e.key === r.b) && !keys.has(r.a)) keys.add(r.a);
    }
    const ok = (c) => passes(notesById.get(c.noteId), filters);
    const score = (c) => (hitIds.has(c.noteId) ? 3 : 0) + c.about.filter((a) => named.some((e) => e.key === a)).length * 2 + c.about.filter((a) => keys.has(a)).length + (c.contradicts.length ? 1 : 0);
    const claims = [...kg.claims.values()]
      .filter((c) => ok(c) && (hitIds.has(c.noteId) || c.about.some((a) => keys.has(a))))
      .sort((a, b) => score(b) - score(a) || String(b.at).localeCompare(String(a.at)))
      .slice(0, maxClaims)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const cites = claims.map((c) => c.id);
    const lines = claims.map((c, i) => {
      const note = notesById.get(c.noteId) || {};
      const against = c.contradicts.map((id) => cites.indexOf(id) + 1).filter((n) => n > 0);
      return `[${i + 1}] ${k.day(c.at)}, ${k.hostOf(note.url) || 'your notes'}: ${c.text}${against.length ? ` (contradicts [${against.join('], [')}])` : ''}`;
    });
    const withClaims = new Set(claims.map((c) => c.noteId));
    for (const n of hits.filter((h) => !withClaims.has(h.id)).slice(0, maxNotes)) {
      cites.push(`note:${n.id}`);
      lines.push(`[${cites.length}] ${k.day(n.createdAt)}, ${k.hostOf(n.url) || 'your notes'}: ${n.title || n.pageTitle || ''}. ${String(n.summary || n.text || '').replace(/\s+/g, ' ').slice(0, 400)}`);
    }
    return { content: lines.join('\n'), cites, entities: [...keys] };
  }

  // ---------------------------------------------------------------------------
  // Review and digest
  // ---------------------------------------------------------------------------

  /**
   * Pure: snippets saved on this day a month, three months, six months and a year ago (a day either
   * side): [{ label, notes }], only the periods that have some.
   */
  function onThisDay(notes, now = Date.now()) {
    const back = [{ months: 1, label: 'A month ago' }, { months: 3, label: 'Three months ago' }, { months: 6, label: 'Six months ago' }, { months: 12, label: 'A year ago' }];
    return back.map(({ months, label }) => {
      const d = new Date(now);
      d.setMonth(d.getMonth() - months);
      const at = d.getTime();
      return { label, notes: (notes || []).filter((n) => Math.abs(Date.parse(n.createdAt) - at) <= DAY).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) };
    }).filter((g) => g.notes.length);
  }

  /**
   * Pure: gaps in your reading: entities you've read a lot about where no claim is critical (every
   * one favourable or neutral), and entities everything about came from one site.
   * [{ key, name, kind: 'one-sided' | 'one-source', text }]
   */
  function gaps(kg, notesById = new Map(), { min = 5 } = {}) {
    const out = [];
    for (const e of K().rankEntities(kg, { min })) {
      const claims = e.claimIds.map((id) => kg.claims.get(id)).filter(Boolean);
      if (claims.length >= 3 && !claims.some((c) => c.stance === 'against')) out.push({ key: e.key, name: e.name, kind: 'one-sided', text: `${e.noteIds.length} snippets on ${e.name}, none critical of it.` });
      const hosts = new Set(e.noteIds.map((id) => K().hostOf((notesById.get(id) || {}).url)).filter(Boolean));
      if (hosts.size === 1 && notesById.size) out.push({ key: e.key, name: e.name, kind: 'one-source', text: `All ${e.noteIds.length} snippets on ${e.name} come from ${[...hosts][0]}.` });
    }
    return out;
  }

  /**
   * Pure: the weekly prompt's input: the claims (and snippets without claims) saved between `from`
   * and `to`, numbered, grouped by the entity they're about: { content, cites, count } or null.
   */
  function weeklyInput(kg, notes, { from, to = Date.now(), max = 40 } = {}) {
    const k = K();
    const inWeek = (notes || []).filter((n) => {
      const t = Date.parse(n.createdAt);
      return t >= from && t < to;
    });
    if (!inWeek.length) return null;
    const ids = new Set(inWeek.map((n) => n.id));
    const byId = new Map(inWeek.map((n) => [n.id, n]));
    const claims = [...kg.claims.values()].filter((c) => ids.has(c.noteId)).sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, max);
    const cites = [];
    const lines = [];
    for (const c of claims) {
      cites.push(c.id);
      const about = c.about.map((a) => (kg.entities.get(a) || {}).name).filter(Boolean).join(', ');
      lines.push(`[${cites.length}] ${k.day(c.at)}, ${k.hostOf(byId.get(c.noteId).url)}${about ? ` (about ${about})` : ''}: ${c.text}`);
    }
    const covered = new Set(claims.map((c) => c.noteId));
    for (const n of inWeek.filter((x) => !covered.has(x.id)).slice(0, Math.max(0, max - claims.length))) {
      cites.push(`note:${n.id}`);
      lines.push(`[${cites.length}] ${k.day(n.createdAt)}, ${k.hostOf(n.url)}: ${n.title || n.pageTitle || ''}. ${String(n.summary || '').replace(/\s+/g, ' ').slice(0, 240)}`);
    }
    return { content: lines.join('\n'), cites, count: inWeek.length };
  }

  // ---------------------------------------------------------------------------
  // Spaced repetition (optional): your highlights and the claims about what you read most
  // ---------------------------------------------------------------------------

  /**
   * Pure: what can be reviewed: highlights (selection snippets) and claims about entities with 2+
   * snippets. [{ id, front, back, noteId, quote }]
   */
  function reviewItems(kg, notes) {
    const items = [];
    for (const n of notes || []) {
      if (n.kind === 'selection' && String(n.text || '').length >= 40) items.push({ id: `note:${n.id}`, front: n.title || n.pageTitle || 'Your highlight', back: String(n.text).slice(0, 600), noteId: n.id });
    }
    for (const c of kg.claims.values()) {
      const main = c.about.map((k) => kg.entities.get(k)).filter(Boolean).sort((a, b) => b.noteIds.length - a.noteIds.length)[0];
      if (!main || main.noteIds.length < 2) continue;
      items.push({ id: c.id, front: `What did you read about ${main.name}?`, back: c.text, noteId: c.noteId, quote: c.quote });
    }
    return items;
  }

  /**
   * Pure: the next state of a card after an answer (a small SM-2): grade 0 = forgot, 1 = remembered,
   * 2 = easy. state: { interval (days), ease, reps, due (ms) }.
   */
  function nextReview(state = {}, grade = 1, now = Date.now()) {
    let { interval = 0, ease = 2.5, reps = 0 } = state;
    if (grade === 0) {
      reps = 0;
      interval = 1;
      ease = Math.max(1.3, ease - 0.2);
    } else {
      reps += 1;
      interval = reps === 1 ? (grade === 2 ? 3 : 1) : reps === 2 ? (grade === 2 ? 7 : 3) : Math.round(interval * ease * (grade === 2 ? 1.3 : 1));
      if (grade === 2) ease += 0.15;
    }
    return { interval, ease: Math.round(ease * 100) / 100, reps, due: now + interval * DAY, first: state.first || now };
  }

  /**
   * Pure: up to `max` cards due now: due ones first, then new ones (newest snippets first), at most
   * `newPerDay` new cards a day.
   */
  function dueCards(items, states = {}, { now = Date.now(), max = 5, newPerDay = 5 } = {}) {
    const due = items.filter((i) => states[i.id] && states[i.id].due <= now).sort((a, b) => states[a.id].due - states[b.id].due);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const startedToday = Object.values(states).filter((s) => s && s.first >= today.getTime()).length;
    const fresh = items.filter((i) => !states[i.id]).slice(-Math.max(0, newPerDay - startedToday)).reverse();
    if (newPerDay - startedToday <= 0) fresh.length = 0;
    return [...due, ...fresh].slice(0, max);
  }

  // ---------------------------------------------------------------------------
  // Outputs built from the graph
  // ---------------------------------------------------------------------------

  const OUTPUTS = {
    brief: { label: 'Brief', prompt: 'outBrief' },
    study: { label: 'Study guide', prompt: 'outStudy' },
    timeline: { label: 'Timeline', prompt: 'outTimeline' },
    compare: { label: 'Comparison table', prompt: 'outCompare' },
    cards: { label: 'Flashcards (Anki)', prompt: 'outCards' },
  };

  /**
   * Pure: the claims about the given entities (oldest first, numbered) for an output, with the
   * entities' names: { question, content, cites } or null.
   */
  function outputInput(kg, keys, notesById, { max = 40 } = {}) {
    const k = K();
    const ents = keys.map((key) => kg.entities.get(key)).filter(Boolean);
    if (!ents.length) return null;
    const ids = new Set(ents.flatMap((e) => e.claimIds));
    const claims = [...ids].map((id) => kg.claims.get(id)).filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-max);
    const cites = claims.map((c) => c.id);
    const lines = claims.map((c, i) => {
      const note = notesById.get(c.noteId) || {};
      const about = c.about.map((a) => (kg.entities.get(a) || {}).name).filter(Boolean).join(', ');
      const against = c.contradicts.map((id) => cites.indexOf(id) + 1).filter((n) => n > 0);
      return `[${i + 1}] ${k.day(c.at)}, ${k.hostOf(note.url) || 'your notes'}${about ? ` (about ${about})` : ''}: ${c.text}${against.length ? ` (contradicts [${against.join('], [')}])` : ''}`;
    });
    // An entity with few claims of its own: its snippets' summaries too.
    for (const e of ents.filter((x) => x.claimIds.length < 3)) {
      for (const id of e.noteIds.slice(-6)) {
        const n = notesById.get(id);
        if (!n || cites.includes(`note:${id}`)) continue;
        cites.push(`note:${id}`);
        lines.push(`[${cites.length}] ${k.day(n.createdAt)}, ${k.hostOf(n.url) || 'your notes'} (about ${e.name}): ${n.title || n.pageTitle || ''}. ${String(n.summary || '').replace(/\s+/g, ' ').slice(0, 300)}`);
      }
    }
    if (!lines.length) return null;
    return { question: ents.map((e) => `${e.name} (${k.TYPE_LABEL[e.type]})`).join(' and '), content: lines.join('\n'), cites };
  }

  /** Pure: flashcards from the outCards reply: [{ front, back, cite }] (cite = source number or 0). */
  function parseCards(reply) {
    const json = (soroagent.parseJsonLoose && soroagent.parseJsonLoose(reply)) || {};
    return (Array.isArray(json.cards) ? json.cards : [])
      .map((c) => ({ front: String((c && (c.front || c.q)) || '').trim().slice(0, 300), back: String((c && (c.back || c.a)) || '').trim().slice(0, 600), cite: Number(String((c && c.source) || (c && c.cite) || '').replace(/\D/g, '')) || 0 }))
      .filter((c) => c.front && c.back)
      .slice(0, 30);
  }

  /** Pure: flashcards as tab-separated text for Anki's File → Import (front, back, source). */
  function cardsToTsv(cards, sourceOf = () => '') {
    const cell = (s) => String(s || '').replace(/[\t\r\n]+/g, ' ').trim();
    return `#separator:tab\n#html:false\n${cards.map((c) => [cell(c.front), cell(c.back), cell(sourceOf(c))].join('\t')).join('\n')}\n`;
  }

  /**
   * Pure: what each [n] points to, for showing the sources under an answer:
   * [{ n, kind: 'claim' | 'note', text, quote, noteId, title, url, host, at, passage, contradicted }].
   * `passage` links to the sentence on the source page (text fragment) when the snippet is the
   * page's own text.
   */
  function resolveCites(cites, kg, notesById) {
    const k = K();
    const PAGE_TEXT = new Set(['page', 'selection', 'read']);
    return (cites || []).map((id, i) => {
      const noteId = id.startsWith('note:') ? id.slice(5) : (kg.claims.get(id) || {}).noteId;
      const note = notesById.get(noteId) || {};
      const base = { n: i + 1, noteId, title: note.title || note.pageTitle || '', url: note.url || '', host: k.hostOf(note.url), at: note.createdAt || '' };
      if (id.startsWith('note:')) return { ...base, kind: 'note', text: note.summary || '', quote: '', passage: '' };
      const c = kg.claims.get(id);
      if (!c) return { ...base, kind: 'note', text: '', quote: '', passage: '' };
      return { ...base, kind: 'claim', text: c.text, quote: c.quote, passage: PAGE_TEXT.has(note.kind) ? k.passageUrl(note.url, c.quote) : '', contradicted: c.contradicts.length > 0 };
    });
  }

  soroagent.kguse = { PERIODS, OUTPUTS, resolveCites, withoutTime, parseTimeFilter, passes, askContext, onThisDay, gaps, weeklyInput, reviewItems, nextReview, dueCards, outputInput, parseCards, cardsToTsv };
})(globalThis);

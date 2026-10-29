// The knowledge graph: entities (people, companies, products, concepts, papers, places) found in
// the user's snippets, typed relations between them, and claims, each tied to the exact passage it
// came from, with supports/contradicts links between claims. Pure and unit tested.
//
// What's stored (storage.local):
//   kgx:<noteId>    what the AI extracted from one snippet: { v, at, hash, entities, relations, claims }
//   kgcmp:<noteId>  how that snippet's claims relate to older ones: { at, pairs: [{ a, b, rel }] }
//   kgpage:<key>    an entity's living topic page: { at, basis, text, cites: [claimId] }
//   kgEdits         the user's corrections: { merges, names, types, splits, hidden }
// The graph itself is never stored: buildKG() makes it from those, so a correction never loses
// anything and can be undone.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  const VERSION = 1; // bump to extract every snippet again (a better prompt)
  const TYPES = ['person', 'company', 'product', 'concept', 'paper', 'place'];
  const TYPE_LABEL = { person: 'Person', company: 'Company', product: 'Product', concept: 'Concept', paper: 'Paper', place: 'Place' };
  const TYPE_PLURAL = { person: 'People', company: 'Companies', product: 'Products', concept: 'Ideas', paper: 'Papers', place: 'Places' };
  const RELATIONS = ['authored-by', 'competes-with', 'part-of', 'cites', 'works-for', 'made-by'];
  const RELATION_LABEL = { 'authored-by': 'written by', 'competes-with': 'competes with', 'part-of': 'part of', cites: 'cites', 'works-for': 'works for', 'made-by': 'made by' };
  const STANCES = ['for', 'against', 'neutral'];
  // Which way round each relation goes (from-types → to-types). One stated the wrong way round is
  // turned around ("Helix AI works for Tomás Ortega"); one between the wrong kinds of thing is dropped.
  const SHAPES = {
    'authored-by': [['paper', 'product', 'concept'], ['person', 'company']],
    'works-for': [['person'], ['company']],
    'made-by': [['product', 'paper', 'concept'], ['company', 'person']],
    cites: [['paper'], ['paper']],
    'competes-with': [['company', 'product', 'person'], ['company', 'product', 'person']],
    'part-of': [['company', 'product', 'concept', 'place', 'person'], ['company', 'product', 'concept', 'place']],
  };

  /** Pure: the relation as stated, turned around, or null when its types don't fit. */
  function orientRelation(from, rel, to) {
    const [a, b] = SHAPES[rel] || [[], []];
    if (rel === 'competes-with') return from.type === to.type || (from.type !== 'person' && to.type !== 'person') ? [from, to] : null;
    if (rel === 'part-of') return from.type === to.type || (from.type === 'person' && to.type === 'company') || (from.type === 'place' && to.type === 'place') ? [from, to] : null;
    if (a.includes(from.type) && b.includes(to.type)) return [from, to];
    if (a.includes(to.type) && b.includes(from.type)) return [to, from];
    return null;
  }
  const LIMITS = { entities: 12, relations: 8, claims: 6 };
  const EMPTY_EDITS = Object.freeze({ merges: {}, names: {}, types: {}, splits: {}, hidden: {} });

  // ---------------------------------------------------------------------------
  // Names
  // ---------------------------------------------------------------------------

  const SUFFIXES = /\s*,?\s+(inc|incorporated|ltd|limited|llc|plc|corp|corporation|co|gmbh|ag|sa)\.?$/i;
  const DOMAIN = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.(?:com|ai|io|org|net|co|dev|app|so|xyz|tech|gov|edu)(?:\.[a-z]{2})?\/?$/i;

  /** Pure: the key that names one entity: "OpenAI", "Open AI", "openai.com" and "OpenAI, Inc." → "openai". */
  function entityKey(name) {
    let s = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
    const domain = s.match(DOMAIN);
    if (domain) s = domain[1];
    s = s.replace(/^the\s+/i, '').replace(SUFFIXES, '').replace(/['’]s$/i, '');
    return s.toLowerCase().replace(/[^a-z0-9+#]/g, '').slice(0, 60);
  }

  // UTF-8 read as Latin-1 by some models ("TomÃ¡s" for "Tomás"): repaired.
  const unmangle = (s) => {
    if (!/[ÃÂ][\u0080-\u00bf]/.test(s)) return s;
    try {
      return decodeURIComponent(escape(s));
    } catch {
      return s;
    }
  };
  const cleanName = (name) => unmangle(String(name || '')).replace(/\s+/g, ' ').replace(/^["'“‘]+|["'”’.,;:]+$/g, '').trim().slice(0, 80);

  // ---------------------------------------------------------------------------
  // Reading the AI's extraction
  // ---------------------------------------------------------------------------

  const fold = (text) => String(text || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').toLowerCase();

  /**
   * Pure: where `quote` is in `text` ({ start, quote } with the text's own wording), or null. Small
   * differences in spaces, quote marks and dashes are allowed; a quote the text doesn't contain is
   * not (the AI made it up).
   */
  function findPassage(text, quote) {
    const q = fold(quote).replace(/^["'\s]+|["'\s.]+$/g, '');
    if (q.length < 12) return null;
    // Map each folded character back to its place in the original text.
    const map = [];
    let folded = '';
    const src = String(text || '');
    for (let i = 0; i < src.length; i++) {
      const piece = fold(src[i]);
      if (piece === ' ' && folded.endsWith(' ')) continue;
      folded += piece;
      for (let j = 0; j < piece.length; j++) map.push(i);
    }
    const at = folded.indexOf(q);
    if (at < 0) return null;
    const start = map[at];
    const end = map[at + q.length - 1] + 1;
    return { start, quote: src.slice(start, end) };
  }

  /**
   * Pure: the AI's reply to the extract prompt, checked against the snippet's text:
   * { entities: [{ name, type }], relations: [{ from, rel, to }], claims: [{ text, quote, start, about, stance }] }.
   * Unknown types become "concept", unknown relations and claims whose quote isn't in the text are
   * dropped, and relations and claims only name entities that were extracted.
   */
  function parseExtraction(reply, text) {
    const json = (soroagent.parseJsonLoose && soroagent.parseJsonLoose(reply)) || {};
    const entities = [];
    const byKey = new Map();
    const body = fold(text);
    const DATE = /^(\d|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|(mon|tues|wednes|thurs|fri|satur|sun)day\b|q[1-4]\b|today|yesterday)/i;
    // Named in the text (in full, or its longest word): small models add names from their own knowledge.
    const inText = (name) => body.includes(fold(name)) || body.includes(fold(name.split(' ').sort((a, b) => b.length - a.length)[0]).replace(/[^a-z0-9]+$/, ''));
    for (const e of Array.isArray(json.entities) ? json.entities : []) {
      const name = cleanName(e && (e.name || e.entity));
      const key = entityKey(name);
      if (!name || key.length < 2 || byKey.has(key) || DATE.test(name) || (body && !inText(name))) continue;
      const type = String((e && e.type) || '').toLowerCase().trim();
      const entity = { name, type: TYPES.includes(type) ? type : type === 'organization' || type === 'org' ? 'company' : type === 'location' ? 'place' : 'concept' };
      byKey.set(key, entity);
      entities.push(entity);
      if (entities.length >= LIMITS.entities) break;
    }
    const known = (name) => byKey.get(entityKey(name));
    const relations = [];
    for (const r of Array.isArray(json.relations) ? json.relations : []) {
      const rel = String((r && (r.type || r.relation || r.rel)) || '').toLowerCase().trim().replace(/[\s_]+/g, '-');
      const from = known(r && r.from);
      const to = known(r && r.to);
      if (!RELATIONS.includes(rel) || !from || !to || from === to) continue;
      const pair = orientRelation(from, rel, to);
      if (!pair) continue;
      relations.push({ from: pair[0].name, rel, to: pair[1].name });
      if (relations.length >= LIMITS.relations) break;
    }
    const claims = [];
    for (const c of Array.isArray(json.claims) ? json.claims : []) {
      const claim = String((c && (c.claim || c.text)) || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      const passage = findPassage(text, c && c.quote);
      if (claim.length < 8 || !passage) continue;
      let about = [...new Set((Array.isArray(c.about) ? c.about : [c.about]).map((n) => known(n)).filter(Boolean).map((e) => e.name))];
      // Not linked to anything: the entities it names (in full, or by their first three words).
      if (!about.length) {
        const said = fold(`${claim} ${passage.quote}`);
        about = entities.filter((e) => said.includes(fold(e.name.split(' ').slice(0, 3).join(' ')))).map((e) => e.name);
      }
      const stance = String((c && c.stance) || '').toLowerCase();
      claims.push({ text: claim, quote: passage.quote.slice(0, 500), start: passage.start, about, stance: STANCES.includes(stance) ? stance : 'neutral' });
      if (claims.length >= LIMITS.claims) break;
    }
    return { entities, relations, claims };
  }

  /** Pure: the AI's reply to the compare prompt: [{ a, b, rel }] with a in `newIds`, b in `oldIds`. */
  function parseComparison(reply, newIds, oldIds) {
    const json = (soroagent.parseJsonLoose && soroagent.parseJsonLoose(reply)) || {};
    const out = [];
    const seen = new Set();
    // {"checks": [{ new, contradicts: [], supports: [] }]} (current), or {"pairs": [{ new, old, relation }]}.
    const flat = (Array.isArray(json.checks) ? json.checks : []).flatMap((c) => ['contradicts', 'supports'].flatMap((rel) => (Array.isArray(c && c[rel]) ? c[rel] : []).map((old) => ({ new: c.new, old, relation: rel }))));
    for (const p of [...flat, ...(Array.isArray(json.pairs) ? json.pairs : [])]) {
      const a = newIds[Number(String((p && p.new) || (p && p.a) || '').replace(/\D/g, '')) - 1];
      const b = oldIds[Number(String((p && p.old) || (p && p.b) || '').replace(/\D/g, '')) - 1];
      const rel = String((p && (p.relation || p.rel)) || '').toLowerCase();
      if (!a || !b || !['supports', 'contradicts'].includes(rel) || seen.has(`${a}|${b}`)) continue;
      seen.add(`${a}|${b}`);
      out.push({ a, b, rel });
    }
    return out;
  }

  /**
   * Pure: whether a model can be trusted to say which claims contradict each other. Below about 7B
   * parameters (llama3.2:3b, the in-browser models) they call almost anything on the same topic a
   * contradiction, so the step is skipped. Cloud models and unknown sizes are trusted.
   */
  function canCompare({ api = '', model = '' } = {}) {
    if (api === 'browser') return false;
    const m = String(model).toLowerCase().match(/(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z])/);
    return !m || Number(m[1]) >= 7;
  }

  /** Pure: the checkPair reply: "contradicts", "supports", or "" for neither (or unreadable). */
  function parseCheck(reply) {
    const json = (soroagent.parseJsonLoose && soroagent.parseJsonLoose(reply)) || {};
    const rel = String(json.relation || '').toLowerCase();
    return rel === 'contradicts' || rel === 'supports' ? rel : '';
  }

  // ---------------------------------------------------------------------------
  // The graph
  // ---------------------------------------------------------------------------

  /** Pure: the key an extracted name ends up under after the user's splits and merges. */
  function resolveKey(name, edits = EMPTY_EDITS) {
    const surface = cleanName(name).toLowerCase();
    let key = (edits.splits || {})[surface] || entityKey(name);
    const seen = new Set();
    while ((edits.merges || {})[key] && !seen.has(key)) {
      seen.add(key);
      key = edits.merges[key];
    }
    return key;
  }

  const claimId = (noteId, i) => `${noteId}#${i}`;

  /**
   * Pure: the graph from the snippets, their extractions and comparisons, and the user's edits:
   * { entities: Map(key → entity), claims: Map(id → claim), relations: [...], links: [...] }.
   * entity: { key, name, type, aliases, noteIds, claimIds, first, last, mentions }
   * claim:  { id, noteId, text, quote, start, about: [key], stance, at, supports: [id], contradicts: [id] }
   * relations: typed ({ a, b, rel, noteIds }); links: entities named in the same snippets ({ a, b, shared }).
   */
  function buildKG({ notes = [], extractions = {}, comparisons = {}, edits = EMPTY_EDITS } = {}) {
    edits = { ...EMPTY_EDITS, ...(edits || {}) };
    const byId = new Map(notes.filter((n) => n && n.id).map((n) => [n.id, n]));
    const entities = new Map();
    const claims = new Map();
    const relations = new Map();
    const pairCount = new Map();
    const surfaceCount = new Map(); // key → Map(name → count)
    for (const [noteId, x] of Object.entries(extractions)) {
      const note = byId.get(noteId);
      if (!note || !x) continue;
      const at = note.createdAt || x.at || '';
      const keysHere = new Set();
      for (const e of x.entities || []) {
        const key = resolveKey(e.name, edits);
        if (!key || edits.hidden[key]) continue;
        if (!entities.has(key)) entities.set(key, { key, name: '', type: '', types: {}, aliases: [], noteIds: [], claimIds: [], first: at, last: at, mentions: 0 });
        const ent = entities.get(key);
        ent.types[e.type] = (ent.types[e.type] || 0) + 1;
        if (!surfaceCount.has(key)) surfaceCount.set(key, new Map());
        surfaceCount.get(key).set(e.name, (surfaceCount.get(key).get(e.name) || 0) + 1);
        if (!keysHere.has(key)) {
          keysHere.add(key);
          ent.noteIds.push(noteId);
          ent.mentions++;
          if (at && (!ent.first || at < ent.first)) ent.first = at;
          if (at > ent.last) ent.last = at;
        }
      }
      const here = [...keysHere].sort();
      for (let i = 0; i < here.length; i++) {
        for (let j = i + 1; j < here.length; j++) {
          const k = `${here[i]}\u0000${here[j]}`;
          pairCount.set(k, (pairCount.get(k) || 0) + 1);
        }
      }
      for (const r of x.relations || []) {
        const a = resolveKey(r.from, edits);
        const b = resolveKey(r.to, edits);
        if (a === b || !entities.has(a) || !entities.has(b)) continue;
        const k = `${a}\u0000${r.rel}\u0000${b}`;
        if (!relations.has(k)) relations.set(k, { a, b, rel: r.rel, noteIds: [] });
        if (!relations.get(k).noteIds.includes(noteId)) relations.get(k).noteIds.push(noteId);
      }
      (x.claims || []).forEach((c, i) => {
        const id = claimId(noteId, i);
        const about = [...new Set((c.about || []).map((n) => resolveKey(n, edits)).filter((k) => entities.has(k)))];
        claims.set(id, { id, noteId, text: c.text, quote: c.quote, start: c.start, about, stance: c.stance || 'neutral', at, supports: [], contradicts: [] });
        for (const k of about) entities.get(k).claimIds.push(id);
      });
    }
    for (const cmp of Object.values(comparisons)) {
      for (const p of (cmp && cmp.pairs) || []) {
        const a = claims.get(p.a);
        const b = claims.get(p.b);
        if (!a || !b) continue;
        const list = p.rel === 'contradicts' ? 'contradicts' : 'supports';
        if (!a[list].includes(b.id)) a[list].push(b.id);
        if (!b[list].includes(a.id)) b[list].push(a.id);
      }
    }
    for (const ent of entities.values()) {
      const names = [...surfaceCount.get(ent.key).entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
      ent.name = edits.names[ent.key] || names[0][0];
      ent.aliases = names.map(([n]) => n).filter((n) => n !== ent.name);
      ent.type = edits.types[ent.key] || Object.entries(ent.types).sort((a, b) => b[1] - a[1])[0][0];
      delete ent.types;
    }
    const links = [...pairCount.entries()].map(([k, shared]) => {
      const [a, b] = k.split('\u0000');
      return { a, b, shared };
    }).filter((l) => entities.has(l.a) && entities.has(l.b));
    return { entities, claims, relations: [...relations.values()], links };
  }

  /** Pure: entities, most-read first (snippets, then claims, then name). */
  function rankEntities(kg, { type = '', query = '', min = 1 } = {}) {
    const q = String(query || '').toLowerCase().trim();
    return [...kg.entities.values()]
      .filter((e) => e.noteIds.length >= min && (!type || e.type === type) && (!q || e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q))))
      .sort((a, b) => b.noteIds.length - a.noteIds.length || b.claimIds.length - a.claimIds.length || a.name.localeCompare(b.name));
  }

  /** Pure: an entity's neighbours: typed relations first, then entities read about together. */
  function neighbours(kg, key) {
    const out = new Map();
    for (const r of kg.relations) {
      if (r.a !== key && r.b !== key) continue;
      const other = r.a === key ? r.b : r.a;
      const label = r.a === key ? RELATION_LABEL[r.rel] : `${RELATION_LABEL[r.rel]} (by)`.replace('written by (by)', 'wrote').replace('made by (by)', 'makes').replace('part of (by)', 'includes').replace('works for (by)', 'employs').replace('cites (by)', 'cited by').replace('competes with (by)', 'competes with');
      if (!out.has(other)) out.set(other, { key: other, rels: [], shared: 0 });
      if (!out.get(other).rels.includes(label)) out.get(other).rels.push(label);
    }
    for (const l of kg.links) {
      if (l.a !== key && l.b !== key) continue;
      const other = l.a === key ? l.b : l.a;
      if (!out.has(other)) out.set(other, { key: other, rels: [], shared: 0 });
      out.get(other).shared = l.shared;
    }
    return [...out.values()].sort((a, b) => b.rels.length - a.rels.length || b.shared - a.shared);
  }

  /** Pure: contradicting claim pairs for an entity (or all), newest first: [{ a, b }] (a newer). */
  function disagreements(kg, key = '') {
    const out = [];
    const seen = new Set();
    for (const c of kg.claims.values()) {
      if (key && !c.about.includes(key)) continue;
      for (const id of c.contradicts) {
        const other = kg.claims.get(id);
        const k = [c.id, id].sort().join('|');
        if (!other || seen.has(k)) continue;
        seen.add(k);
        out.push(String(c.at) >= String(other.at) ? { a: c, b: other } : { a: other, b: c });
      }
    }
    return out.sort((x, y) => String(y.a.at).localeCompare(String(x.a.at)));
  }

  /** Pure: claims grouped by month, oldest first, so a topic page shows how the story changed. */
  function claimTimeline(claims) {
    const groups = new Map();
    for (const c of [...claims].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
      const d = new Date(c.at);
      const k = isNaN(d) ? 'Undated' : d.toLocaleDateString('en', { month: 'long', year: 'numeric' });
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    return [...groups.entries()].map(([month, items]) => ({ month, items }));
  }

  /**
   * Pure: what changed for an entity's topic page: a fingerprint of its claims and snippets, so the
   * page is written again only when there's something new.
   */
  const pageBasis = (entity) => `${entity.noteIds.length}:${[...entity.claimIds].sort().join(',')}`.slice(0, 2000);

  /** Pure: a link to the exact passage on the source page (a text fragment), or the page itself. */
  function passageUrl(url, quote) {
    if (!/^https?:/i.test(String(url || ''))) return '';
    const enc = (s) => encodeURIComponent(s).replace(/-/g, '%2D').replace(/,/g, '%2C').replace(/&/g, '%26');
    const words = String(quote || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) return url;
    const base = String(url).split('#')[0];
    const fragment = words.length <= 10 ? enc(words.join(' ')) : `${enc(words.slice(0, 5).join(' '))},${enc(words.slice(-5).join(' '))}`;
    return `${base}#:~:text=${fragment}`;
  }

  // ---------------------------------------------------------------------------
  // Corrections (the user's merges, splits, renames, types and hides)
  // ---------------------------------------------------------------------------

  /** Pure: edits with `from` merged into `into` (anything merged into `from` follows it). */
  function mergeEdit(edits, from, into) {
    const e = { ...EMPTY_EDITS, ...edits, merges: { ...((edits && edits.merges) || {}) } };
    if (!from || !into || from === into) return e;
    e.merges[from] = into;
    for (const [k, v] of Object.entries(e.merges)) if (v === from) e.merges[k] = into;
    delete e.merges[into]; // no loops: `into` stands on its own
    return e;
  }

  /**
   * Pure: edits that take one name (as written in the snippets) out of the entity it was filed
   * under, into an entity of its own (`newKey`, made from the name when not given).
   */
  function splitEdit(edits, name, newKey = '') {
    const surface = cleanName(name).toLowerCase();
    const key = newKey || `${entityKey(name)}~${surface.replace(/[^a-z0-9]/g, '').slice(0, 20) || 'x'}`;
    return { ...EMPTY_EDITS, ...edits, splits: { ...((edits && edits.splits) || {}), [surface]: key }, merges: Object.fromEntries(Object.entries((edits && edits.merges) || {}).filter(([k]) => k !== key)) };
  }

  const setEdit = (edits, field, key, value) => {
    const next = { ...EMPTY_EDITS, ...edits, [field]: { ...((edits && edits[field]) || {}) } };
    if (value) next[field][key] = value;
    else delete next[field][key];
    return next;
  };

  /** Pure: a stable hash of a snippet's text, so a changed snippet is extracted again. */
  function textHash(text) {
    let h = 2166136261;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return `${VERSION}:${s.length}:${(h >>> 0).toString(36)}`;
  }

  /** Pure: the text extraction reads for a snippet (its title, then its text). */
  const noteText = (note) => String(note.text || note.summary || '').slice(0, 6000);

  /** Pure: snippets that need extracting (new or changed), newest first. */
  function extractionQueue(notes, extractions) {
    return notes
      .filter((n) => n && n.id && noteText(n).length >= 80 && n.kind !== 'research')
      .filter((n) => !extractions[n.id] || extractions[n.id].hash !== textHash(noteText(n)))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  const hostOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };
  const day = (at) => {
    const d = new Date(at);
    return isNaN(d) ? 'undated' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  /**
   * Pure: the compareClaims prompt's input for one snippet: its claims (N1…) and up to `max` earlier
   * claims from other snippets about the same entities (E1…), or null when there's nothing to compare.
   */
  function compareInput(kg, noteId, notesById, { max = 16 } = {}) {
    const mine = [...kg.claims.values()].filter((c) => c.noteId === noteId && c.about.length);
    if (!mine.length) return null;
    // Everything the snippet is about, not only what its claims name: a claim that Stanford measured
    // 86 percent is about Atlas 2 even when the AI filed it under Stanford.
    const keys = new Set([...mine.flatMap((c) => c.about), ...[...kg.entities.values()].filter((e) => e.noteIds.includes(noteId)).map((e) => e.key)]);
    const at = mine[0].at;
    const older = [...kg.claims.values()]
      .filter((c) => c.noteId !== noteId && String(c.at) <= String(at) && c.about.some((k) => keys.has(k)))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, max);
    if (!older.length) return null;
    const src = (c) => hostOf((notesById.get(c.noteId) || {}).url) || 'your notes';
    return {
      content: mine.map((c, i) => `N${i + 1}. ${c.text}`).join('\n'),
      context: older.map((c, i) => `E${i + 1}. ${c.text} (${day(c.at)}, ${src(c)})`).join('\n'),
      newIds: mine.map((c) => c.id),
      oldIds: older.map((c) => c.id),
    };
  }

  /**
   * Pure: the topicPage prompt's input for an entity: its claims, oldest first, numbered [1]…, with
   * date, source and the claims they contradict; when it has few claims, its snippets' summaries
   * too. `cites[n - 1]` is what [n] points to: a claim id, or "note:<id>".
   */
  function topicPageInput(kg, key, notesById, { max = 30 } = {}) {
    const ent = kg.entities.get(key);
    if (!ent) return null;
    const claims = ent.claimIds.map((id) => kg.claims.get(id)).filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-max);
    const cites = claims.map((c) => c.id);
    const lines = claims.map((c, i) => {
      const note = notesById.get(c.noteId) || {};
      const against = c.contradicts.map((id) => cites.indexOf(id) + 1).filter((n) => n > 0);
      return `[${i + 1}] ${day(c.at)}, ${hostOf(note.url) || 'your notes'}: ${c.text}${against.length ? ` (contradicts [${against.join('], [')}])` : ''}`;
    });
    if (claims.length < 4) {
      for (const id of ent.noteIds.slice(-8)) {
        const note = notesById.get(id);
        if (!note || claims.some((c) => c.noteId === id)) continue;
        cites.push(`note:${id}`);
        lines.push(`[${cites.length}] ${day(note.createdAt)}, ${hostOf(note.url) || 'your notes'}: ${note.title || ''}. ${String(note.summary || '').slice(0, 240)}`);
      }
    }
    if (!lines.length) return null;
    return { question: `${ent.name} (${TYPE_LABEL[ent.type] || ent.type})`, content: lines.join('\n'), cites };
  }

  // ---------------------------------------------------------------------------
  // Resurfacing: what you already know, while you browse
  // ---------------------------------------------------------------------------

  /** Pure: the first sentence of a topic page, without citations, for a hovercard. */
  function pageLine(text) {
    const plain = String(text || '').replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim();
    const m = plain.match(/^(.{20,240}?[.!?])(\s|$)/);
    return m ? m[1] : plain.slice(0, 200);
  }

  /**
   * Pure: the names worth recognising on other pages: entities with at least `min` snippets (or a
   * disagreement), at most `max`, most-read first. Each: { key, name, names, type, notes, claims,
   * disputes, line, last }. `names` are the ways it's written (3+ characters).
   */
  function nameIndex(kg, pages = {}, { min = 2, max = 400 } = {}) {
    const disputed = new Map();
    for (const d of disagreements(kg)) for (const k of new Set([...d.a.about, ...d.b.about])) disputed.set(k, (disputed.get(k) || 0) + 1);
    return rankEntities(kg)
      .filter((e) => e.noteIds.length >= min || disputed.has(e.key))
      .slice(0, max)
      .map((e) => ({
        key: e.key,
        name: e.name,
        names: [...new Set([e.name, ...e.aliases])].filter((n) => n.length >= 3 && !/^\d+$/.test(n)),
        type: e.type,
        notes: e.noteIds.length,
        claims: e.claimIds.length,
        disputes: disputed.get(e.key) || 0,
        line: pages[e.key] ? pageLine(pages[e.key].text) : '',
        last: e.last,
      }))
      .filter((e) => e.names.length);
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * Pure: a matcher for the index's names in page text: matcher(text) → [{ index, length, entry }].
   * Whole words, case-sensitive (so "Atlas" the map isn't "ATLAS" the product), longest name first.
   */
  function nameMatcher(index) {
    const byName = new Map();
    for (const e of index) for (const n of e.names) if (!byName.has(n)) byName.set(n, e);
    if (!byName.size) return () => [];
    const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
    return (text) => {
      const out = [];
      for (const m of String(text || '').matchAll(re)) out.push({ index: m.index, length: m[0].length, entry: byName.get(m[0]) });
      return out;
    };
  }

  /** Pure: the entities a page mentions, most mentioned first: [{ entry, count }]. */
  function findMentions(text, matcher) {
    const counts = new Map();
    for (const m of matcher(text)) counts.set(m.entry, (counts.get(m.entry) || 0) + 1);
    return [...counts.entries()].map(([entry, count]) => ({ entry, count })).sort((a, b) => b.count - a.count || b.entry.notes - a.entry.notes);
  }

  const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
  const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'its', 'has', 'have', 'after', 'over', 'into', 'about', 'says', 'said', 'new', 'how', 'why', 'what', 'will', 'you', 'your']);

  /**
   * Pure: a saved snippet that is the same story from another site (headlines sharing most of their
   * words, saved within `days` of each other), or null.
   */
  function sameStory(title, notes, { url = '', now = Date.now(), days = 4 } = {}) {
    const mine = words(title);
    if (mine.size < 3) return null;
    const host = hostOf(url);
    let best = null;
    for (const n of notes || []) {
      if (!n || !n.url || hostOf(n.url) === host) continue;
      if (Math.abs(now - Date.parse(n.createdAt)) > days * 86400000) continue;
      const theirs = words(n.title || n.pageTitle);
      const shared = [...mine].filter((w) => theirs.has(w)).length;
      const score = shared / Math.min(mine.size, Math.max(theirs.size, 1));
      if (shared >= 3 && score >= 0.5 && (!best || score > best.score)) best = { note: n, score };
    }
    return best && best.note;
  }

  soroagent.kg = {
    VERSION, TYPES, TYPE_LABEL, TYPE_PLURAL, RELATIONS, RELATION_LABEL, LIMITS, EMPTY_EDITS, orientRelation,
    entityKey, findPassage, parseExtraction, parseComparison, parseCheck, canCompare, resolveKey, claimId, buildKG, rankEntities,
    neighbours, disagreements, claimTimeline, pageBasis, passageUrl, mergeEdit, splitEdit, setEdit,
    textHash, noteText, extractionQueue, compareInput, topicPageInput, hostOf, day,
    pageLine, nameIndex, nameMatcher, findMentions, sameStory,
  };
})(globalThis);

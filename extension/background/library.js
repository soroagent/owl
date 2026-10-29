// The library index: semantic search over everything saved. Each note is embedded once (again only
// when it changes) and stored as a compact 8-bit vector ("vec:<id>"), on this device only. A search
// fuses two rankings, by meaning (vectors) and by words (BM25), so exact names and loose
// paraphrases both work. Without an embedding model it searches by words alone.
// The vector helpers are pure (unit tested); the indexer runs in the background worker.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});
  const VEC_PREFIX = 'vec:';
  const BATCH = 16;

  // ---------------------------------------------------------------------------
  // Pure helpers
  // ---------------------------------------------------------------------------

  /** Pure: the text a note is embedded from (title and tags first; capped). */
  function embedText(note) {
    const text = soroagent.stripThinking ? soroagent.stripThinking(note.text || '') : String(note.text || '');
    return [note.title, (note.tags || []).map((t) => `#${t}`).join(' '), note.summary, text.slice(0, 1600)].filter(Boolean).join('\n').slice(0, 2400);
  }

  /** Pure: FNV-1a hash, to tell when a note's text changed. */
  function hashText(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  /**
   * Pure: a vector as base64 bytes (-127..127 per dimension): ~1 KB for 768 dims. Scaled by its
   * largest component so the bytes keep as much precision as possible (direction is all we need).
   */
  function packVector(vector) {
    let max = 0;
    for (const x of vector) max = Math.max(max, Math.abs(x));
    max = max || 1;
    const bytes = new Int8Array(vector.length);
    for (let i = 0; i < vector.length; i++) bytes[i] = Math.round((vector[i] / max) * 127);
    let bin = '';
    const u8 = new Uint8Array(bytes.buffer);
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }

  /** Pure: packVector() back to a unit-length Float32Array. */
  function unpackVector(packed) {
    const bin = atob(packed);
    const out = new Float32Array(bin.length);
    let norm = 0;
    for (let i = 0; i < bin.length; i++) {
      const b = bin.charCodeAt(i);
      out[i] = b > 127 ? b - 256 : b;
      norm += out[i] * out[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < out.length; i++) out[i] /= norm;
    return out;
  }

  /** Pure: cosine similarity of two unit-length vectors. */
  function cosine(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length && i < b.length; i++) dot += a[i] * b[i];
    return dot;
  }

  /**
   * Pure: reciprocal rank fusion of ranked id lists. Returns [{ id, score, by: Set('meaning'|'words') }].
   * lists: { meaning: [ids], words: [ids] }
   */
  function fuseRankings(lists, k = 60) {
    const scores = new Map();
    for (const [by, ids] of Object.entries(lists)) {
      ids.forEach((id, rank) => {
        const entry = scores.get(id) || { id, score: 0, by: new Set() };
        entry.score += 1 / (k + rank + 1);
        entry.by.add(by);
        scores.set(id, entry);
      });
    }
    return [...scores.values()].sort((a, b) => b.score - a.score);
  }

  // How similar (cosine) counts as "about the same thing", by embedding family.
  const RELATED_COSINE = { 'text-embedding-3-small': 0.45, 'text-embedding-004': 0.62, 'mistral-embed': 0.8 };
  const relatedThreshold = (model) => RELATED_COSINE[model] ?? (/minilm/.test(model) ? 0.5 : 0.62);

  // ---------------------------------------------------------------------------
  // The index (background worker only)
  // ---------------------------------------------------------------------------

  function createLibrary({ ext, getTarget, embed }) {
    let cache = null; // { model, vectors: Map(id -> Float32Array) }
    let indexing = null;
    let lastError = '';
    const searchable = (n) => n && soroagent.SEARCHABLE_KINDS.has(n.kind || 'page');

    async function loadAll() {
      const all = await ext.storage.local.get(null);
      const notes = Object.keys(all).filter((k) => k.startsWith('snippet:')).map((k) => all[k]).filter(searchable);
      const vecs = new Map(Object.keys(all).filter((k) => k.startsWith(VEC_PREFIX)).map((k) => [k.slice(VEC_PREFIX.length), all[k]]));
      return { notes, vecs };
    }

    /** Embeds notes that are new or changed (or embedded with another model). */
    function indexNow() {
      indexing = indexing || (async () => {
        const target = await getTarget();
        if (!target) return { mode: 'words' };
        const { notes, vecs } = await loadAll();
        const todo = notes.filter((n) => {
          const v = vecs.get(n.id);
          return !v || v.m !== target.model || v.h !== hashText(embedText(n));
        });
        for (let i = 0; i < todo.length; i += BATCH) {
          const batch = todo.slice(i, i + BATCH);
          const vectors = await embed(target, batch.map(embedText));
          const updates = {};
          batch.forEach((n, j) => {
            if (vectors[j] && vectors[j].length) updates[VEC_PREFIX + n.id] = { m: target.model, h: hashText(embedText(n)), v: packVector(vectors[j]) };
          });
          await ext.storage.local.set(updates);
        }
        // Vectors of deleted notes go too.
        const ids = new Set(notes.map((n) => n.id));
        const stale = [...vecs.keys()].filter((id) => !ids.has(id)).map((id) => VEC_PREFIX + id);
        if (stale.length) await ext.storage.local.remove(stale);
        if (todo.length || stale.length) cache = null;
        lastError = '';
        return { mode: 'meaning', model: target.model, added: todo.length };
      })().catch((err) => {
        lastError = err.message || String(err);
        return { mode: 'words', error: lastError };
      }).finally(() => {
        indexing = null;
      });
      return indexing;
    }

    async function vectorsFor(model) {
      if (cache && cache.model === model) return cache.vectors;
      const { vecs } = await loadAll();
      const vectors = new Map();
      for (const [id, v] of vecs) if (v.m === model) vectors.set(id, unpackVector(v.v));
      cache = { model, vectors };
      return vectors;
    }

    /**
     * Search everything saved. Resolves with { mode, model, results: [{ note, score, by: [...] }] }.
     * opts: { limit, since (ms), excludeUrl }
     */
    async function search(query, { limit = 12, since = 0, excludeUrl = '', where = null } = {}) {
      const { notes } = await loadAll();
      const exclude = excludeUrl ? soroagent.pageKey(excludeUrl) : '';
      const pool = notes.filter((n) => (!since || new Date(n.createdAt).getTime() >= since) && !(exclude && n.url && soroagent.pageKey(n.url) === exclude) && (!where || where(n)));
      const byId = new Map(pool.map((n) => [n.id, n]));
      const words = soroagent.searchNotes(soroagent.buildIndex(pool), query, { limit: 40 }).map((h) => h.note.id);
      let meaning = [];
      let mode = 'words';
      let model = '';
      let best = 0;
      let sims = new Map();
      const target = await getTarget().catch(() => null);
      if (target) {
        try {
          await indexNow();
          const [q] = await embed(target, [String(query).slice(0, 2000)]);
          const qv = unpackVector(packVector(q));
          const vectors = await vectorsFor(target.model);
          const scored = [...vectors.entries()].filter(([id]) => byId.has(id)).map(([id, v]) => ({ id, sim: cosine(qv, v) })).sort((a, b) => b.sim - a.sim);
          best = scored.length ? scored[0].sim : 0;
          meaning = scored.slice(0, 40).filter((s) => s.sim > 0.15).map((s) => s.id);
          mode = 'meaning';
          model = target.model;
          sims = new Map(scored.map((s) => [s.id, s.sim]));
        } catch (err) {
          lastError = err.message || String(err);
        }
      }
      const fused = fuseRankings({ meaning, words }).slice(0, limit);
      return {
        mode,
        model,
        best,
        results: fused.map((f) => ({ note: byId.get(f.id), score: f.score, by: [...f.by], similarity: sims.get(f.id) || 0 })).filter((r) => r.note),
      };
    }

    /** Notes clearly about the same thing as a page: strong meaning match, or several shared words. */
    async function related(pageText, { excludeUrl = '', limit = 3 } = {}) {
      const res = await search(pageText.slice(0, 3000), { limit: 10, excludeUrl });
      const { notes } = await loadAll();
      const exclude = excludeUrl ? soroagent.pageKey(excludeUrl) : '';
      const lexical = new Set(soroagent.relatedNotes(soroagent.buildIndex(notes.filter((n) => !(exclude && n.url && soroagent.pageKey(n.url) === exclude))), pageText, { limit: 5 }).map((h) => h.note.id));
      const threshold = relatedThreshold(res.model);
      return res.results.filter((r) => lexical.has(r.note.id) || (res.mode === 'meaning' && r.similarity >= threshold)).slice(0, limit).map((r) => r.note);
    }

    async function status() {
      const target = await getTarget().catch(() => null);
      const { notes, vecs } = await loadAll();
      const indexed = target ? [...vecs.values()].filter((v) => v.m === target.model).length : 0;
      return { mode: target ? 'meaning' : 'words', model: target ? target.model : '', via: target ? target.kind : '', total: notes.length, indexed: Math.min(indexed, notes.length), error: lastError };
    }

    return { indexNow, search, related, status };
  }

  Object.assign(soroagent, { embedText, hashText, packVector, unpackVector, cosine, fuseRankings, relatedThreshold, createLibrary });
})(globalThis);

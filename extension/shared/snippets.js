// Snippets live in extension storage, one key per snippet ("snippet:<id>") so that
// saves from several tabs at once never overwrite each other.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});
  const PREFIX = 'snippet:';

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async function addSnippet(fields) {
    const snippet = {
      id: newId(),
      createdAt: new Date().toISOString(),
      title: '',
      summary: '',
      tags: [],
      text: '',
      url: '',
      pageTitle: '',
      source: 'page', // 'page' | 'selection'
      model: '',
      ...fields,
    };
    await soroagent.ext.storage.local.set({ [PREFIX + snippet.id]: snippet });
    return snippet;
  }

  /**
   * Saves a snippet, replacing an earlier one with the same `dedupeKey` (e.g. re-summarizing an
   * unchanged page) while keeping its id, creation time and any research attached to it.
   */
  async function upsertSnippet(fields) {
    if (fields.dedupeKey) {
      const existing = (await listSnippets()).find((s) => s.dedupeKey === fields.dedupeKey);
      if (existing) {
        const updated = { ...existing, ...fields, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString(), research: fields.research || existing.research };
        await soroagent.ext.storage.local.set({ [PREFIX + existing.id]: updated });
        return updated;
      }
    }
    return addSnippet(fields);
  }

  async function updateSnippet(id, patch) {
    const key = PREFIX + id;
    const current = (await soroagent.ext.storage.local.get(key))[key];
    if (!current) return null;
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await soroagent.ext.storage.local.set({ [key]: updated });
    return updated;
  }

  async function listSnippets() {
    const all = await soroagent.ext.storage.local.get(null);
    return Object.keys(all)
      .filter((key) => key.startsWith(PREFIX))
      .map((key) => all[key])
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function deleteSnippets(ids) {
    await soroagent.ext.storage.local.remove(ids.map((id) => PREFIX + id));
  }

  // Merges snippets from an export file; existing ids are kept as they are.
  async function importSnippets(items) {
    const existing = new Set((await listSnippets()).map((s) => s.id));
    const toSave = {};
    for (const item of items) {
      if (!item || typeof item !== 'object' || typeof item.text !== 'string') continue;
      const id = typeof item.id === 'string' && item.id ? item.id : newId();
      if (existing.has(id)) continue;
      toSave[PREFIX + id] = { ...item, id, tags: Array.isArray(item.tags) ? item.tags : [] };
    }
    await soroagent.ext.storage.local.set(toSave);
    return Object.keys(toSave).length;
  }

  /** Pure: a page address without its #fragment or trailing slash, for "same page" matching. */
  function pageKey(url) {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname.replace(/\/+$/, '')}${u.search}`;
    } catch {
      return String(url || '');
    }
  }

  /** Snippets saved from this exact page, newest first. */
  async function snippetsForPage(url) {
    const key = pageKey(url);
    return (await listSnippets()).filter((s) => pageKey(s.url) === key);
  }

  // ---------------------------------------------------------------------------
  // The library's tag vocabulary, so auto-tagging stays consistent over time (pure, unit tested)
  // ---------------------------------------------------------------------------

  /** Pure: "AI Agents" / "#ai_agents" → "ai-agents". */
  const normalizeTag = (tag) => String(tag || '').toLowerCase().replace(/^#/, '').replace(/[\s_]+/g, '-').replace(/[^a-z0-9+#.-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  // Singular and plural forms count as the same tag.
  const tagStem = (tag) => normalizeTag(tag).split('-').map((w) => w.replace(/(ies)$/, 'y').replace(/(?<=[a-z]{3})s$/, '')).join('-');

  // Tags that say where a snippet came from, so the library can be filtered by them. They are not
  // topics: the AI never sees them as tags to reuse, the PKG graph leaves them out, and relabelling
  // a snippet keeps them.
  const SOURCE_TAGS = ['x-bookmark', 'x-like', 'linkedin-post'];

  /** Pure: `tags` with the source tags found in `from` added at the end (once each). */
  function withSourceTags(tags, from) {
    const topics = (tags || []).filter((t) => !SOURCE_TAGS.includes(t));
    return [...new Set([...topics, ...(from || []).filter((t) => SOURCE_TAGS.includes(t))])];
  }

  /** Pure: the library's most-used tags, most used first: [{ tag, count }]. */
  function tagVocabulary(snippets, max = 40) {
    const counts = new Map();
    for (const s of snippets || []) for (const t of s.tags || []) if (!SOURCE_TAGS.includes(t)) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, max);
  }

  /** Pure: new tags mapped onto existing ones when they're the same tag written differently. */
  function canonicalTags(tags, vocabulary) {
    const known = new Map((vocabulary || []).map((v) => [tagStem(v.tag || v), v.tag || v]));
    const out = [];
    for (const tag of tags || []) {
      const t = known.get(tagStem(tag)) || normalizeTag(tag);
      if (t && !out.includes(t)) out.push(t);
    }
    return out.slice(0, 4);
  }

  function isSnippetChange(changes) {
    return Object.keys(changes).some((key) => key.startsWith(PREFIX));
  }

  Object.assign(soroagent, { addSnippet, upsertSnippet, updateSnippet, listSnippets, deleteSnippets, importSnippets, isSnippetChange, pageKey, snippetsForPage, normalizeTag, tagVocabulary, canonicalTags, SOURCE_TAGS, withSourceTags });
})(globalThis);

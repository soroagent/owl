// PKG, the personal knowledge graph: the user's snippets seen as topics (their tags) linked by the
// notes they share, each weighted by how many notes it has and how long the user actually spent
// reading those pages (storage.local "pkgDwell": active time per saved page, kept on this device; see
// capture.js). Pure and unit tested; pages/pkg.js draws it.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  const keyOf = (url) => (soroagent.pageKey ? soroagent.pageKey(url) : String(url || '').split('#')[0]);
  const hostOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };

  /** Pure: a topic's weight: one point per note, plus one per 5 minutes of reading its pages. */
  const topicWeight = (notes, dwellMs) => notes + dwellMs / 300000;

  /**
   * Pure: the graph from snippets ({ id, title, url, tags, createdAt, readSeconds }) and the dwell
   * map ({ pageKey: ms }). Returns { topics, edges, totals }:
   *   topics: [{ id, label, notes, dwellMs, weight, sites, recent, last, noteIds }] heaviest first (max `maxTopics`)
   *   edges:  [{ a, b, shared }] topics that share notes, strongest first
   *   totals: { notes, tagged, dwellMs, topics }
   * Time on a page counts once per topic even when the page has several notes. recent = notes in
   * the 30 days before `now`.
   */
  function buildGraph(snippets, dwell = {}, { maxTopics = 40, now = Date.now() } = {}) {
    const notes = (snippets || []).filter((s) => s && s.id);
    const byTopic = new Map();
    const pagesCounted = new Map(); // topic -> Set(pageKey)
    const pairCount = new Map();
    let dwellTotal = 0;
    const pageSeen = new Set();
    for (const s of notes) {
      const page = keyOf(s.url);
      const ms = (Number(dwell[page]) || 0) + (Number(s.readSeconds) || 0) * 1000;
      if (page && !pageSeen.has(page)) {
        pageSeen.add(page);
        dwellTotal += ms;
      }
      const tags = [...new Set((s.tags || []).map((t) => String(t).trim().toLowerCase()).filter((t) => t && !(soroagent.SOURCE_TAGS || []).includes(t)))];
      for (const tag of tags) {
        if (!byTopic.has(tag)) byTopic.set(tag, { id: tag, label: tag, notes: 0, dwellMs: 0, sites: new Set(), recent: 0, last: '', noteIds: [] });
        const t = byTopic.get(tag);
        t.notes += 1;
        t.noteIds.push(s.id);
        if (!pagesCounted.has(tag)) pagesCounted.set(tag, new Set());
        if (page && !pagesCounted.get(tag).has(page)) {
          pagesCounted.get(tag).add(page);
          t.dwellMs += ms;
        }
        const host = hostOf(s.url);
        if (host) t.sites.add(host);
        const created = Date.parse(s.createdAt);
        if (now - created < 30 * 86400000) t.recent += 1;
        if (String(s.createdAt || '') > t.last) t.last = String(s.createdAt || '');
      }
      for (let i = 0; i < tags.length; i++) {
        for (let j = i + 1; j < tags.length; j++) {
          const key = [tags[i], tags[j]].sort().join('\u0000');
          pairCount.set(key, (pairCount.get(key) || 0) + 1);
        }
      }
    }
    const topics = [...byTopic.values()]
      .map((t) => ({ ...t, sites: [...t.sites], weight: topicWeight(t.notes, t.dwellMs) }))
      .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
      .slice(0, maxTopics);
    const kept = new Set(topics.map((t) => t.id));
    const edges = [...pairCount.entries()]
      .map(([key, shared]) => {
        const [a, b] = key.split('\u0000');
        return { a, b, shared };
      })
      .filter((e) => kept.has(e.a) && kept.has(e.b))
      .sort((x, y) => y.shared - x.shared);
    return {
      topics,
      edges,
      totals: { notes: notes.length, tagged: notes.filter((s) => (s.tags || []).some((t) => !(soroagent.SOURCE_TAGS || []).includes(t))).length, dwellMs: dwellTotal, topics: byTopic.size },
    };
  }

  /**
   * Pure: positions for the graph in a width × height box ({ id: { x, y } }), by a small force layout:
   * linked topics pull together, all topics push apart, heavier topics drift to the centre. Starts
   * from a circle in weight order, so the same graph always lays out the same way.
   */
  function layoutGraph(topics, edges, { width = 800, height = 520, iterations = 300 } = {}) {
    const n = topics.length;
    const pos = {};
    if (!n) return pos;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.38;
    topics.forEach((t, i) => {
      const angle = (2 * Math.PI * i) / n;
      const r = n === 1 ? 0 : radius * (0.35 + 0.65 * (i / n));
      pos[t.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
    const maxWeight = Math.max(...topics.map((t) => t.weight), 1);
    const k = Math.sqrt((width * height) / Math.max(n, 1)) * 0.55;
    for (let step = 0; step < iterations; step++) {
      const heat = (1 - step / iterations) * k * 0.6 + 1;
      const move = Object.fromEntries(topics.map((t) => [t.id, { x: 0, y: 0 }]));
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = pos[topics[i].id];
          const b = pos[topics[j].id];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          const d = Math.max(Math.hypot(dx, dy), 0.01);
          const push = (k * k) / d;
          dx /= d;
          dy /= d;
          move[topics[i].id].x += dx * push;
          move[topics[i].id].y += dy * push;
          move[topics[j].id].x -= dx * push;
          move[topics[j].id].y -= dy * push;
        }
      }
      for (const e of edges) {
        const a = pos[e.a];
        const b = pos[e.b];
        if (!a || !b) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.max(Math.hypot(dx, dy), 0.01);
        const pull = ((d * d) / k) * Math.min(1 + Math.log(e.shared), 3);
        move[e.a].x -= (dx / d) * pull;
        move[e.a].y -= (dy / d) * pull;
        move[e.b].x += (dx / d) * pull;
        move[e.b].y += (dy / d) * pull;
      }
      for (const t of topics) {
        const p = pos[t.id];
        const m = move[t.id];
        const gravity = 0.04 + 0.08 * (t.weight / maxWeight);
        m.x += (cx - p.x) * gravity * k * 0.05;
        m.y += (cy - p.y) * gravity * k * 0.05;
        const len = Math.max(Math.hypot(m.x, m.y), 0.01);
        p.x += (m.x / len) * Math.min(len, heat);
        p.y += (m.y / len) * Math.min(len, heat);
        p.x = Math.min(width - 40, Math.max(40, p.x));
        p.y = Math.min(height - 30, Math.max(30, p.y));
      }
    }
    return pos;
  }

  /** Pure: "2 h 5 min", "14 min", "under a minute", "" for none. */
  function readingTime(ms) {
    const m = Math.round((Number(ms) || 0) / 60000);
    if (!ms) return '';
    if (m < 1) return 'under a minute';
    if (m < 60) return `${m} min`;
    return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
  }

  /** Pure: the dwell map with time added for one saved page (capped at an hour per report). */
  function addDwell(map, url, ms) {
    const page = keyOf(url);
    const add = Math.min(Math.max(Math.round(Number(ms) || 0), 0), 3600000);
    if (!page || !add) return { ...(map || {}) };
    return { ...(map || {}), [page]: ((map || {})[page] || 0) + add };
  }

  /** Pure: the start of a day (local time) as a Date, `back` days before `now`. */
  function dayStart(now = new Date(), back = 0) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - back);
    return d;
  }

  /**
   * Pure: the daily digest: snippets saved between `from` (inclusive) and `to` (exclusive), grouped
   * by their first topic (case-folded; most snippets first, then alphabetical), newest first within
   * a topic: { count, sites, topics: [{ topic, items }], other: [untagged] }.
   */
  function dailyDigest(snippets, { from, to = new Date(8.64e15) } = {}) {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    const picked = snippets.filter((s) => {
      const t = Date.parse(s && s.createdAt);
      return t >= start && t < end;
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const groups = new Map();
    const other = [];
    for (const s of picked) {
      const tag = (s.tags || []).map((t) => String(t).trim().toLowerCase()).find(Boolean);
      if (!tag) other.push(s);
      else groups.set(tag, [...(groups.get(tag) || []), s]);
    }
    const topics = [...groups].map(([topic, list]) => ({ topic, items: list })).sort((a, b) => b.items.length - a.items.length || a.topic.localeCompare(b.topic));
    const sites = new Set(picked.map((s) => s.site || (() => { try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return ''; } })()).filter(Boolean));
    return { count: picked.length, sites: sites.size, topics, other };
  }

  Object.assign(soroagent, { buildGraph, layoutGraph, topicWeight, readingTime, addDwell, dayStart, dailyDigest });
})(globalThis);

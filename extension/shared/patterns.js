// Stats (pages/patterns.html): what you read, how long and when, from the reading log soroagent keeps on this
// device (storage.local "readingLog": one entry per page and day with its site, title and active
// reading time; capture.js measures it, background.js "reading:log" adds it). Never synced, backed up
// or sent anywhere. Everything here is pure and unit tested; pages/patterns.js draws it.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  const KEEP_DAYS = 365;
  const MAX_ENTRIES = 6000;
  const DAY_MS = 86400000;

  const pad = (n) => String(n).padStart(2, '0');
  const dayOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const parseDay = (day) => {
    const [y, m, d] = String(day).split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  /**
   * Pure: the log with one reading added. rec: { host, title, ms, visit, at (Date) }. The same page
   * (site + title) on the same day is one entry: its time adds up, and `n` counts the visits.
   * Entries older than a year go, and the log never holds more than MAX_ENTRIES.
   */
  function addReading(entries, { host, title, ms, visit = false, at = new Date() }) {
    const log = Array.isArray(entries) ? entries.slice() : [];
    const time = Math.round(Number(ms) || 0);
    const site = String(host || '').toLowerCase().replace(/^www\./, '').slice(0, 120);
    if (!site || time <= 0) return log;
    const name = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const d = dayOf(at);
    const i = log.findIndex((e) => e.d === d && e.host === site && e.title === name);
    if (i >= 0) log[i] = { ...log[i], ms: log[i].ms + time, n: log[i].n + (visit ? 1 : 0) };
    else log.push({ d, h: at.getHours(), host: site, title: name, ms: time, n: 1 }); // a new entry is a page read that day
    const oldest = dayOf(new Date(at.getTime() - KEEP_DAYS * DAY_MS));
    const kept = log.filter((e) => e.d >= oldest);
    return kept.length > MAX_ENTRIES ? kept.slice(kept.length - MAX_ENTRIES) : kept;
  }

  /** Pure: the entries within the last `days` days (0 = all), counting today. */
  function inRange(entries, days, now = new Date()) {
    if (!days) return (entries || []).slice();
    const from = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)));
    return (entries || []).filter((e) => e.d >= from);
  }

  /**
   * Pure: reading stats for the last `days` days (0 = all time):
   * { pages, totalMs, avgMs, activeDays, streak, peakHour, byDay: [{ day, ms, pages }], byHour: [ms × 24],
   *   sites: [{ host, ms, pages }] (top 8), siteCount, longest: { title, host, ms } | null }
   */
  function readingStats(entries, { days = 30, now = new Date() } = {}) {
    const list = inRange(entries, days, now);
    const pages = list.reduce((sum, e) => sum + (e.n || 1), 0);
    const totalMs = list.reduce((sum, e) => sum + e.ms, 0);
    const perDay = new Map();
    const byHour = new Array(24).fill(0);
    const sites = new Map();
    let longest = null;
    for (const e of list) {
      const day = perDay.get(e.d) || { ms: 0, pages: 0 };
      perDay.set(e.d, { ms: day.ms + e.ms, pages: day.pages + (e.n || 1) });
      byHour[e.h >= 0 && e.h < 24 ? e.h : 0] += e.ms;
      const site = sites.get(e.host) || { host: e.host, ms: 0, pages: 0 };
      sites.set(e.host, { host: e.host, ms: site.ms + e.ms, pages: site.pages + (e.n || 1) });
      if (!longest || e.ms > longest.ms) longest = { title: e.title, host: e.host, ms: e.ms };
    }
    // Bars for every day in the range (up to 90, so "all time" stays readable), oldest first.
    const span = days || Math.min(90, Math.max(1, list.length ? Math.round((parseDay(dayOf(now)) - parseDay(list.reduce((a, e) => (e.d < a ? e.d : a), list[0].d))) / DAY_MS) + 1 : 1));
    const byDay = [];
    for (let i = Math.min(span, 90) - 1; i >= 0; i--) {
      const day = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
      const v = perDay.get(day) || { ms: 0, pages: 0 };
      byDay.push({ day, ms: v.ms, pages: v.pages });
    }
    // Streak: days in a row with some reading, ending today (or yesterday, if nothing yet today).
    const allDays = new Set((entries || []).map((e) => e.d));
    let streak = 0;
    let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!allDays.has(dayOf(cursor))) cursor = new Date(cursor.getTime() - DAY_MS);
    while (allDays.has(dayOf(cursor))) {
      streak += 1;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    }
    const peak = byHour.indexOf(Math.max(...byHour));
    return {
      pages,
      totalMs,
      avgMs: pages ? Math.round(totalMs / pages) : 0,
      activeDays: perDay.size,
      streak,
      peakHour: totalMs ? peak : null,
      byDay,
      byHour,
      sites: [...sites.values()].sort((a, b) => b.ms - a.ms).slice(0, 8),
      siteCount: sites.size,
      longest,
    };
  }

  const STOPWORDS = new Set(`a about above after again against all also am an and any are as at be because been before being below
    between both but by can could did do does doing down during each few for from further get gets got had has have having he her here
    hers him his how i if in into is it its itself just me more most my new no nor not now of off on once only or other our ours out over
    own same she should so some such than that the their them then there these they this those through to too under until up very was we
    were what when where which while who whom why will with would you your yours vs via per using use used one two three first last next
    best top guide review reviews video videos watch official home page pages site online free full latest update updates news today
    week year day days time times way ways thing things make makes made know need want like says said say just really much many
    every get here what's how's it's don't can't won't you're i'm we're they're explained explainer explains
    practice introduction intro overview tutorial tips tricks live results report reports map show ask tell story stories
    part chapter episode edition analysis opinion read reading look inside behind why`.split(/\s+/).filter(Boolean));
  const SEPARATORS = /\s+[|\-–—·•:]\s+|\s+[|–—·•]\s*|\s*[|–—·•]\s+/;
  const compact = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  /** Pure: a page title without its site name ("Snowy owls - The Verge" → "Snowy owls"). */
  function titleCore(title, host, siteParts = new Set()) {
    const parts = String(title || '').split(SEPARATORS).map((p) => p.trim()).filter(Boolean);
    const hostKey = compact(String(host || '').replace(/^www\./, '').replace(/\.[a-z]{2,6}(\.[a-z]{2})?$/, ''));
    const kept = parts.filter((p) => {
      const key = compact(p);
      return key && !siteParts.has(p.toLowerCase()) && !(hostKey && (key === hostKey || (key.length >= 4 && hostKey.includes(key)) || (hostKey.length >= 4 && key.includes(hostKey) && p.split(/\s+/).length <= 3)));
    });
    return (kept.length ? kept : parts.slice(0, 1)).join(' ');
  }

  const words = (text) => (String(text || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.'-]*/gu) || [])
    .map((w) => w.replace(/['.-]+$/, '').replace(/'s$/, ''))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  /**
   * Pure: the topics you read most, from page titles: [{ topic, ms, pages }], most read first.
   * Site names are left out (title parts a site repeats on several pages, or that match its address).
   * Two-word topics ("climate change") win over their single words; a topic needs at least 2 pages.
   */
  function readingTopics(entries, { max = 10 } = {}) {
    const list = entries || [];
    // Title parts a site repeats on 2+ different pages are its name, not a topic.
    const seenParts = new Map();
    for (const e of list) {
      for (const p of String(e.title || '').split(SEPARATORS).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
        const key = `${e.host}\u0000${p}`;
        if (!seenParts.has(key)) seenParts.set(key, new Set());
        seenParts.get(key).add(e.title);
      }
    }
    const siteParts = new Map();
    for (const [key, titles] of seenParts) {
      if (titles.size < 2) continue;
      const [host, part] = key.split('\u0000');
      if (!siteParts.has(host)) siteParts.set(host, new Set());
      siteParts.get(host).add(part);
    }
    const uni = new Map();
    const bi = new Map();
    // pages: distinct pages (a topic needs 2+); reads: visits, the same count the Sites list shows.
    const add = (map, key, e, label) => {
      const v = map.get(key) || { label, ms: 0, pages: new Set(), reads: 0, labels: new Map() };
      v.ms += e.ms;
      v.pages.add(`${e.host}${e.title}`);
      v.reads += e.n || 1;
      v.labels.set(label, (v.labels.get(label) || 0) + 1);
      map.set(key, v);
    };
    for (const e of list) {
      const w = words(titleCore(e.title, e.host, siteParts.get(e.host)));
      const once = new Set();
      w.forEach((word, i) => {
        if (!once.has(word)) add(uni, word, e, word);
        once.add(word);
        if (i > 0 && w[i - 1] !== word) {
          // "rust async" and "async rust" are one topic, shown the way it's written most.
          const pair = [w[i - 1], word].sort().join(' ');
          if (!once.has(pair)) add(bi, pair, e, `${w[i - 1]} ${word}`);
          once.add(pair);
        }
      });
    }
    const label = (v) => [...v.labels.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const rank = (map) => [...map.values()].filter((v) => v.pages.size >= 2).map((v) => ({ topic: label(v), ms: v.ms, pages: v.reads, distinct: v.pages.size }));
    const pairs = rank(bi).sort((a, b) => b.distinct - a.distinct || b.ms - a.ms);
    const chosen = [];
    const covered = new Set();
    for (const p of pairs) {
      if (chosen.length >= Math.ceil(max / 2)) break;
      // A pair only beats its words when it covers most of their pages.
      const [w1, w2] = p.topic.split(' ');
      const most = Math.max((uni.get(w1) || { pages: new Set() }).pages.size, (uni.get(w2) || { pages: new Set() }).pages.size);
      if (p.distinct * 2 < most) continue;
      chosen.push(p);
      covered.add(w1);
      covered.add(w2);
    }
    for (const u of rank(uni).sort((a, b) => b.distinct - a.distinct || b.ms - a.ms)) {
      if (chosen.length >= max) break;
      if (!covered.has(u.topic)) chosen.push(u);
    }
    return chosen
      .sort((a, b) => b.ms - a.ms || b.pages - a.pages)
      .slice(0, max)
      .map(({ topic, ms, pages }) => ({ topic: topic.charAt(0).toUpperCase() + topic.slice(1), ms, pages }));
  }

  /**
   * Pure: library stats for the same range: { total, added, byKind: { kind: count }, summaries, topTags }.
   * snippets: library notes (createdAt, kind, tags); summaries: summary history records (createdAt).
   */
  function libraryStats(snippets, summaries, { days = 30, now = new Date() } = {}) {
    const from = days ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).toISOString() : '';
    const within = (r) => !from || String(r.createdAt || '') >= from;
    const notes = (snippets || []).filter(Boolean);
    const byKind = {};
    for (const s of notes.filter(within)) byKind[s.kind || 'page'] = (byKind[s.kind || 'page'] || 0) + 1;
    const counts = new Map();
    for (const s of notes.filter(within)) for (const t of s.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    return {
      total: notes.length,
      added: notes.filter(within).length,
      byKind,
      summaries: (summaries || []).filter(within).length,
      topTags: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, count]) => ({ tag, count })),
    };
  }

  /** Pure: "2 h 5 min", "14 min", "40 s". */
  function formatDuration(ms) {
    const s = Math.round((Number(ms) || 0) / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  }

  Object.assign(soroagent, { addReading, readingStats, readingTopics, titleCore, libraryStats, formatDuration, READING_LOG_DAYS: KEEP_DAYS });
})(globalThis);

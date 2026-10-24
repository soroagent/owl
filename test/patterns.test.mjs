import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/patterns.js');

const at = (day, hour = 10) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`);
const min = 60000;

test('the reading log adds up time per page and day, and forgets after a year', () => {
  let log = [];
  log = S.addReading(log, { host: 'www.Example.com', title: 'Snowy owls', ms: 2 * min, visit: true, at: at('2026-10-20') });
  log = S.addReading(log, { host: 'example.com', title: 'Snowy owls', ms: 1 * min, visit: false, at: at('2026-10-20', 11) });
  log = S.addReading(log, { host: 'example.com', title: 'Snowy owls', ms: 1 * min, visit: true, at: at('2026-10-20', 12) });
  log = S.addReading(log, { host: 'example.com', title: 'Snowy owls', ms: 1 * min, visit: true, at: at('2026-10-21') });
  assert.equal(log.length, 2);
  assert.deepEqual(log[0], { d: '2026-10-20', h: 10, host: 'example.com', title: 'Snowy owls', ms: 4 * min, n: 2 });
  assert.equal(S.addReading(log, { host: '', title: 'x', ms: 5, at: at('2026-10-21') }).length, 2, 'needs a site');
  assert.equal(S.addReading(log, { host: 'a.com', title: 'x', ms: 0, at: at('2026-10-21') }).length, 2, 'needs time');
  const later = S.addReading(log, { host: 'a.com', title: 'x', ms: min, at: at('2027-10-25') });
  assert.deepEqual(later.map((e) => e.d), ['2027-10-25']);
});

test('reading stats: totals, average, days, streak, peak hour, sites and the longest read', () => {
  const log = [
    { d: '2026-10-22', h: 21, host: 'nature.com', title: 'Coral reefs', ms: 10 * min, n: 1 },
    { d: '2026-10-23', h: 21, host: 'bbc.co.uk', title: 'Election', ms: 4 * min, n: 2 },
    { d: '2026-10-24', h: 21, host: 'nature.com', title: 'Owls', ms: 6 * min, n: 1 },
    { d: '2026-09-01', h: 8, host: 'old.com', title: 'Old', ms: 30 * min, n: 1 },
  ];
  const now = at('2026-10-24', 22);
  const st = S.readingStats(log, { days: 7, now });
  assert.equal(st.pages, 4);
  assert.equal(st.totalMs, 20 * min);
  assert.equal(st.avgMs, 5 * min);
  assert.equal(st.activeDays, 3);
  assert.equal(st.streak, 3);
  assert.equal(st.peakHour, 21);
  assert.equal(st.byDay.length, 7);
  assert.deepEqual(st.byDay.at(-1), { day: '2026-10-24', ms: 6 * min, pages: 1 });
  assert.deepEqual(st.sites[0], { host: 'nature.com', ms: 16 * min, pages: 2 });
  assert.equal(st.longest.title, 'Coral reefs');
  const all = S.readingStats(log, { days: 0, now });
  assert.equal(all.totalMs, 50 * min);
  assert.equal(all.byDay.length, 54, 'all time: a bar per day since the first read');
  assert.equal(S.readingStats(log, { days: 7, now: at('2026-10-26') }).streak, 0, 'a missed day ends the streak');
  assert.equal(S.readingStats([], { days: 30, now }).peakHour, null);
});

test('topics come from page titles, without site names, two-word topics first', () => {
  const e = (host, title, m = 1) => ({ d: '2026-10-24', h: 9, host, title, ms: m * min, n: 1 });
  const log = [
    e('theverge.com', 'Climate change is speeding up glaciers - The Verge', 5),
    e('theverge.com', 'How climate change reshapes farming - The Verge', 4),
    e('bbc.co.uk', 'Climate change: what the new report says | BBC News', 3),
    e('example.com', 'Rust async explained', 6),
    e('blog.example.org', 'Async Rust in practice', 2),
    e('blog.example.org', 'Notes on gardening', 1),
  ];
  const topics = S.readingTopics(log);
  const names = topics.map((t) => t.topic);
  assert.ok(names.includes('Climate change'), names.join(', '));
  assert.ok(names.includes('Rust async'), 'word order does not split a topic: ' + names.join(', '));
  assert.ok(!names.includes('Explained'), 'generic title words are not topics');
  assert.ok(!names.some((n) => /verge|bbc/i.test(n)), 'site names are not topics');
  assert.ok(!names.includes('Climate') && !names.includes('Change'), 'the pair replaces its words');
  assert.ok(!names.includes('Gardening'), 'one page is not a topic');
  assert.equal(topics.find((t) => t.topic === 'Climate change').pages, 3);
  assert.equal(S.titleCore('Snowy owls - The Verge', 'theverge.com'), 'Snowy owls');
});

test('library stats and durations', () => {
  const now = new Date('2026-10-24T12:00:00');
  const snippets = [
    { kind: 'summary', createdAt: '2026-10-23T10:00:00.000Z', tags: ['ai', 'owls'] },
    { kind: 'page', createdAt: '2026-10-20T10:00:00.000Z', tags: ['owls'] },
    { kind: 'research', createdAt: '2026-01-01T10:00:00.000Z', tags: ['old'] },
  ];
  const st = S.libraryStats(snippets, [{ createdAt: '2026-10-22T09:00:00.000Z' }], { days: 7, now });
  assert.equal(st.total, 3);
  assert.equal(st.added, 2);
  assert.deepEqual(st.byKind, { summary: 1, page: 1 });
  assert.equal(st.summaries, 1);
  assert.deepEqual(st.topTags[0], { tag: 'owls', count: 2 });
  assert.equal(S.formatDuration(40000), '40 s');
  assert.equal(S.formatDuration(14 * min), '14 min');
  assert.equal(S.formatDuration(125 * min), '2 h 5 min');
  assert.equal(S.formatDuration(120 * min), '2 h');
});

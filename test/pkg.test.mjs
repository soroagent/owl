import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/config.js', 'shared/snippets.js', 'shared/pkg.js');

const now = Date.parse('2026-10-24T12:00:00Z');
const note = (id, tags, url, extra = {}) => ({ id, tags, url, title: id, createdAt: '2026-10-20T10:00:00Z', ...extra });
const min = 60000;

test('the PKG: topics weighted by notes and reading time, linked by the notes they share', () => {
  const notes = [
    note('1', ['ai', 'chips'], 'https://a.example/gpu'),
    note('2', ['ai', 'agents'], 'https://b.example/agents'),
    note('3', ['ai'], 'https://b.example/agents#comments'), // same page as 2: its time counts once
    note('4', ['baking'], 'https://c.example/bread', { createdAt: '2026-01-01T00:00:00Z' }),
    note('5', [], 'https://d.example/untagged'),
    note('6', ['AI', 'chips'], 'https://e.example/npu', { readSeconds: 120 }), // tags are case-insensitive; passive capture time counts
  ];
  const dwell = { [S.pageKey('https://a.example/gpu')]: 20 * min, [S.pageKey('https://b.example/agents')]: 10 * min };
  const g = S.buildGraph(notes, dwell, { now });
  const ai = g.topics.find((t) => t.id === 'ai');
  assert.equal(g.topics[0].id, 'ai', 'heaviest first');
  assert.equal(ai.notes, 4);
  assert.equal(ai.dwellMs, 32 * min, '20 + 10 (once for the shared page) + 2');
  assert.equal(ai.weight, 4 + 32 / 5);
  assert.deepEqual(ai.sites.sort(), ['a.example', 'b.example', 'e.example']);
  assert.equal(g.topics.find((t) => t.id === 'baking').recent, 0, 'older than 30 days');
  assert.deepEqual(g.edges[0], { a: 'ai', b: 'chips', shared: 2 });
  assert.ok(g.edges.some((e) => e.a === 'agents' && e.b === 'ai'));
  assert.deepEqual(g.totals, { notes: 6, tagged: 5, dwellMs: 32 * min, topics: 4 });
  assert.equal(S.buildGraph(notes, dwell, { now, maxTopics: 2 }).edges.every((e) => ['ai', 'chips'].includes(e.a) && ['ai', 'chips'].includes(e.b)), true, 'edges only between kept topics');
});

test('the layout stays in the box, is the same every time, and pulls linked topics together', () => {
  const g = S.buildGraph([note('1', ['ai', 'chips'], 'https://a/1'), note('2', ['ai', 'chips'], 'https://a/2'), note('3', ['baking'], 'https://a/3'), note('4', ['running'], 'https://a/4'), note('5', ['ai'], 'https://a/5')], {}, { now });
  const a = S.layoutGraph(g.topics, g.edges, { width: 800, height: 500 });
  const b = S.layoutGraph(g.topics, g.edges, { width: 800, height: 500 });
  assert.deepEqual(a, b);
  for (const p of Object.values(a)) assert.ok(p.x >= 40 && p.x <= 760 && p.y >= 30 && p.y <= 470);
  const dist = (x, y) => Math.hypot(a[x].x - a[y].x, a[x].y - a[y].y);
  assert.ok(dist('ai', 'chips') < dist('baking', 'running'), 'linked topics sit closer than unlinked ones');
  assert.deepEqual(S.layoutGraph([], []), {});
});

test('reading time on saved pages adds up per page, capped per report', () => {
  let map = S.addDwell({}, 'https://a.example/x#top', 30000);
  map = S.addDwell(map, 'https://a.example/x', 90000);
  assert.deepEqual(map, { [S.pageKey('https://a.example/x')]: 120000 });
  assert.equal(Object.values(S.addDwell({}, 'https://a.example/y', 5 * 3600000))[0], 3600000);
  assert.deepEqual(S.addDwell(map, '', 1000), map);
  assert.equal(S.readingTime(0), '');
  assert.equal(S.readingTime(20000), 'under a minute');
  assert.equal(S.readingTime(14 * min), '14 min');
  assert.equal(S.readingTime(125 * min), '2 h 5 min');
});

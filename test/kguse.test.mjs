import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/config.js', 'shared/markdown.js', 'shared/prompts.js', 'prompts/default.js', 'shared/kg.js', 'shared/kguse.js');
const K = S.kg;
const U = S.kguse;
const DAY = 86400000;

const notes = [
  { id: 'n1', kind: 'page', createdAt: '2026-08-14T09:00:00Z', url: 'https://www.theverge.com/a', title: 'Nimbus unveils Atlas 2', summary: 'Launch.' },
  { id: 'n2', kind: 'page', createdAt: '2026-09-03T12:00:00Z', url: 'https://www.ft.com/b', title: 'Helix pushes back', summary: 'Dispute.' },
  { id: 'n3', kind: 'summary', createdAt: '2026-10-02T08:30:00Z', url: 'https://www.reuters.com/c', title: 'Atlas 2 delayed', summary: 'Delay.' },
  { id: 'n4', kind: 'selection', createdAt: '2026-10-27T10:00:00Z', url: 'https://www.theverge.com/d', title: 'A highlight', text: 'Model makers have every incentive to inflate benchmark numbers.' },
];
const extractions = {
  n1: { entities: [{ name: 'Nimbus Labs', type: 'company' }, { name: 'Atlas 2', type: 'product' }], relations: [{ from: 'Atlas 2', rel: 'made-by', to: 'Nimbus Labs' }], claims: [{ text: 'Atlas 2 scores 91 percent on MMLU.', quote: 'q', about: ['Atlas 2'], stance: 'for' }, { text: 'Atlas 2 ships by December.', quote: 'q', about: ['Atlas 2'], stance: 'neutral' }] },
  n2: { entities: [{ name: 'Helix AI', type: 'company' }, { name: 'Atlas 2', type: 'product' }], relations: [], claims: [{ text: 'Stanford measured Atlas 2 at 86 percent.', quote: 'q', about: ['Atlas 2'], stance: 'against' }] },
  n3: { entities: [{ name: 'Atlas 2', type: 'product' }, { name: 'Nimbus Labs', type: 'company' }], relations: [], claims: [{ text: 'Atlas 2 is delayed to 2027.', quote: 'q', about: ['Atlas 2', 'Nimbus Labs'], stance: 'neutral' }] },
};
const comparisons = { n2: { pairs: [{ a: 'n2#0', b: 'n1#0', rel: 'contradicts' }] } };
const kg = K.buildKG({ notes, extractions, comparisons });
const byId = new Map(notes.map((n) => [n.id, n]));

test('time limits in the question', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  assert.deepEqual(U.parseTimeFilter('what did I read about RAG last month?', { now }), { since: now - 31 * DAY, label: 'in the last month' });
  assert.equal(U.parseTimeFilter('anything from the past 3 weeks', { now }).since, now - 21 * DAY);
  assert.equal(U.parseTimeFilter('what about Atlas 2', { now }).since, 0);
  assert.equal(U.parseTimeFilter('last month', { now, days: 7 }).label, 'in the last week', 'the filter wins');
  assert.ok(U.passes(notes[0], { site: 'theverge.com', kind: 'page' }));
  assert.ok(!U.passes(notes[0], { site: 'ft.com' }));
  assert.ok(!U.passes(notes[0], { since: Date.parse('2026-09-01') }));
});

test('asking: claims of what the question names, one hop along relations, then snippets', () => {
  const ctx = U.askContext({ kg, notesById: byId, hits: [notes[3]], question: 'What happened with Nimbus Labs?' });
  assert.ok(ctx.entities.includes('nimbuslabs') && ctx.entities.includes('atlas2'), 'Atlas 2 is one hop from Nimbus Labs');
  assert.deepEqual(ctx.cites, ['n1#0', 'n1#1', 'n2#0', 'n3#0', 'note:n4']);
  assert.match(ctx.content, /^\[1\] 14 Aug 2026, theverge\.com: Atlas 2 scores 91 percent on MMLU\. \(contradicts \[3\]\)/);
  assert.match(ctx.content, /\[5\] 27 Oct 2026, theverge\.com: A highlight\. Model makers/);
  const recent = U.askContext({ kg, notesById: byId, hits: [], question: 'Atlas 2', filters: { since: Date.parse('2026-09-01') } });
  assert.deepEqual(recent.cites, ['n2#0', 'n3#0'], 'filters apply to claims too');
});

test('review: on this day, gaps, the week', () => {
  const otd = U.onThisDay(notes, Date.parse('2026-11-02T10:00:00Z'));
  assert.deepEqual(otd.map((g) => [g.label, g.notes.map((n) => n.id)]), [['A month ago', ['n3']]]);
  const g = U.gaps(K.buildKG({ notes, extractions: { ...extractions, n2: { ...extractions.n2, claims: [{ ...extractions.n2.claims[0], stance: 'neutral' }] } } }), byId, { min: 3 });
  assert.deepEqual(g.map((x) => x.text), ['3 snippets on Atlas 2, none critical of it.']);
  assert.deepEqual(U.gaps(kg, byId, { min: 3 }), [], 'one critical claim is enough');
  const week = U.weeklyInput(kg, notes, { from: Date.parse('2026-09-28'), to: Date.parse('2026-10-29') });
  assert.equal(week.count, 2);
  assert.deepEqual(week.cites, ['n3#0', 'note:n4']);
  assert.match(week.content, /\(about Atlas 2, Nimbus Labs\): Atlas 2 is delayed to 2027\./);
  assert.equal(U.weeklyInput(kg, notes, { from: Date.parse('2027-01-01') }), null);
});

test('spaced repetition', () => {
  const items = U.reviewItems(kg, notes);
  assert.deepEqual(items.map((i) => i.id), ['note:n4', 'n1#0', 'n1#1', 'n2#0', 'n3#0']);
  assert.equal(items[1].front, 'What did you read about Atlas 2?');
  const now = 1e12;
  let st = U.nextReview({}, 1, now);
  assert.deepEqual([st.interval, st.reps], [1, 1]);
  st = U.nextReview(st, 1, now);
  assert.equal(st.interval, 3);
  st = U.nextReview(st, 2, now);
  assert.equal(st.interval, Math.round(3 * 2.5 * 1.3));
  assert.equal(U.nextReview(st, 0, now).interval, 1, 'forgotten: back to tomorrow');
  const states = { 'n1#0': { due: now - 1 }, 'n1#1': { due: now + DAY } };
  assert.deepEqual(U.dueCards(items, states, { now, max: 3 }).map((i) => i.id), ['n1#0', 'n3#0', 'n2#0']);
});

test('outputs: the claims of one or more entities, flashcards for Anki', () => {
  const out = U.outputInput(kg, ['atlas2', 'helixai'], byId);
  assert.equal(out.question, 'Atlas 2 (Product) and Helix AI (Company)');
  assert.deepEqual(out.cites, ['n1#0', 'n1#1', 'n2#0', 'n3#0', 'note:n2'], 'Helix AI has no claims: its snippet too');
  assert.equal(U.outputInput(kg, ['nothing'], byId), null);
  const cards = U.parseCards('{"cards": [{"front": "Atlas 2 MMLU score?", "back": "91 percent (claimed)", "source": "[1]"}, {"front": "", "back": "x"}]}');
  assert.deepEqual(cards, [{ front: 'Atlas 2 MMLU score?', back: '91 percent (claimed)', cite: 1 }]);
  assert.equal(U.cardsToTsv([{ front: 'a\tb', back: 'c\nd' }], () => 'theverge.com'), '#separator:tab\n#html:false\na b\tc d\ttheverge.com\n');
  for (const p of ['askLibrary', 'weekly', 'outBrief', 'outStudy', 'outTimeline', 'outCompare']) assert.match(S.buildMessages(p, { question: 'q', content: 'c', context: '' }, {})[0].content, /\[n\]/, p);
  assert.match(S.buildMessages('outCards', { question: 'q', content: 'c' }, {})[1].content, /"cards"/);
});

test('time words leave the search; new practice cards are limited per day; few claims fall back to snippets', () => {
  assert.equal(U.withoutTime('What did I read last week about RAG?'), 'What did I read about RAG?');
  const items = U.reviewItems(kg, notes);
  const now = Date.parse('2026-10-29T12:00:00');
  const states = { 'n1#0': U.nextReview({}, 1, now - 3600000), 'n1#1': U.nextReview({}, 1, now - 3600000) };
  assert.equal(U.dueCards(items, states, { now, newPerDay: 3, max: 10 }).length, 1, 'two started today: one new card left');
  assert.equal(states['n1#0'].first, now - 3600000);
  const helix = U.outputInput(kg, ['helixai'], new Map(notes.map((n) => [n.id, n])));
  assert.deepEqual(helix.cites, ['note:n2'], 'Helix AI has no claims: its snippet instead');
});

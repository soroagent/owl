import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/config.js', 'shared/markdown.js', 'shared/prompts.js', 'prompts/default.js', 'shared/kg.js');
const K = S.kg;

test('one entity, however it is written', () => {
  for (const name of ['OpenAI', 'Open AI', 'openai.com', 'OpenAI, Inc.', 'https://www.openai.com/', "OpenAI's"]) assert.equal(K.entityKey(name), 'openai', name);
  assert.equal(K.entityKey('The Economist'), 'economist');
  assert.equal(K.entityKey('Zürich'), 'zurich');
  assert.notEqual(K.entityKey('Apple'), K.entityKey('Apple Music'));
});

test('a claim keeps the exact passage it came from, and made-up quotes are dropped', () => {
  const text = 'Revenue grew 40% in 2025.  OpenAI said “GPT-6 ships in spring” — analysts doubt it.';
  const p = K.findPassage(text, 'OpenAI said "GPT-6 ships in spring" - analysts doubt it');
  assert.equal(p.quote, 'OpenAI said “GPT-6 ships in spring” — analysts doubt it');
  assert.equal(p.start, text.indexOf('OpenAI'));
  assert.ok(K.findPassage(text, 'Revenue grew 40%  in 2025'), 'extra spaces are fine');
  assert.equal(K.findPassage(text, 'Revenue fell sharply in 2025'), null);
  assert.equal(K.findPassage(text, 'short'), null);
});

test('reading the extraction: types, relations and claims checked', () => {
  const text = 'Anthropic released Claude 5 in October. Sam Altman, who runs OpenAI, called it impressive. Critics say the benchmarks are cherry-picked.';
  const reply = JSON.stringify({
    entities: [{ name: 'Anthropic', type: 'company' }, { name: 'Claude 5', type: 'product' }, { name: 'Sam Altman', type: 'person' }, { name: 'OpenAI', type: 'organization' }, { name: 'Open AI', type: 'company' }, { name: 'benchmarks', type: 'metric' }],
    relations: [{ from: 'Claude 5', type: 'made by', to: 'Anthropic' }, { from: 'Sam Altman', type: 'works-for', to: 'OpenAI' }, { from: 'Claude 5', type: 'beats', to: 'OpenAI' }, { from: 'Claude 5', type: 'part-of', to: 'Google' }],
    claims: [
      { claim: 'Anthropic released Claude 5 in October.', quote: 'Anthropic released Claude 5 in October.', about: ['Anthropic', 'Claude 5'], stance: 'neutral' },
      { claim: 'Critics doubt the benchmarks.', quote: 'Critics say the benchmarks are cherry-picked', about: ['Claude 5'], stance: 'against' },
      { claim: 'It was the best model ever.', quote: 'It is the best model ever made.', about: ['Claude 5'] },
    ],
  });
  const x = K.parseExtraction('```json\n' + reply + '\n```', text);
  assert.deepEqual(x.entities.map((e) => `${e.name}:${e.type}`), ['Anthropic:company', 'Claude 5:product', 'Sam Altman:person', 'OpenAI:company', 'benchmarks:concept']);
  assert.deepEqual(x.relations, [{ from: 'Claude 5', rel: 'made-by', to: 'Anthropic' }, { from: 'Sam Altman', rel: 'works-for', to: 'OpenAI' }]);
  assert.equal(x.claims.length, 2, 'the made-up quote is dropped');
  assert.equal(x.claims[1].stance, 'against');
  assert.equal(x.claims[1].quote, 'Critics say the benchmarks are cherry-picked');
  assert.deepEqual(K.parseExtraction('not json', text), { entities: [], relations: [], claims: [] });
});

test('comparisons name real claims only', () => {
  const pairs = K.parseComparison('{"pairs": [{"new": "N1", "old": "E2", "relation": "contradicts"}, {"new": "N9", "old": "E1", "relation": "supports"}, {"new": "N2", "old": "E1", "relation": "related"}, {"new": "N1", "old": "E2", "relation": "contradicts"}]}', ['a#0', 'a#1'], ['b#0', 'b#1']);
  assert.deepEqual(pairs, [{ a: 'a#0', b: 'b#1', rel: 'contradicts' }]);
  const checks = K.parseComparison('{"checks": [{"new": "N1", "contradicts": ["E2"], "supports": []}, {"new": "N2", "contradicts": [], "supports": ["E1", "E7"]}]}', ['a#0', 'a#1'], ['b#0', 'b#1']);
  assert.deepEqual(checks, [{ a: 'a#0', b: 'b#1', rel: 'contradicts' }, { a: 'a#1', b: 'b#0', rel: 'supports' }]);
});

const notes = [
  { id: 'n1', createdAt: '2026-09-01T10:00:00Z', url: 'https://a.example/1', title: 'One' },
  { id: 'n2', createdAt: '2026-10-12T10:00:00Z', url: 'https://b.example/2', title: 'Two' },
  { id: 'n3', createdAt: '2026-10-20T10:00:00Z', url: 'https://c.example/3', title: 'Three' },
];
const extractions = {
  n1: { entities: [{ name: 'OpenAI', type: 'company' }, { name: 'GPT-6', type: 'product' }], relations: [{ from: 'GPT-6', rel: 'made-by', to: 'OpenAI' }], claims: [{ text: 'GPT-6 ships in spring.', quote: 'GPT-6 ships in spring', start: 0, about: ['GPT-6'], stance: 'neutral' }] },
  n2: { entities: [{ name: 'Open AI', type: 'company' }, { name: 'GPT 6', type: 'product' }, { name: 'Anthropic', type: 'company' }], relations: [{ from: 'Anthropic', rel: 'competes-with', to: 'Open AI' }], claims: [{ text: 'GPT-6 is delayed to autumn.', quote: 'delayed to autumn', start: 5, about: ['GPT 6'], stance: 'against' }] },
  n3: { entities: [{ name: 'openai.com', type: 'product' }], relations: [], claims: [] },
  gone: { entities: [{ name: 'Ghost', type: 'person' }], relations: [], claims: [] },
};
const comparisons = { n2: { pairs: [{ a: 'n2#0', b: 'n1#0', rel: 'contradicts' }] } };

test('the graph: entities merged across snippets, typed relations, claims linked over time', () => {
  const kg = K.buildKG({ notes, extractions, comparisons });
  const openai = kg.entities.get('openai');
  assert.equal(openai.name, 'OpenAI', 'the most used spelling (ties: the shortest)');
  assert.deepEqual(openai.aliases.sort(), ['Open AI', 'openai.com']);
  assert.equal(openai.type, 'company', 'the most common type');
  assert.deepEqual(openai.noteIds, ['n1', 'n2', 'n3']);
  assert.equal(openai.first, '2026-09-01T10:00:00Z');
  assert.equal(openai.last, '2026-10-20T10:00:00Z');
  assert.ok(!kg.entities.has('ghost'), 'extractions of deleted snippets are ignored');
  assert.equal(kg.entities.get('gpt6').claimIds.length, 2);
  assert.deepEqual(kg.relations.map((r) => `${r.a} ${r.rel} ${r.b}`).sort(), ['anthropic competes-with openai', 'gpt6 made-by openai']);
  assert.deepEqual(kg.claims.get('n1#0').contradicts, ['n2#0']);
  const d = K.disagreements(kg, 'gpt6');
  assert.equal(d.length, 1);
  assert.equal(d[0].a.id, 'n2#0', 'the newer side first');
  assert.deepEqual(K.claimTimeline([...kg.claims.values()]).map((g) => g.month), ['September 2026', 'October 2026']);
  assert.deepEqual(K.rankEntities(kg).map((e) => e.key).slice(0, 2), ['openai', 'gpt6']);
  assert.deepEqual(K.rankEntities(kg, { query: 'open ai' }).map((e) => e.key), ['openai'], 'aliases are searched');
  assert.deepEqual(K.neighbours(kg, 'openai').map((n) => [n.key, n.rels.join()]), [['gpt6', 'makes'], ['anthropic', 'competes with']]);
});

test('the user corrects the graph: merge, split, rename, retype, hide (and nothing is lost)', () => {
  let edits = K.mergeEdit(K.EMPTY_EDITS, 'anthropic', 'openai');
  let kg = K.buildKG({ notes, extractions, comparisons, edits });
  assert.ok(!kg.entities.has('anthropic'));
  assert.deepEqual(kg.entities.get('openai').noteIds, ['n1', 'n2', 'n3']);
  assert.ok(!kg.relations.some((r) => r.rel === 'competes-with'), 'a relation to itself goes');
  edits = K.mergeEdit(edits, 'openai', 'gpt6');
  assert.equal(edits.merges.anthropic, 'gpt6', 'what was merged follows');
  edits = K.mergeEdit(edits, 'gpt6', 'openai');
  assert.equal(K.resolveKey('Anthropic', edits), 'openai', 'no loops');
  edits = { ...K.EMPTY_EDITS };
  edits = K.splitEdit(edits, 'openai.com');
  kg = K.buildKG({ notes, extractions, comparisons, edits });
  assert.deepEqual(kg.entities.get('openai').aliases, ['Open AI']);
  const split = [...kg.entities.values()].find((e) => e.name === 'openai.com');
  assert.ok(split && split.key !== 'openai');
  assert.equal(split.type, 'product');
  edits = K.setEdit(edits, 'names', 'openai', 'OpenAI (company)');
  edits = K.setEdit(edits, 'types', 'gpt6', 'concept');
  edits = K.setEdit(edits, 'hidden', 'anthropic', true);
  kg = K.buildKG({ notes, extractions, comparisons, edits });
  assert.equal(kg.entities.get('openai').name, 'OpenAI (company)');
  assert.equal(kg.entities.get('gpt6').type, 'concept');
  assert.ok(!kg.entities.has('anthropic'));
  edits = K.setEdit(edits, 'hidden', 'anthropic', false);
  assert.ok(K.buildKG({ notes, extractions, comparisons, edits }).entities.has('anthropic'), 'undone');
});

test('links to the exact passage, and what needs extracting', () => {
  assert.equal(K.passageUrl('https://a.example/p#top', 'GPT-6 ships in spring'), 'https://a.example/p#:~:text=GPT%2D6%20ships%20in%20spring');
  assert.equal(K.passageUrl('https://a.example/p', 'one two three four five six seven eight nine ten eleven, twelve'), 'https://a.example/p#:~:text=one%20two%20three%20four%20five,eight%20nine%20ten%20eleven%2C%20twelve');
  assert.equal(K.passageUrl('file:///x', 'a'), '');
  const long = 'x'.repeat(100);
  const q = K.extractionQueue([{ id: 'a', text: long, createdAt: '1' }, { id: 'b', text: long, createdAt: '2' }, { id: 'c', text: 'short', createdAt: '3' }, { id: 'd', kind: 'research', text: long }], { a: { hash: K.textHash(long) } });
  assert.deepEqual(q.map((n) => n.id), ['b']);
  assert.notEqual(K.textHash('a'), K.textHash('b'));
});

test('the graph prompts keep their shape', () => {
  const [, extract] = S.buildMessages('extract', { title: 'T', url: 'u', content: 'Body' }, {});
  assert.match(extract.content, /"entities"/);
  assert.match(extract.content, /copied exactly/);
  const [, cmp] = S.buildMessages('compareClaims', { content: 'N1 …', context: 'E1 …' }, {});
  assert.match(cmp.content, /"checks"/);
  const [sys] = S.buildMessages('topicPage', { question: 'OpenAI (company)', content: '[1] …' }, {});
  assert.match(sys.content, /Never add facts/);
});

test('what the AI is given to compare claims and to write a topic page', () => {
  const kg = K.buildKG({ notes, extractions, comparisons });
  const byId = new Map(notes.map((n) => [n.id, n]));
  const cmp = K.compareInput(kg, 'n2', byId);
  assert.equal(cmp.content, 'N1. GPT-6 is delayed to autumn.');
  assert.equal(cmp.context, 'E1. GPT-6 ships in spring. (1 Sept 2026, a.example)');
  assert.deepEqual([cmp.newIds, cmp.oldIds], [['n2#0'], ['n1#0']]);
  assert.equal(K.compareInput(kg, 'n1', byId), null, 'nothing older to compare with');
  const page = K.topicPageInput(kg, 'gpt6', byId);
  assert.equal(page.question, 'GPT-6 (Product)');
  assert.deepEqual(page.cites, ['n1#0', 'n2#0']);
  assert.match(page.content, /^\[1\] 1 Sept 2026, a\.example: GPT-6 ships in spring\. \(contradicts \[2\]\)/);
  const company = K.topicPageInput(kg, 'openai', new Map(notes.map((n) => [n.id, { ...n, summary: 'About OpenAI.' }])));
  assert.deepEqual(company.cites, ['note:n1', 'note:n2', 'note:n3'], 'no claims: its snippets instead');
});

test('relations stated the wrong way round are turned; ones between the wrong kinds of thing go', () => {
  const text = 'Tomás Ortega is chief scientist at Helix AI, which makes Atlas 2 (MMLU leader). Sparse Routing builds on Switch Transformer.';
  const reply = JSON.stringify({
    entities: [{ name: 'Helix AI', type: 'company' }, { name: 'Tomás Ortega', type: 'person' }, { name: 'Atlas 2', type: 'product' }, { name: 'MMLU', type: 'concept' }, { name: 'Sparse Routing', type: 'paper' }, { name: 'Switch Transformer', type: 'paper' }],
    relations: [
      { from: 'Helix AI', type: 'works-for', to: 'Tomás Ortega' },
      { from: 'Atlas 2', type: 'part-of', to: 'MMLU' },
      { from: 'Atlas 2', type: 'part-of', to: 'Helix AI' },
      { from: 'Helix AI', type: 'made-by', to: 'Atlas 2' },
      { from: 'Sparse Routing', type: 'cites', to: 'Switch Transformer' },
    ],
    claims: [{ claim: 'Sparse Routing builds on earlier work.', quote: 'Sparse Routing builds on Switch Transformer', about: [] }],
  });
  const x = K.parseExtraction(reply, text);
  assert.deepEqual(x.relations.map((r) => `${r.from} ${r.rel} ${r.to}`), ['Tomás Ortega works-for Helix AI', 'Atlas 2 made-by Helix AI', 'Sparse Routing cites Switch Transformer']);
  assert.deepEqual(x.claims[0].about, ['Sparse Routing', 'Switch Transformer'], 'a claim linked to nothing gets the entities it names');
});

test('pair checks, and names mangled by the model are repaired', () => {
  assert.equal(K.parseCheck('{"relation": "Contradicts"}'), 'contradicts');
  assert.equal(K.parseCheck('{"relation": "neither"}'), '');
  assert.equal(K.parseCheck('nonsense'), '');
  const x = K.parseExtraction(JSON.stringify({ entities: [{ name: 'TomÃ¡s Ortega', type: 'person' }] }), '');
  assert.equal(x.entities[0].name, 'Tomás Ortega');
  assert.equal(K.entityKey(x.entities[0].name), K.entityKey('Tomás Ortega'));
});

test('entities the text never names, and dates, are dropped', () => {
  const text = 'Nimbus Labs delayed Atlas 2 to 2027, Priya Raman said in August.';
  const x = K.parseExtraction(JSON.stringify({ entities: [{ name: 'Nimbus Labs', type: 'company' }, { name: 'OpenAI', type: 'company' }, { name: 'Sam Altman', type: 'person' }, { name: 'August', type: 'concept' }, { name: '2027', type: 'concept' }, { name: 'Ms. Raman', type: 'person' }, { name: 'Atlas 2 model', type: 'product' }] }), text);
  assert.deepEqual(x.entities.map((e) => e.name), ['Nimbus Labs', 'Ms. Raman', 'Atlas 2 model']);
});

test('claims are compared only with models big enough to do it', () => {
  assert.equal(K.canCompare({ api: 'ollama', model: 'llama3.2:3b' }), false);
  assert.equal(K.canCompare({ api: 'ollama', model: 'qwen2.5:1.5b' }), false);
  assert.equal(K.canCompare({ api: 'browser', model: 'nano' }), false);
  assert.equal(K.canCompare({ api: 'ollama', model: 'qwen2.5:14b' }), true);
  assert.equal(K.canCompare({ api: 'ollama', model: 'mixtral:8x7b' }), true);
  assert.equal(K.canCompare({ api: 'anthropic', model: 'claude-sonnet-5-5' }), true);
  assert.equal(K.canCompare({ api: 'openai', model: 'gpt-5.5-mini' }), true);
});

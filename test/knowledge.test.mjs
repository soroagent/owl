import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/markdown.js', 'shared/snippets.js', 'shared/knowledge.js');

const day = (d) => `2026-10-${String(d).padStart(2, '0')}T10:00:00.000Z`;
const NOTES = [
  { id: 'a1', kind: 'summary', title: 'How AI agents use tools', summary: 'Agents call tools in a loop with planning and memory.', tags: ['ai-agents', 'llm'], text: 'AI agents plan, call tools, observe results and keep memory. Tool use and planning loops matter.', url: 'https://blog.example/agents-tools', createdAt: day(20) },
  { id: 'a2', kind: 'summary', title: 'Multi-agent systems: when do agents beat a single model?', summary: 'Multi-agent setups help for parallel research but cost more tokens.', tags: ['ai-agents'], text: 'Agents coordinating via an orchestrator. Evaluation of agent reliability and planning.', url: 'https://news.example/multi-agent', createdAt: day(15) },
  { id: 'a3', kind: 'page', title: 'Agent memory architectures', summary: 'Long-term memory for LLM agents.', tags: [], text: '', url: 'https://papers.example/agent-memory', createdAt: day(2) },
  { id: 'b1', kind: 'summary', title: 'Sourdough starter basics', summary: 'Feed the starter flour and water daily.', tags: ['baking'], text: 'Hydration, flour, fermentation and oven spring.', url: 'https://food.example/sourdough', createdAt: day(18) },
  { id: 'b2', kind: 'summary', title: 'Marathon training plan', summary: 'Long runs, tempo runs and tapering.', tags: ['running'], text: 'Weekly mileage, recovery and race pace.', url: 'https://run.example/plan', createdAt: day(10) },
];

test('words are normalized so related wording meets', () => {
  assert.deepEqual(S.tokenize('The Agents are planning tools!'), ['agent', 'plann', 'tool']);
  assert.ok(!S.tokenize('this and that with the').length, 'stop words are dropped');
});

test('notes about the same topic as a page are found, unrelated ones are not', () => {
  const index = S.buildIndex(NOTES);
  const page = 'Building reliable AI agents: tools, planning and memory. Agent frameworks let an LLM call tools in a loop, plan steps and remember results.';
  const hits = S.relatedNotes(index, page, { excludeUrl: 'https://new.example/article' });
  const ids = hits.map((h) => h.note.id);
  assert.ok(ids.length >= 2 && ids.length <= 3, `found ${ids}`);
  assert.ok(ids.every((id) => id.startsWith('a')), `only agent notes: ${ids}`);
  assert.deepEqual(S.relatedNotes(index, 'A recipe for banana bread with walnuts and cinnamon.'), []);
});

test('the page you are on is never "related" to itself, and time ranges apply', () => {
  const index = S.buildIndex(NOTES);
  const hits = S.searchNotes(index, 'AI agents tools planning memory', { excludeUrl: 'https://blog.example/agents-tools#top' });
  assert.ok(!hits.some((h) => h.note.id === 'a1'));
  const recent = S.searchNotes(index, 'agents', { since: day(14) });
  assert.deepEqual(recent.map((h) => h.note.id).sort(), ['a1', 'a2'], 'the Oct 2 note is outside "since Oct 14"');
});

test('notes are numbered for citation with date, site and kind', () => {
  const block = S.formatNotes([NOTES[0], NOTES[2]]);
  assert.match(block, /^\[S1\] How AI agents use tools \(saved 2026-10-20, blog\.example, summary\)/);
  assert.match(block, /\[S2\] Agent memory architectures \(saved 2026-10-02, papers\.example, saved page\)/);
  assert.match(S.formatNotes([NOTES[0]], { prefix: 'N' }), /^\[N1\]/);
  assert.ok(S.formatNotes(NOTES.slice(0, 5), { total: 300 }).length < 600, 'long note sets are capped');
});

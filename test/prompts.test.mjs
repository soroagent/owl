import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, promptFiles } from './helpers.mjs';

const S = await load('shared/markdown.js', 'shared/prompts.js', ...promptFiles);

test('parseJsonLoose handles fences, chatter and think blocks', () => {
  assert.deepEqual(S.parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(S.parseJsonLoose('```json\n{"a": [1, 2]}\n```'), { a: [1, 2] });
  assert.deepEqual(S.parseJsonLoose('<think>{no}</think>Sure! {"x": [3], "note": "a } b"} done'), { x: [3], note: 'a } b' });
  assert.deepEqual(S.parseJsonLoose('I should return {"labels"} for each…\n</think>\n{"labels": {"1": "keep"}}'), { labels: { 1: 'keep' } });
  assert.equal(S.parseJsonLoose('no json here'), null);
});

test('parseSnippetMeta cleans fields and falls back to the page title', () => {
  const meta = S.parseSnippetMeta('{"title": "  Rust  async\\n", "summary": "Short.", "tags": ["#Rust", "rust", "Async", "", "a", "b"]}', 'Page');
  assert.deepEqual(meta, { title: 'Rust async', summary: 'Short.', tags: ['rust', 'async', 'a', 'b'] });
  assert.equal(S.parseSnippetMeta('oops', 'Page title').title, 'Page title');
});

test('buildMessages renders placeholders and layers default < site file < inline', () => {
  const vars = S.pageVars({ title: 'T', url: 'https://x.test', text: 'Body', truncated: true }, { context: 'CTX', count: 3 });
  const [system, user] = S.buildMessages('summarize', vars);
  assert.match(system.content, /^You are soroagent/);
  assert.match(user.content, /<page>\nBody\n<\/page>\n\[Content was truncated/);

  const inline = { summarize: { user: '{{context}} | {{count}} | {{content}} | {{missing}}' } };
  const [siteSystem, siteUser] = S.buildMessages('summarize', vars, inline);
  assert.equal(siteSystem.content, system.content, 'system falls back to the default');
  assert.equal(siteUser.content, 'CTX | 3 | Body |');

  // prompts/x.js overrides the user prompt for save but keeps the default system prompt.
  const x = S.promptsFor('x');
  assert.match(x.save.user, /A post from X/);
  assert.equal(x.save.system, S.promptsFor('default').save.system);
  assert.equal(S.promptsFor('x', { save: { user: 'inline' } }).save.user, 'inline');
  assert.equal(S.promptsFor('no-such-site').summarize.user, S.promptsFor('default').summarize.user);

  const ask = S.buildMessages('ask', { ...vars, question: 'Why?' });
  assert.equal(ask[1].content, 'Why?');
  assert.throws(() => S.buildMessages('nope', vars), /Unknown prompt action/);
  assert.throws(() => S.definePrompts('bad', { summarise: {} }), /unknown action "summarise"/);
  assert.throws(() => S.definePrompts('bad', { pages: { thread: { sumarize: {} } } }), /bad.pages.thread.*unknown action "sumarize"/);

  // Page-type prompts: Reddit threads get their own summarize prompt; feeds use the site's.
  const feed = S.promptsFor('reddit', null, 'subreddit');
  const thread = S.promptsFor('reddit', null, 'thread');
  assert.match(feed.summarize.user, /Summarize these \{\{count\}\} posts/);
  assert.match(thread.summarize.user, /Summarize this discussion/);
  assert.equal(thread.save.user, feed.save.user, 'other actions are shared');
  assert.equal(thread.pages, undefined);
});

test('research topics are short, distinct phrases from the model reply', async () => {
  const P = S;
  assert.deepEqual(P.parseTopics('```json\n{"topics": ["Qwen 3 benchmarks", "qwen 3 benchmarks", "  MoE routing.  ", ""]}\n```'), ['Qwen 3 benchmarks', 'MoE routing']);
  assert.deepEqual(P.parseTopics('[{"topic": "A"}, "B"]'), ['A', 'B']);
  assert.deepEqual(P.parseTopics('{"topics": ["1. 2024 election polls", "- \\"Quoted\\""]}'), ['2024 election polls', 'Quoted']);
  assert.deepEqual(P.parseTopics('no json here'), []);
  assert.equal(P.parseTopics(JSON.stringify({ topics: ['1', '2', '3', '4', '5', '6', '7'] })).length, 5);
});

test('pageKind: the page describes itself (JSON-LD, og:type), then the site, then the URL', () => {
  assert.equal(S.pageKind({ ldTypes: ['Organization', 'Product'] }).kind, 'product');
  assert.equal(S.pageKind({ ldTypes: ['https://schema.org/NewsArticle'] }).kind, 'news');
  assert.equal(S.pageKind({ ldTypes: ['BlogPosting'] }).kind, 'article');
  assert.equal(S.pageKind({ ogType: 'product' }).kind, 'product');
  assert.equal(S.pageKind({ siteId: 'reddit', pageType: 'thread' }).kind, 'thread');
  assert.equal(S.pageKind({ siteId: 'github', pageType: 'repo' }).kind, 'code');
  assert.equal(S.pageKind({ siteId: 'amazon' }).kind, 'product');
  assert.equal(S.pageKind({ url: 'https://shop.example.com/products/blue-kettle' }).kind, 'product');
  assert.equal(S.pageKind({ url: 'https://example.com/docs/install' }).kind, 'docs');
  assert.equal(S.pageKind({}).kind, 'page');
  assert.match(S.pageKind({ ldTypes: ['NewsArticle'] }).describe, /background.*main people/);
  assert.match(S.pageKind({ ldTypes: ['Product'] }).describe, /how it works/);
});

test('parseQuestions keeps 2 to 4 short, distinct questions', () => {
  const reply = '```json\n{"questions": ["1. What does the X200 kettle include?", "How does the auto shut-off work", "what does the x200 kettle include?", "Why?", "' + 'a'.repeat(140) + '", "Which kettles compare on price and noise?", "Is the warranty worth it?"]}\n```';
  assert.deepEqual(S.parseQuestions(reply), [
    'What does the X200 kettle include?',
    'How does the auto shut-off work?',
    'Which kettles compare on price and noise?',
    'Is the warranty worth it?',
  ]);
  assert.deepEqual(S.parseQuestions('no json'), []);
});

test('the questions prompt gets the page and what kind of page it is', () => {
  const messages = S.buildMessages('questions', S.pageVars({ title: 'Kettle', url: 'https://x.test/p', text: 'A kettle.' }, { context: S.pageKind({ ldTypes: ['Product'] }).describe }), {});
  const user = messages.find((m) => m.role === 'user').content;
  assert.match(user, /<page>\nA kettle\.\n<\/page>/);
  assert.match(user, /This is a product page in an online store/);
  assert.match(user, /"questions"/);
  assert.doesNotMatch(user, /\{\{/);
});

test('questions the page cannot answer become a web search (marker or plain words), others do not', () => {
  const q = "what is GoDaddy's revenue?";
  assert.deepEqual(S.parseWebRequest('[[search: GoDaddy annual revenue 2025]]', q), { query: 'GoDaddy annual revenue 2025', explicit: true });
  assert.deepEqual(S.parseWebRequest(' [[ Search : "GoDaddy revenue" ]] and more', q), { query: 'GoDaddy revenue', explicit: true });
  assert.deepEqual(S.parseWebRequest("The provided text does not contain information regarding GoDaddy's revenue.", q), { query: "what is GoDaddy's revenue", explicit: false });
  assert.deepEqual(S.parseWebRequest("The article doesn't mention GoDaddy's revenue.", q).explicit, false);
  assert.equal(S.parseWebRequest('GoDaddy reported revenue of $4.6 billion for 2025 [1].', q).query, '');
  assert.equal(S.parseWebRequest('No, the author does not recommend it, because the page says it is slow.'.repeat(6), q).query, '', 'long answers are answers');
  assert.equal(S.parseWebRequest("The text doesn't say.", '').query, '', 'needs a question to search for');
  // Streaming: hold back only what could still become the marker.
  for (const p of ['', '[', '[[', '[[sea', '[[search', '[[search: GoDa']) assert.equal(S.mayBeWebRequest(p), true, JSON.stringify(p));
  for (const p of ['The', 'GoDaddy', '[link]', '1.']) assert.equal(S.mayBeWebRequest(p), false, JSON.stringify(p));
});

test('every ask prompt asks for [[search: …]] when the answer is not there; webAnswer cites sources', () => {
  for (const site of ['default', 'x', 'reddit']) {
    const msgs = S.buildMessages('ask', S.pageVars({ title: 't', url: 'u', text: 'body' }, { question: 'q' }), S.promptsFor(site, {}, 'page'));
    assert.match(msgs[0].content, /\[\[search: a short web search query/, site);
  }
  const msgs = S.buildMessages('webAnswer', S.pageVars({ title: 'Reading page', url: 'u', text: '[1] GoDaddy IR\nURL: https://x\nRevenue $4.6B' }, { question: "what is GoDaddy's revenue?" }), {});
  const user = msgs.find((m) => m.role === 'user').content;
  assert.match(msgs[0].content, /cite them inline as \[n\]/);
  assert.match(user, /Question: what is GoDaddy's revenue\?/);
  assert.match(user, /<sources>\n\[1\] GoDaddy IR/);
  assert.doesNotMatch(user, /\{\{/);
});

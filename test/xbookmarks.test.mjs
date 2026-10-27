import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/markdown.js', 'shared/prompts.js', 'prompts/default.js', 'shared/xbookmarks.js');
const B = S.xBookmarks;
const at = (url) => new URL(url);

test('the X bookmarks page is recognised (and /i/history), nothing else', () => {
  for (const url of ['https://x.com/i/bookmarks', 'https://x.com/i/bookmarks/1849012345678901234', 'https://twitter.com/i/bookmarks', 'https://x.com/i/history']) assert.ok(B.isBookmarksPage(at(url)), url);
  for (const url of ['https://x.com/home', 'https://x.com/i/lists/123', 'https://x.com/bookmarks', 'https://example.com/i/bookmarks']) assert.ok(!B.isBookmarksPage(at(url)), url);
});

test('a bookmarked post becomes a snippet that is saved once', () => {
  const post = { id: '18', url: 'https://x.com/sama/status/18', handle: '@sama', name: 'Sam Altman', text: 'We just shipped GPT-5.5 to everyone, with a 1M token context window and much faster responses for all users today.', time: '2026-10-24T09:00:00Z' };
  const s = B.bookmarkSnippet(post, { now: '2026-10-27T10:00:00.000Z', tags: ['ai'] });
  assert.equal(s.dedupeKey, 'xbookmark:18');
  assert.equal(s.url, post.url);
  assert.match(s.title, /^@sama: We just shipped GPT-5\.5.*…$/);
  assert.ok(s.title.length <= 160);
  assert.equal(s.pageTitle, 'Sam Altman (@sama) on X');
  assert.equal(s.text, post.text);
  assert.deepEqual(s.tags, ['ai']);
  assert.equal(s.postedAt, post.time);
  assert.equal(B.bookmarkSnippet({ id: '2', url: 'u', handle: '@a', text: '', hasMedia: true }).text, '[media only]');
  assert.equal(B.bookmarkHandle({ handle: '', url: 'https://x.com/karpathy/status/19' }), '@karpathy', 'the handle from the address when the page had none');
  assert.equal(B.bookmarkHandle({ url: 'nope' }), '@unknown');
});

test('topic tags for a batch: tidied, at most three, one list per post', () => {
  assert.deepEqual(B.parseTagBatch('```json\n{"tags": {"1": ["AI Agents", "#rust", "x", "ai agents", "tools", "more"], "3": ["Baking"]}}\n```', 3), [['ai-agents', 'rust', 'tools'], [], ['baking']]);
  assert.deepEqual(B.parseTagBatch('[["ai"], ["chips"]]', 2), [['ai'], ['chips']]);
  assert.deepEqual(B.parseTagBatch('not json', 2), [[], []]);
  const [, user] = S.buildMessages('tagBatch', { content: '[1] @a GPU news', context: 'ai, chips' }, {});
  assert.match(user.content, /\[1\] @a GPU news/);
  assert.match(user.content, /already in the user's knowledge base: ai, chips/);
});

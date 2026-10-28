import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/markdown.js', 'shared/prompts.js', 'prompts/default.js', 'shared/feeds.js');
const B = S.feeds;
const at = (url) => new URL(url);

test('the X bookmarks page is recognised (and /i/history), nothing else', () => {
  for (const url of ['https://x.com/i/bookmarks', 'https://x.com/i/bookmarks/1849012345678901234', 'https://twitter.com/i/bookmarks', 'https://x.com/i/history']) assert.ok(B.isBookmarksPage(at(url)), url);
  for (const url of ['https://x.com/home', 'https://x.com/i/lists/123', 'https://x.com/bookmarks', 'https://example.com/i/bookmarks']) assert.ok(!B.isBookmarksPage(at(url)), url);
});

test('feeds offer summarize and save; bookmarks and likes save them all', () => {
  const home = B.feedActions('x', 'timeline');
  assert.equal(home.summarize, 'Summarize the top 100 posts');
  assert.equal(home.save, 'Save the top 100 posts to your PKG');
  assert.equal(home.limit, 100);
  assert.equal(B.feedActions('x', 'bookmarks').save, 'Save all bookmarks to your PKG');
  assert.equal(B.feedActions('x', 'likes').save, 'Save all likes to your PKG');
  assert.ok(B.feedActions('x', 'likes').all && B.feedActions('x', 'likes').limit > 1000);
  assert.equal(B.feedActions('linkedin', 'feed').summarize, 'Summarize the top 100 posts');
  for (const [site, type] of [['x', 'thread'], ['x', 'other'], ['linkedin', 'post'], ['linkedin', 'page'], ['reddit', 'timeline']]) assert.equal(B.feedActions(site, type), null, `${site} ${type}`);
});

test('a saved post becomes a snippet that is saved once', () => {
  const post = { id: '18', url: 'https://x.com/sama/status/18', handle: '@sama', name: 'Sam Altman', text: 'We just shipped GPT-5.5 to everyone, with a 1M token context window and much faster responses for all users today.', time: '2026-10-24T09:00:00Z' };
  const s = B.postSnippet(post, { now: '2026-10-27T10:00:00.000Z', tags: ['ai'] });
  assert.equal(s.dedupeKey, 'xbookmark:18', 'bookmarks keep their old key, so a re-sync still knows them');
  assert.equal(s.source, 'x-bookmark');
  assert.equal(s.url, post.url);
  assert.match(s.title, /^@sama: We just shipped GPT-5\.5.*…$/);
  assert.ok(s.title.length <= 160);
  assert.equal(s.pageTitle, 'Sam Altman (@sama) on X');
  assert.equal(s.text, post.text);
  assert.deepEqual(s.tags, ['ai']);
  assert.equal(s.postedAt, post.time);
  const liked = B.postSnippet(post, { pageType: 'likes' });
  assert.equal(liked.dedupeKey, 'xpost:18');
  assert.equal(liked.source, 'x-like');
  assert.deepEqual(B.postKeys('x', post, 'timeline'), ['xpost:18', 'xbookmark:18'], 'a post saved from either page counts as saved');
  const li = B.postSnippet({ id: 'urn:li:activity:7', url: 'https://www.linkedin.com/feed/update/urn:li:activity:7/', name: 'Priya Rao', headline: 'VP Engineering', text: 'We cut CI time in half.' }, { siteId: 'linkedin', pageType: 'feed' });
  assert.equal(li.dedupeKey, 'lipost:urn:li:activity:7');
  assert.equal(li.title, 'Priya Rao: We cut CI time in half.');
  assert.equal(li.pageTitle, 'Priya Rao (VP Engineering) on LinkedIn');
  assert.equal(li.site, 'LinkedIn');
  assert.equal(B.postSnippet({ id: '2', url: 'u', handle: '@a', text: '', hasMedia: true }).text, '[media only]');
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

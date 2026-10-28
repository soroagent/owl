import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/markdown.js', 'shared/prompts.js', 'prompts/default.js', 'shared/templates.js', 'shared/browse.js', 'shared/feeds.js', 'shared/pkg.js');
const B = S.browse;
const at = (url) => new URL(url);

test('news front pages and articles are told apart', () => {
  for (const url of ['https://www.bbc.com/', 'https://www.theguardian.com/world', 'https://www.ndtv.com/india', 'https://edition.cnn.com/business/tech']) assert.ok(B.isNewsFront(at(url)), url);
  for (const url of ['https://www.bbc.com/news/articles/c4gm2z1y3x8o', 'https://www.theguardian.com/world/2026/oct/27/some-story-title', 'https://www.ndtv.com/india-news/story-12345.html', 'https://example.com/']) assert.ok(!B.isNewsFront(at(url)), url);
  assert.ok(B.isNewsArticle(at('https://www.theguardian.com/world/2026/oct/27/some-story-title')));
  assert.ok(B.isNewsArticle(at('https://blog.example.com/2026/10/a-post'), 'news'), 'any page that calls itself news');
  assert.ok(!B.isNewsArticle(at('https://www.bbc.com/')));
  assert.ok(!B.isNewsArticle(at('https://example.com/docs/setup')));
});

test('headlines: sentence-like links to stories on the same site', () => {
  assert.ok(B.isHeadline('India win the third test by six wickets to level the series', 'https://www.bbc.com/sport/cricket/articles/c123', 'www.bbc.com'));
  assert.ok(!B.isHeadline('Sport', 'https://www.bbc.com/sport', 'www.bbc.com'), 'menu items');
  assert.ok(!B.isHeadline('India win the third test by six wickets to level the series', 'https://ads.example.net/click/123456789', 'www.bbc.com'), 'other sites');
  assert.ok(!B.isHeadline('Subscribe to our newsletter for the best of the week', 'https://www.bbc.com/newsletters/signup', 'www.bbc.com'));
  assert.ok(!B.isHeadline('Run this script now please friend', 'javascript:void(0)', 'www.bbc.com'));
  assert.equal(B.headlineKey('https://bbc.com/news/a-story/?utm=x#top'), 'https://bbc.com/news/a-story');
});

test("what's new: keys not seen last time, and the keys to keep", () => {
  assert.deepEqual(B.diffSeen(['a', 'b', 'c'], null), { fresh: [], keep: ['a', 'b', 'c'] }, 'a first visit marks nothing');
  const { fresh, keep } = B.diffSeen(['d', 'a', 'e', 'd'], ['a', 'b', 'c']);
  assert.deepEqual(fresh, ['d', 'e']);
  assert.deepEqual(keep, ['d', 'a', 'e', 'b', 'c']);
  assert.equal(B.diffSeen(['x'], Array.from({ length: 700 }, (_, i) => `k${i}`)).keep.length, 600, 'capped');
});

test('references become links: [n] to its story, [m:ss] to that moment', () => {
  const out = B.linkRefs('- Big story [1] [2]\n- At [12:34] and [1:02:03]\n- Unknown [9]\n- Linked [3](https://e.com)', { urls: ['https://bbc.com/a', 'javascript:x'], videoUrl: 'https://www.youtube.com/watch?v=abc' });
  assert.match(out, /\[1\]\(https:\/\/bbc\.com\/a\)/);
  assert.match(out, / \[2\] ?$/m, 'only web links');
  assert.match(out, /\[12:34\]\(https:\/\/www\.youtube\.com\/watch\?v=abc&t=754s\)/);
  assert.match(out, /\[1:02:03\]\(https:\/\/www\.youtube\.com\/watch\?v=abc&t=3723s\)/);
  assert.match(out, /Unknown \[9\]$/m);
  assert.match(out, /\[3\]\(https:\/\/e\.com\)/);
  assert.equal(B.linkRefs('at [1:00]', {}), 'at [1:00]', 'times link only on a video');
});

test('clutter names', () => {
  for (const name of ['related-stories', 'newsletter-signup', 'comments', 'OUTBRAIN', 'most-popular', 'mostRead', 'sponsored-content', 'taboola-below-article', 'read-more box']) assert.ok(B.isClutterName(name), name);
  for (const name of ['article-body', 'story-content', 'byline', 'main', 'commentary-intro', 'paragraph']) assert.ok(!B.isClutterName(name), name);
});

test('Reddit, Hacker News and YouTube feeds get their actions', () => {
  assert.equal(S.feeds.feedActions('reddit', 'subreddit').summarize, 'Summarize the top 100 posts');
  assert.equal(S.feeds.feedActions('hackernews', 'list').summarize, 'Summarize the top 100 stories');
  assert.equal(S.feeds.feedActions('hackernews', 'list').save, 'Save the top 100 stories to your PKG');
  const yt = S.feeds.feedActions('youtube', 'subscriptions');
  assert.equal(yt.summarize, 'Summarize the top 50 videos');
  assert.equal(yt.save, '', 'videos are summarized, not saved');
  assert.equal(S.feeds.feedActions('reddit', 'thread'), null);
  const hn = S.feeds.postSnippet({ id: '42', title: 'Show HN: a tiny database', url: 'https://example.com/db', discussion: 'https://news.ycombinator.com/item?id=42' }, { siteId: 'hackernews', pageType: 'list' });
  assert.equal(hn.dedupeKey, 'hnstory:42');
  assert.equal(hn.url, 'https://news.ycombinator.com/item?id=42');
  assert.equal(hn.title, 'Show HN: a tiny database');
  const rd = S.feeds.postSnippet({ id: 't3_x', title: 'Rust 2.0 announced', subreddit: 'r/rust', text: 'Details inside.', url: 'https://www.reddit.com/r/rust/comments/x/' }, { siteId: 'reddit', pageType: 'subreddit' });
  assert.equal(rd.dedupeKey, 'rdpost:t3_x');
  assert.equal(rd.pageTitle, 'Rust 2.0 announced · r/rust');
});

test('the page action prompts render with their parts', () => {
  const page = S.pageVars({ title: 'A story', url: 'https://bbc.com/a', text: 'Body' });
  const [, front] = S.buildMessages('frontPage', { ...page, content: '[1] Headline one' }, {});
  assert.match(front.content, /\[1\] Headline one/);
  assert.match(front.content, /5 stories/);
  assert.match(S.buildMessages('gist', page, {})[1].content, /\*\*Confirmed\*\*[\s\S]*\*\*Claimed\*\*/);
  assert.match(S.buildMessages('timeline', { ...page, context: '[N1] An earlier note' }, {})[1].content, /\[N1\] An earlier note/);
  assert.match(S.buildMessages('bestComments', page, {})[1].content, /5 best comments/);
  assert.match(S.buildMessages('chapters', page, {})[1].content, /\[m:ss\]/);
});

test('daily digest: by first topic, within the day', () => {
  const now = new Date('2026-10-28T15:00:00');
  const snip = (id, hoursAgo, tags = [], site = 'X') => ({ id, title: id, tags, site, createdAt: new Date(now.getTime() - hoursAgo * 3600e3).toISOString() });
  const all = [snip('a', 1, ['AI', 'chips']), snip('b', 2, ['ai']), snip('c', 3, ['rust'], 'HN'), snip('d', 4), snip('old', 30, ['ai'])];
  const today = S.dailyDigest(all, { from: S.dayStart(now, 0) });
  assert.equal(today.count, 4);
  assert.equal(today.sites, 2);
  assert.deepEqual(today.topics.map((t) => [t.topic, t.items.map((s) => s.id)]), [['ai', ['a', 'b']], ['rust', ['c']]]);
  assert.deepEqual(today.other.map((s) => s.id), ['d']);
  const yesterday = S.dailyDigest(all, { from: S.dayStart(now, 1), to: S.dayStart(now, 0) });
  assert.deepEqual(yesterday.topics.map((t) => t.topic), ['ai']);
});

test('"(4, 15)" lists of item numbers become links too, years and other numbers stay', () => {
  const urls = ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'];
  assert.equal(B.linkRefs('Floods (1, 3).', { urls }), 'Floods [1](https://a.com/1) [3](https://a.com/3).');
  assert.equal(B.linkRefs('Since (1952) and (2, 9)', { urls }), 'Since (1952) and (2, 9)');
  assert.equal(B.linkRefs('Since (2)', {}), 'Since (2)');
});

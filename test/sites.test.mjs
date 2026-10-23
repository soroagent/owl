import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load, root, promptFiles } from './helpers.mjs';

const siteFiles = readdirSync(join(root, 'extension/sites')).filter((f) => f.endsWith('.js') && !f.startsWith('_') && f !== 'registry.js');
const S = await load('shared/markdown.js', 'shared/prompts.js', ...promptFiles, 'sites/registry.js', ...siteFiles.map((f) => `sites/${f}`));
const loc = (url) => new URL(url);

test('every site profile registers with valid prompts and options', () => {
  const ids = S.siteProfiles.map((p) => p.id);
  assert.ok(ids.includes('x') && ids.includes('reddit'));
  assert.equal(new Set(ids).size, ids.length);
  for (const profile of S.siteProfiles) {
    const prompts = S.promptsFor(profile.id, profile.prompts);
    for (const action of S.PROMPT_ACTIONS) {
      // Every action renders for every site without throwing.
      assert.ok(S.buildMessages(action, S.pageVars({ title: 't', url: 'u', text: 'c' }), prompts).length > 0, `${profile.id}.${action}`);
    }
    for (const option of profile.options || []) assert.ok(option.id && option.label, `${profile.id}: option needs id and label`);
  }
});

test('siteFor matches X hosts and falls back to the default profile', () => {
  assert.equal(S.siteFor(loc('https://x.com/home')).id, 'x');
  assert.equal(S.siteFor(loc('https://mobile.twitter.com/someone')).id, 'x');
  assert.equal(S.siteFor(loc('https://example.com/')).id, 'default');
  assert.equal(S.siteFor(loc('https://notx.com/')).id, 'default');
});

test('siteOptionValues merges defaults with saved values', () => {
  const x = S.siteFor(loc('https://x.com/'));
  assert.deepEqual(S.siteOptionValues(x, {}), { verifiedOnly: false });
  assert.deepEqual(S.siteOptionValues(x, { siteOptions: { x: { verifiedOnly: true } } }), { verifiedOnly: true });
});

test('X page detection', () => {
  const { pageInfo } = S.siteHelpers.x;
  const search = pageInfo(loc('https://x.com/search?q=local%20llm&src=typed_query&f=live'));
  assert.equal(search.type, 'search');
  assert.equal(search.query, 'local llm');
  assert.match(search.context, /latest posts from X search results for the query "local llm"/);
  assert.equal(pageInfo(loc('https://x.com/jack/status/20')).type, 'thread');
  assert.equal(pageInfo(loc('https://x.com/home')).type, 'timeline');
  assert.equal(pageInfo(loc('https://x.com/jack')).type, 'profile');
  assert.equal(pageInfo(loc('https://x.com/jack/with_replies')).type, 'profile');
  assert.equal(pageInfo(loc('https://x.com/explore')).type, 'other');
  assert.equal(pageInfo(loc('https://x.com/i/bookmarks')).type, 'bookmarks');
  const x = S.siteFor(loc('https://x.com/'));
  assert.equal(x.items.isFeed(search), true);
  assert.equal(x.items.isFeed(pageInfo(loc('https://x.com/jack/status/20'))), false);
});

test('X counts and post formatting', () => {
  const { parseCount, compact, formatPosts } = S.siteHelpers.x;
  assert.equal(parseCount('1,234 Likes. Like'), 1234);
  assert.equal(parseCount('1.2K'), 1200);
  assert.equal(parseCount('3M'), 3000000);
  assert.equal(parseCount(''), 0);
  assert.equal(compact(1234), '1.2K');
  assert.equal(compact(45000), '45K');
  const text = formatPosts(
    [
      { handle: '@ada', name: 'Ada', verified: true, time: '2026-10-20T10:00:00Z', likes: 1500, reposts: 20, replies: 0, text: 'Hello' },
      { handle: '@bob', name: '', verified: false, hasMedia: true, text: '', promoted: true },
    ],
    { start: 101 }
  );
  assert.equal(text, '[101] @ada (Ada, verified) · 2026-10-20 · 1.5K likes · 20 reposts\nHello\n\n[102] @bob · AD\n[media only]');
});

test('Reddit page detection', () => {
  const { pageInfo } = S.siteHelpers.reddit;
  const reddit = S.siteFor(loc('https://www.reddit.com/'));
  assert.equal(reddit.id, 'reddit');
  assert.equal(S.siteFor(loc('https://old.reddit.com/r/LocalLLaMA/')).id, 'reddit');
  assert.equal(pageInfo(loc('https://www.reddit.com/')).type, 'home');
  assert.equal(pageInfo(loc('https://www.reddit.com/r/popular/')).type, 'home');
  const sub = pageInfo(loc('https://www.reddit.com/r/LocalLLaMA/top/'));
  assert.deepEqual([sub.type, sub.label], ['subreddit', 'r/LocalLLaMA · top']);
  assert.equal(pageInfo(loc('https://www.reddit.com/r/LocalLLaMA/comments/abc123/which_quant/')).type, 'thread');
  const search = pageInfo(loc('https://www.reddit.com/search/?q=ollama'));
  assert.deepEqual([search.type, search.query], ['search', 'ollama']);
  assert.equal(pageInfo(loc('https://www.reddit.com/user/someone/')).type, 'user');
  for (const type of ['home', 'subreddit', 'search', 'user']) assert.equal(reddit.items.isFeed({ type }), true);
  assert.equal(reddit.items.isFeed({ type: 'thread' }), false);
});

test('Reddit formatting of posts and comments', () => {
  const { formatItems, toNumber } = S.siteHelpers.reddit;
  assert.equal(toNumber('1.2k'), 1200);
  assert.equal(toNumber('842 points'), 842);
  const text = formatItems([
    { kind: 'post', subreddit: 'r/LocalLLaMA', author: 'ada', score: 1500, comments: 12, time: '2026-10-19T10:00:00Z', title: 'Q5 vs Q4?', text: 'Body' },
    { kind: 'comment', author: 'bob', depth: 1, score: 40, text: 'Use Q5_K_M.' },
  ]);
  assert.equal(text, '[1] r/LocalLLaMA · u/ada · 1.5K points · 12 comments · 2026-10-19\nTitle: Q5 vs Q4?\nBody\n\n[2] u/bob · reply (depth 1) · 40 points\nUse Q5_K_M.');
});

test('feeds read more in bounded batches', () => {
  for (const id of ['x', 'reddit']) {
    const profile = S.siteProfiles.find((p) => p.id === id);
    assert.ok(profile.items.batchSize > 0 && profile.items.batchSize <= 100, `${id} batch size`);
  }
  assert.ok(S.SCROLL_LIMITS.maxSteps <= 50 && S.SCROLL_LIMITS.maxMs <= 60000, 'one batch is bounded in steps and time');
});

test('the popular-site profiles match their sites and describe the mode in the panel', () => {
  assert.equal(S.siteFor(loc('https://stackoverflow.com/questions/1/x')).id, 'stackoverflow');
  assert.equal(S.siteFor(loc('https://unix.stackexchange.com/questions/2/y')).id, 'stackoverflow');
  assert.equal(S.siteFor(loc('https://news.ycombinator.com/item?id=1')).id, 'hackernews');
  assert.equal(S.siteFor(loc('https://github.com/a/b/issues/3')).id, 'github');
  assert.equal(S.siteFor(loc('https://www.youtube.com/watch?v=abc')).id, 'youtube');
  assert.equal(S.siteFor(loc('https://en.wikipedia.org/wiki/Owl')).id, 'wikipedia');
  assert.match(S.siteHelpers.stackoverflow.pageInfo(loc('https://stackoverflow.com/questions/1/x')).label, /Accepted-solution/);
  assert.match(S.siteHelpers.hackernews.pageInfo(loc('https://news.ycombinator.com/item?id=1')).label, /Discussion consensus/);
  assert.equal(S.siteHelpers.github.pageInfo(loc('https://github.com/a/b/pull/7')).type, 'pull');
  assert.equal(S.siteHelpers.github.pageInfo(loc('https://github.com/a/b')).type, 'repo');
  assert.equal(S.siteHelpers.github.pageInfo(loc('https://github.com/settings/profile')).type, 'page');
  assert.equal(S.siteHelpers.wikipedia.pageInfo(loc('https://en.wikipedia.org/wiki/Main_Page')).type, 'page');
  assert.equal(S.siteHelpers.wikipedia.pageInfo(loc('https://en.wikipedia.org/wiki/Special:Random')).type, 'page');
});

test('Stack Overflow: the accepted answer comes first, then answers by votes', () => {
  const text = S.siteHelpers.stackoverflow.formatQA({
    question: { title: 'How do I parse JSON?', score: 12, tags: ['python', 'json'], body: 'I tried eval.' },
    answers: [
      { score: 300, accepted: false, author: 'bob', body: 'Use json.loads.' },
      { score: 40, accepted: true, author: 'alice', body: '```\njson.load(f)\n```' },
      { score: 5, accepted: false, author: 'carol', body: 'Regex (do not).' },
    ],
  });
  assert.match(text, /^QUESTION: How do I parse JSON\?\nScore 12 · tags: python, json/);
  assert.match(text, /3 answers, one accepted by the asker\./);
  assert.ok(text.indexOf('ANSWER 1 — ACCEPTED · score 40 · by alice') < text.indexOf('ANSWER 2 · score 300 · by bob'));
  assert.match(text, /```\njson\.load\(f\)\n```/, 'code is kept fenced');
});

test('Hacker News: the comment tree keeps reply depth', () => {
  const text = S.siteHelpers.hackernews.formatThread({
    title: 'Show HN: An owl', url: 'https://owl.example', points: 120, author: 'pg',
    comments: [{ author: 'a', depth: 0, text: 'Great.' }, { author: 'b', depth: 1, text: 'Disagree.' }, { author: 'c', depth: 0, text: 'Pricing?' }],
  });
  assert.match(text, /STORY: Show HN: An owl\nLink: https:\/\/owl\.example · 120 points · by pg · 3 comments/);
  assert.match(text, /Comments \(2 top-level\):\n• a: Great\.\n  ↳ b: Disagree\.\n• c: Pricing\?/);
});

test('GitHub: issue state, labels and the conversation in order', () => {
  const text = S.siteHelpers.github.formatIssue({ kind: 'issue', title: 'Crash on start', number: '42', state: 'Open', labels: ['bug'], comments: [{ author: 'x', body: 'It crashes.' }, { author: 'y', body: 'Same here.' }] });
  assert.match(text, /^ISSUE #42: Crash on start\nState: Open · Labels: bug · 1 replies\n\nDESCRIPTION by x\nIt crashes\.\n\nREPLY 1 by y\nSame here\./);
});

test('YouTube: chapters come from the description timestamps', () => {
  const { parseChapters } = S.siteHelpers.youtube;
  assert.deepEqual(parseChapters('Intro text\n0:00 Intro\n1:30 - Setup\n12:05 Results\n1:02:03 Q&A'), [
    { time: '0:00', title: 'Intro' }, { time: '1:30', title: 'Setup' }, { time: '12:05', title: 'Results' }, { time: '1:02:03', title: 'Q&A' },
  ]);
  assert.deepEqual(parseChapters('Released 5:00 today\nSee 2:30 for more'), [], 'scattered times are not chapters');
});

test('Wikipedia: infobox facts, lead and outline lead the text', () => {
  const text = S.siteHelpers.wikipedia.formatArticle({ title: 'Owl', facts: [['Kingdom', 'Animalia']], lead: 'Owls are birds.', sections: ['Anatomy', 'Behaviour'], citationNeeded: 2, body: '' });
  assert.match(text, /^ARTICLE: Owl\n\nINFOBOX:\n- Kingdom: Animalia\n\nLEAD:\nOwls are birds\.\n\nOUTLINE: Anatomy · Behaviour\n\nNote: 2 statements are marked "citation needed"\./);
});

test('numbers in page text are read with thousands and k/M suffixes', () => {
  assert.equal(S.numberIn('1,204 points'), 1204);
  assert.equal(S.numberIn('12K'), 12000);
  assert.equal(S.numberIn('no votes'), 0);
});

test('YouTube: the description stops before the side panels and keeps the video details', () => {
  const { cleanDescription } = S.siteHelpers.youtube;
  const r = cleanDescription('The official video.\n\nNever: The Autobiography …more\nmore\nMusic\n1 song\nTranscript\nVideo details Date 24 Oct 2009 Views 1,829,167,090 Likes 19,491,356');
  assert.equal(r.description, 'The official video.\n\nNever: The Autobiography');
  assert.equal(r.views, '1,829,167,090 views');
  assert.equal(r.date, '24 Oct 2009');
});

test('YouTube transcripts become timestamped paragraphs of about 30 seconds, after the description', () => {
  const yt = S.siteHelpers.youtube;
  const segments = [
    { time: '0:01', text: 'Hello and welcome.' },
    { time: '0:12', text: 'Today we look at reefs.' },
    { time: '0:31', text: 'First, what bleaching is.' },
    { time: '1:05', text: 'Then   recovery.' },
    { time: 'nope', text: 'skipped' },
    { time: '1:20', text: '' },
  ];
  assert.equal(yt.formatTranscript(segments), '[0:01] Hello and welcome. Today we look at reefs.\n\n[0:31] First, what bleaching is.\n\n[1:05] Then recovery.');
  assert.equal(yt.formatTranscript([{ time: '1:02:03', text: 'late' }]), '[1:02:03] late');
  const text = yt.formatVideo({ title: 'T', channel: 'C', views: '', date: '', description: 'D', chapters: [], comments: [], transcript: '[0:01] Hi' });
  assert.ok(text.indexOf('DESCRIPTION') < text.indexOf('TRANSCRIPT'));
  assert.match(text, /TRANSCRIPT \(\[m:ss\] = time in the video\):\n\n\[0:01\] Hi/);
  assert.match(yt.pageInfo({ pathname: '/watch', search: '?v=x' }).context, /transcript/);
});

test('X Articles are recognized by their size and structure, not mistaken for posts or reply lists', () => {
  const { looksLikeArticle } = S.siteHelpers.x;
  assert.equal(looksLikeArticle({ textLength: 5600, blocks: 40, postTextLength: 23 }), true, 'logged out: headings and paragraphs');
  assert.equal(looksLikeArticle({ textLength: 3000, blocks: 0 }), true, 'logged in: rich-text blocks without p/h2');
  assert.equal(looksLikeArticle({ textLength: 900, blocks: 12 }), false, 'too short to be an article');
  assert.equal(looksLikeArticle({ textLength: 1800, blocks: 2 }), false, 'a long post, not an article');
  assert.equal(looksLikeArticle({ textLength: 3000, blocks: 10, postTextLength: 2400 }), false, 'the text is the post itself');
  const x = S.siteFor({ hostname: 'x.com', pathname: '/GoogleCloudTech/status/2113443701938884710', search: '' });
  assert.equal(x.id, 'x');
  assert.deepEqual(x.extractTypes, ['article']);
  assert.equal(typeof x.longform, 'function');
});

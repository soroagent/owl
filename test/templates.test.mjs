import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, promptFiles } from './helpers.mjs';

const S = await load('shared/markdown.js', 'shared/prompts.js', 'shared/templates.js', ...promptFiles);

// One real-looking page per approved template (2026-10-24), and the slots it should get.
const PAGES = [
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtubeVideo'],
  ['https://x.com/nasa/status/1849012345678901234', 'xPost'],
  ['https://www.reddit.com/r/homelab/comments/1abc23/which_nas_should_i_buy/', 'redditThread'],
  ['https://en.wikipedia.org/wiki/Snowy_owl', 'wikipedia'],
  ['https://www.amazon.com/dp/B0CHX1W1XY', 'amazon'],
  ['https://www.linkedin.com/jobs/view/4012345678/', 'linkedinJob'],
  ['https://www.linkedin.com/in/satyanadella/', 'linkedinProfile'],
  ['https://www.pinterest.com/pin/123456789012345678/', 'pinterest'],
  ['https://www.netflix.com/in/title/80057281', 'screenTitle'],
  ['https://www.apple.com/iphone-16-pro/', 'appleProduct'],
  ['https://support.apple.com/en-in/108800', 'appleSupport'],
  ['https://www.espn.com/nba/game/_/gameId/401656363', 'espn'],
  ['https://github.com/mlc-ai/web-llm', 'githubRepo'],
  ['https://github.com/mlc-ai/web-llm/issues/512', 'githubIssue'],
  ['https://www.ebay.com/itm/256123456789', 'ebay'],
  ['https://www.roblox.com/games/920587237/Adopt-Me', 'roblox'],
  ['https://www.quora.com/What-is-the-best-way-to-learn-Python', 'quora'],
  ['https://www.aliexpress.com/item/1005006123456789.html', 'aliexpress'],
  ['https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX', 'spotify'],
  ['https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'spotifyPlaylist'],
  ['https://www.nytimes.com/2026/10/23/world/europe/summit.html', 'news'],
  ['https://www.amazon.in/dp/B0CHX1W1XY', 'amazonIn'],
  ['https://www.flipkart.com/apple-iphone-16/p/itm7c0281cd247be', 'flipkart'],
  ['https://www.myntra.com/tshirts/roadster/roadster-men-tshirt/12345678/buy', 'myntra'],
  ['https://www.cricbuzz.com/live-cricket-scores/105778/ind-vs-nz-1st-test', 'cricketLive'],
  ['https://www.espncricinfo.com/series/ipl-2026-1449924/csk-vs-mi-1st-match-1449925/full-scorecard', 'cricketLive'],
  ['https://www.espncricinfo.com/cricketers/virat-kohli-253802', 'cricketPlayer'],
  ['https://www.hotstar.com/in/shows/the-night-manager/1260130440', 'screenTitle'],
  ['https://www.imdb.com/title/tt0111161/', 'imdbTitle'],
  ['https://www.imdb.com/name/nm0000151/', 'imdbPerson'],
  ['https://in.bookmyshow.com/movies/mumbai/kalki-2898-ad/ET00352941', 'bookmyshow'],
  ['https://www.pw.live/study/batches/arjuna-jee-2027', 'pwBatch'],
  ['https://www.ndtv.com/india-news/monsoon-session-begins-6123456', 'news'],
  ['https://www.aajtak.in/india/story/monsoon-session-1234567-2026-10-24', 'news'],
  ['https://www.bhaskar.com/national/news/budget-2026-133456789.html', 'news'],
  ['https://www.moneycontrol.com/india/stockpricequote/refineries/relianceindustries/RI', 'finance'],
  ['https://finance.yahoo.com/quote/AAPL/', 'finance'],
  ['https://www.justdial.com/Mumbai/Cafe-Mondegar-Colaba/022PXX22-XX22-110101123456-Q8V3_BZDET', 'justdial'],
  ['https://t.me/s/durov', 'telegram'],
];

test('every approved site template matches its pages', () => {
  for (const [url, key] of PAGES) {
    const t = S.questionTemplate(url);
    const want = S.QUESTION_TEMPLATES[key];
    assert.ok(want, `no template ${key}`);
    assert.deepEqual(t.slots.map((s) => s.pattern), want.map(([p]) => p), `${url} → ${key}`);
  }
});

test('other pages get the generic template; news anywhere gets the news template', () => {
  for (const url of ['https://www.youtube.com/', 'https://www.amazon.com/s?k=kettle', 'https://github.com/settings/profile', 'https://example.com/blog/post', 'not a url', 'https://www.ndtv.com/']) {
    assert.equal(S.questionTemplate(url).id, 'default', url);
  }
  assert.equal(S.questionTemplate('https://smalltownpaper.example/2026/10/24/council-vote', { kind: 'news' }).id, 'news');
  assert.equal(S.questionTemplate('https://x.com/a/status/1849012345678901234', { article: true }).id, 'news', 'X Articles read as articles');
});

test('every template has four slots in order, each with a pattern and a plain question', () => {
  for (const [key, slots] of Object.entries(S.QUESTION_TEMPLATES)) {
    assert.equal(slots.length, 4, key);
    for (const [pattern, plain] of slots) {
      assert.ok(pattern.length > 10 && plain.length > 10, key);
      assert.doesNotMatch(plain, /\[/, `${key}: the plain question has no [brackets]`);
    }
  }
  assert.deepEqual(S.questionTemplate('https://en.wikipedia.org/wiki/Owl').slots.map((s) => s.slot), ['Gist', 'Understand', 'Check', 'Next']);
});

test('the model writes one question per slot; bad ones fall back so labels line up', () => {
  const t = S.questionTemplate('https://www.imdb.com/title/tt0111161/');
  const reply = '```json\n{"questions": ["What is The Shawshank Redemption about, without spoilers", "Gist: Who directed it and who stars?", "x", "What\'s similar to [title]?"]}\n```';
  const qs = S.parseSlotQuestions(reply, t);
  assert.deepEqual(qs.map((q) => q.slot), ['Gist', 'Understand', 'Check', 'Next']);
  assert.equal(qs[0].ask, 'What is The Shawshank Redemption about, without spoilers?');
  assert.equal(qs[1].ask, 'Who directed it and who stars?', 'a repeated slot name is stripped');
  assert.equal(qs[2].ask, t.slots[2].plain, 'too short: the plain question');
  assert.equal(qs[3].ask, t.slots[3].plain, 'unfilled [brackets]: the plain question');
  assert.equal(S.parseSlotQuestions('मॉनसून सत्र में क्या हुआ।', t)[0].ask, t.slots[0].plain, 'not JSON: plain questions');
  assert.equal(S.parseSlotQuestions('{"questions":["संसद के मानसून सत्र में आज क्या हुआ?"]}', t)[0].ask, 'संसद के मानसून सत्र में आज क्या हुआ?', 'other languages are kept');
});

test('the questions prompt carries the slots and asks for the page language', () => {
  const t = S.questionTemplate('https://www.flipkart.com/x/p/itm1');
  const [, user] = S.buildMessages('questions', S.pageVars({ title: 'Phone', url: 'https://www.flipkart.com/x/p/itm1', text: 'A phone.' }, { context: 'a product page.', slots: S.slotsText(t) }), {});
  assert.match(user.content, /1\. Gist: What exactly do I get with \[product\]\?/);
  assert.match(user.content, /4\. Next: .*bank offers/);
  assert.match(user.content, /language the page is written in/);
  assert.deepEqual(S.plainQuestions(t).map((q) => q.slot), ['Gist', 'Understand', 'Check', 'Next']);
});

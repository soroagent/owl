import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/markdown.js', 'shared/prompts.js', 'prompts/default.js', 'shared/replies.js');
const R = S.replies;
const at = (url) => new URL(url);

test('reply ideas are offered on X and LinkedIn, and know a post page from a feed', () => {
  assert.equal(R.platformOf(at('https://x.com/home')), 'x');
  assert.equal(R.platformOf(at('https://mobile.twitter.com/sama')), 'x');
  assert.equal(R.platformOf(at('https://www.linkedin.com/feed/')), 'linkedin');
  assert.equal(R.platformOf(at('https://example.com/x.com')), '');
  for (const url of ['https://x.com/karpathy/status/1849012345678901234', 'https://www.linkedin.com/posts/satyanadella_ai-activity-7254-abcd', 'https://www.linkedin.com/feed/update/urn:li:activity:7254000000000000000/']) assert.ok(R.isPostPage(at(url)), url);
  for (const url of ['https://x.com/home', 'https://x.com/karpathy', 'https://www.linkedin.com/feed/', 'https://www.linkedin.com/in/someone/', 'https://example.com/a/status/1']) assert.ok(!R.isPostPage(at(url)), url);
  assert.equal(R.statusId(at('https://x.com/karpathy/status/18/photo/1')), '18');
  assert.equal(R.statusId(at('https://x.com/home')), '');
});

test('on a feed, the post in the middle of the screen is the one replied to', () => {
  const boxes = [{ top: -400, bottom: -10 }, { top: 100, bottom: 380 }, { top: 390, bottom: 700 }, { top: 900, bottom: 1200 }];
  assert.equal(R.pickCentral(boxes, 800), 2, 'covers the middle (400)');
  assert.equal(R.pickCentral([{ top: 100, bottom: 300 }, { top: 450, bottom: 600 }], 800), 1, 'nearest the middle when none covers it');
  assert.equal(R.pickCentral([{ top: -300, bottom: -1 }, null], 800), -1);
  assert.equal(R.pickCentral([], 800), -1);
});

test('the prompt sees who posted it, the thread and the replies so far', () => {
  const post = { name: 'Andrej Karpathy', handle: '@karpathy', verified: true, time: '2026-10-26T10:00:00Z', text: 'What is the best way to teach tokenization to beginners?' };
  const text = R.formatTarget(post, { thread: [{ handle: '@karpathy', text: 'Asking for a lecture.' }], replies: [{ handle: '@a', text: 'Start with bytes.' }] });
  assert.match(text, /^Author: Andrej Karpathy · @karpathy · verified/);
  assert.match(text, /Posted: 2026-10-26/);
  assert.match(text, /Post:\nWhat is the best way/);
  assert.match(text, /The author continued the thread:\n- Asking for a lecture\./);
  assert.match(text, /Replies already posted \(do not repeat these\):\n- @a: Start with bytes\./);
  const li = R.formatTarget({ name: 'Priya Rao', headline: 'VP Engineering at Acme', text: 'We cut our build times in half.' });
  assert.match(li, /Author's headline: VP Engineering at Acme/);
  assert.doesNotMatch(li, /continued|Replies already/);
  assert.match(R.formatTarget({ handle: '@a', text: '', hasMedia: true }), /\[an image or video with no text\]/);
  assert.equal(R.whoOf({ handle: '@a', name: 'A' }), '@a');
  assert.equal(R.whoOf({ name: 'Priya Rao' }), 'Priya Rao');
  const [system, user] = S.buildMessages('reply', { content: text, context: 'Platform: X. X replies: under 280 characters each.' }, {});
  assert.match(system.content, /JSON only/);
  assert.match(user.content, /written for this author/);
  assert.match(user.content, /Platform: X\./);
  assert.match(user.content, /@karpathy/);
});

test('reply ideas from the model: JSON, a list, or numbered lines; at most three', () => {
  const json = '```json\n{"replies": [{"tone": "Add", "text": "\\"We taught it with a byte-level demo first.\\""}, {"tone": "Ask", "text": "Which part trips people up most?"}, {"tone": "Short", "text": "The BPE visual in your last video made it click."}, {"tone": "Extra", "text": "too many"}]}\n```';
  assert.deepEqual(R.parseReplies(json), [
    { tone: 'Add', text: 'We taught it with a byte-level demo first.' },
    { tone: 'Ask', text: 'Which part trips people up most?' },
    { tone: 'Short', text: 'The BPE visual in your last video made it click.' },
  ]);
  assert.deepEqual(R.parseReplies('["One idea", "One idea", "Two"]'), [{ tone: '', text: 'One idea' }, { tone: '', text: 'Two' }], 'repeats dropped');
  assert.deepEqual(R.parseReplies('Here you go:\n1. **Add**: A point.\n2. Ask — A question?\n- Short: Nice.'), [
    { tone: 'Add', text: 'A point.' },
    { tone: 'Ask', text: 'A question?' },
    { tone: 'Short', text: 'Nice.' },
  ]);
  assert.deepEqual(R.parseReplies('<think>hmm</think>{"replies": []}'), []);
  assert.deepEqual(R.parseReplies(''), []);
});

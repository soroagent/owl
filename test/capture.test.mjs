import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

// capture.js needs a page to watch; give it a minimal one so its pure rules can be tested.
globalThis.document = { visibilityState: 'visible', title: 'Example', addEventListener() {}, hasFocus: () => true, querySelector: () => null, querySelectorAll: () => [], scrollingElement: null, documentElement: { scrollHeight: 1 } };
globalThis.location = new URL('https://example.com/');
globalThis.addEventListener = () => {};
globalThis.chrome = { storage: { local: { get: () => Promise.resolve({}) }, onChanged: { addListener() {} } }, runtime: {} };
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = () => 0; // the page watcher's timer would keep the test process alive
const S = await load('shared/snippets.js', 'content/capture.js');
globalThis.setInterval = realSetInterval;
const { captureAllowed, hasBeenRead } = S.capture;

test('only pages actually read are captured', () => {
  assert.ok(hasBeenRead({ activeMs: 60000, depth: 0.6, scrollable: true }));
  assert.ok(!hasBeenRead({ activeMs: 60000, depth: 0.2, scrollable: true }), 'skimmed the top');
  assert.ok(!hasBeenRead({ activeMs: 10000, depth: 1, scrollable: true }), 'too quick');
  assert.ok(hasBeenRead({ activeMs: 50000, depth: 0.1, scrollable: false }), 'short pages need no scrolling');
  assert.ok(!hasBeenRead({ activeMs: 50000, depth: 1, scrollable: true }, 90), 'custom reading time');
});

test('sensitive and low-value pages are never captured', () => {
  const article = { url: 'https://blog.example.com/posts/agents', textLength: 5000 };
  assert.deepEqual(captureAllowed(article), { ok: true, reason: '' });
  assert.equal(captureAllowed({ ...article, url: 'https://mail.google.com/mail/u/0/' }).ok, false);
  assert.equal(captureAllowed({ ...article, url: 'https://shop.example.com/checkout' }).ok, false);
  assert.equal(captureAllowed({ ...article, url: 'https://accounts.example.com/x' }).ok, false);
  assert.equal(captureAllowed({ ...article, url: 'https://www.google.com/search?q=owls' }).ok, false);
  assert.equal(captureAllowed({ ...article, hasPassword: true }).ok, false);
  assert.equal(captureAllowed({ ...article, isFeed: true }).ok, false);
  assert.equal(captureAllowed({ ...article, textLength: 300 }).ok, false);
  assert.equal(captureAllowed(article, ['blog.example.com']).ok, false, "the reader's own exclusions");
  assert.equal(captureAllowed({ ...article, url: 'https://news.example.com/a' }, ['example.com']).ok, false, 'subdomains too');
});

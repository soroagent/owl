import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/config.js', 'background/flight.js');

test('diagnostics never keep addresses, hosts, emails, keys, tokens or local paths', () => {
  const dirty = [
    'Failed to fetch https://www.bbc.com/news/articles/c3qjnwye0ep5o?user=42',
    'http://127.0.0.1:11434 returned 403; also 192.168.1.20:11434 and localhost:1234',
    'key sk-ant-api03-AbCdEf123456789xyz, AIzaSyA1234567890abcdefghijk, ghp_abcdefghijklmnop1234, gsk_abcdefghijklmnop1234',
    'from jane.doe@gmail.com on en.wikipedia.org and chrome-extension://jomghmmgdlajfonjihmagbhomimadpcg/pages/x.html',
    'Authorization: Bearer ya29.a0AfH6SMBxyz123456 and password=hunter22',
    'ENOENT /Users/arjun/Documents/vault/My note.md and C:\\Users\\arjun\\notes',
    `a long token ${'Q'.repeat(40)} here`,
  ].join(' | ');
  const out = S.scrubDiagnostic(dirty, 2000);
  for (const leak of ['bbc.com', 'articles', '127.0.0.1', '192.168', 'localhost', 'sk-ant', 'AIza', 'ghp_', 'gsk_', 'jane.doe', 'gmail', 'wikipedia', 'jomghmm', 'ya29', 'hunter22', '/Users/arjun', 'Users\\arjun', 'QQQQQQQQ']) {
    assert.ok(!out.includes(leak), `leaked ${leak}: ${out}`);
  }
  assert.match(out, /\[url\]/);
  assert.match(out, /\[secret\]/);
  assert.match(S.scrubDiagnostic('Unexpected token < in JSON at position 0'), /token < in JSON/, 'useful error text survives');
  assert.equal(S.scrubDiagnostic('model qwen2.5:14b not found'), 'model qwen2.5:14b not found');
  assert.ok(S.scrubDiagnostic('x '.repeat(400)).length <= 200);
});

test('events keep only an area, a code, a short message and whitelisted details', () => {
  const e = S.sanitizeEvent({ area: 'llm', code: 'http 500', message: 'boom at https://api.example.com/v1', detail: { api: 'openai', status: 500, url: 'https://secret.example/x', pageText: 'private words', model: 'gpt-x' }, extra: 'nope' }, Date.UTC(2026, 9, 22));
  assert.equal(e.area, 'llm');
  assert.equal(e.code, '', 'codes must be simple identifiers');
  assert.equal(e.message, 'boom at [url]');
  assert.deepEqual(e.detail, { api: 'openai', model: 'gpt-x', status: 500 });
  assert.equal(e.at, '2026-10-22T00:00:00.000Z');
  assert.equal(S.sanitizeEvent({ area: 'whatever' }).area, 'error');
  assert.equal('extra' in e, false);
});

test('the ring buffer keeps the last 50 and folds repeats into a count', () => {
  let buf = [];
  for (let i = 0; i < 60; i++) buf = S.pushEvent(buf, S.sanitizeEvent({ area: 'error', code: 'c', message: `m${i}` }));
  assert.equal(buf.length, 50);
  assert.equal(buf[0].message, 'm10');
  const same = S.sanitizeEvent({ area: 'llm', code: 'unreachable', message: 'offline' });
  buf = S.pushEvent(S.pushEvent(S.pushEvent(buf, same), same), same);
  assert.equal(buf.length, 50);
  assert.equal(buf[49].count, 3);
  // As read back from Chrome's storage: same details, keys in another order.
  const stored = { ...buf[49], detail: Object.fromEntries(Object.entries(buf[49].detail).reverse()) };
  const again = S.pushEvent([...buf.slice(0, 49), stored], S.sanitizeEvent({ area: 'llm', code: 'forbidden', message: 'x', detail: { where: 'a', status: 403 } }));
  const twice = S.pushEvent(S.pushEvent([], S.sanitizeEvent({ area: 'llm', code: 'f', detail: { where: 'a', status: 403 } })).map((e) => ({ ...e, detail: { status: 403, where: 'a' } })), S.sanitizeEvent({ area: 'llm', code: 'f', detail: { where: 'a', status: 403 } }));
  assert.equal(twice.length, 1);
  assert.equal(twice[0].count, 2);
  assert.equal(again.length, 50);
});

test('the report is Markdown with the environment and newest events first; the issue link is pre-filled', () => {
  const env = S.describeEnvironment({
    settings: { ...S.DEFAULT_SETTINGS, source: 'local', baseUrl: 'http://10.0.0.5:11434', model: 'qwen2.5:14b' },
    version: '2.30.0',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    schemaVersion: 4,
    libraryCount: 12,
  });
  const map = Object.fromEntries(env);
  assert.equal(map.Browser, 'Chrome 155');
  assert.equal(map.OS, 'macOS');
  assert.equal(map.AI, 'local server: auto at a custom address');
  assert.ok(!JSON.stringify(env).includes('10.0.0.5'), 'no server address');
  const events = [S.sanitizeEvent({ area: 'migration', code: 'upgraded', message: 'Stored data upgraded', detail: { from: 3, to: 4 } }), S.sanitizeEvent({ area: 'extractor', code: 'no-items', message: 'No posts matched on X', detail: { site: 'x' } })];
  const md = S.formatReport({ events, env, generatedAt: '2026-10-22T10:00:00.000Z' });
  assert.match(md, /^### Diagnostic report/);
  assert.match(md, /\| Browser \| Chrome 155 \|/);
  assert.ok(md.indexOf('no-items') < md.indexOf('upgraded'), 'newest first');
  assert.match(md, /_\(from=3, to=4\)_/);
  assert.match(S.formatReport({ events: [], env }), /Nothing went wrong/);
  const url = new URL(S.issueUrl(md));
  assert.equal(url.origin + url.pathname, 'https://github.com/soroagent/owl/issues/new');
  assert.equal(url.searchParams.get('labels'), 'bug');
  assert.match(url.searchParams.get('body'), /### Diagnostic report/);
  const long = S.issueUrl(`### Diagnostic report\n${'x'.repeat(30000)}`);
  assert.ok(long.length < 25000, 'long reports are cut to fit the address');
  assert.match(new URL(long).searchParams.get('body'), /full report is on your clipboard/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/markdown.js');

test('renders common Markdown', () => {
  const html = S.renderMarkdown('# Title\n\n**TL;DR:** fast.\n\n- one\n- two `x`\n\n1. a\n2. b\n\n```\ncode <b>\n```');
  assert.equal(
    html,
    '<h3>Title</h3><p><strong>TL;DR:</strong> fast.</p><ul><li>one</li><li>two <code>x</code></li></ul>' +
      '<ol><li>a</li><li>b</li></ol><pre><code>code &lt;b&gt;</code></pre>'
  );
});

test('escapes HTML and only links http(s) URLs', () => {
  assert.equal(S.renderMarkdown('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.equal(S.renderMarkdown('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.match(S.renderMarkdown('[docs](https://a.test/?q="x")'), /href="https:\/\/a\.test\/\?q=&quot;x&quot;"/);
});

test('stripThinking removes finished and unfinished think blocks', () => {
  assert.equal(S.stripThinking('<think>a</think>\nAnswer'), 'Answer');
  assert.equal(S.stripThinking('<think>still going'), '');
  assert.equal(S.stripThinking('Okay, the user wants {x}.\n</think>\n\nWAL lets readers and writers overlap.'), 'WAL lets readers and writers overlap.');
  assert.equal(S.stripThinking('No reasoning here.'), 'No reasoning here.');
});

test('tables', async () => {
  const S = globalThis.soroagent;
  const html = S.renderMarkdown('Compare:\n\n| Item | A |\n|---|---|\n| **Score** | 91% [1] |\n\nAfter.');
  assert.equal(html, '<p>Compare:</p><table><thead><tr><th>Item</th><th>A</th></tr></thead><tbody><tr><td><strong>Score</strong></td><td>91% [1]</td></tr></tbody></table><p>After.</p>');
});

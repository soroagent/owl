import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/config.js', 'shared/markdown.js', 'shared/prompts.js', 'shared/knowledge.js', 'background/pdfread.js');

function longDoc() {
  let doc = '# Coral reefs under heat stress\n\nIntro: coral reefs are bleaching as ocean temperatures rise.';
  for (let s = 1; s <= 8; s++) {
    doc += `\n\n## Section ${s}\n\nOpening of section ${s}: reef bleaching and recovery.`;
    for (let p = 0; p < 6; p++) doc += `\n\nFiller ${s}.${p}: ${'table chair lamp window '.repeat(12)}`;
    doc += `\n\nClosing of section ${s}: recovery depends on temperature.`;
  }
  return `${doc}\n\n## Conclusion\n\nIn conclusion, reefs recover only if warming stops.`;
}

test('long pages are condensed to cover the whole document, not cut after the introduction', () => {
  const doc = longDoc();
  const { text, condensed } = S.condenseText(doc, 3000, { title: 'Coral reefs' });
  assert.equal(condensed, true);
  assert.ok(text.length <= 3000);
  assert.match(text, /^# Coral reefs under heat stress/);
  assert.match(text, /Intro: coral reefs/);
  assert.match(text, /In conclusion, reefs recover only if warming stops\./, 'the ending survives');
  for (let s = 1; s <= 8; s++) assert.match(text, new RegExp(`## Section ${s}\\n`), `section ${s} heading`);
  assert.match(text, /Closing of section 8/);
  assert.match(text, /\[…\]/, 'gaps are marked');
  const order = ['Intro:', '## Section 1', '## Section 8', 'In conclusion'].map((t) => text.indexOf(t));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'reading order is kept');
  assert.ok((text.match(/Filler/g) || []).length < (doc.match(/Filler/g) || []).length / 4, 'filler is what gets dropped');
  assert.deepEqual(S.condenseText('short', 100), { text: 'short', condensed: false });
});

test('condensed pages tell the model that "[…]" marks skipped parts', () => {
  const vars = S.pageVars({ title: 't', url: 'u', text: 'x […] y', condensed: true });
  assert.match(vars.page, /condensed to fit/);
  assert.match(vars.page, /don't guess/);
});

test('PDF text: lines join into paragraphs, hyphenated words rejoin, big gaps start a new paragraph', () => {
  const item = (str, y, hasEOL = true) => ({ str, transform: [1, 0, 0, 1, 72, y], hasEOL });
  const items = [
    item('Attention Is All You Need', 700),
    item('The dominant sequence transduction models are based on com-', 650),
    item('plex recurrent networks. We propose a new architecture,', 638),
    item('the Transformer.', 626),
    item('1 Introduction', 590),
    item('Recurrent neural networks have been firmly established.', 578),
  ];
  const text = S.pdfItemsToText(items);
  assert.match(text, /based on complex recurrent networks\. We propose a new architecture, the Transformer\./);
  assert.match(text, /the Transformer\.\n\n1 Introduction/);
  assert.equal(S.pdfItemsToText([]), '');
});

test('PDF links are recognized by address or content type', () => {
  assert.equal(S.isPdf('https://arxiv.org/pdf/1706.03762'), true);
  assert.equal(S.isPdf('https://arxiv.org/pdf/1706.03762v7'), true);
  assert.equal(S.isPdf('https://example.com/paper.PDF'), true);
  assert.equal(S.isPdf('https://example.com/download?id=3', 'application/pdf; charset=binary'), true);
  assert.equal(S.isPdf('https://arxiv.org/abs/1706.03762'), false);
  assert.equal(S.isPdf('not a url'), false);
});

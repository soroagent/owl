import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/markdown.js', 'shared/snippets.js', 'background/mdexport.js');

const NOTE = {
  id: 'n1', kind: 'summary', title: 'How AI agents use tools: a "practical" guide', url: 'https://blog.example.com/agents',
  tags: ['ai-agents', 'llm'], createdAt: '2026-10-20T10:00:00.000Z', model: 'qwen3',
  text: '**TL;DR:** Agents plan and call tools.\n\n- Tool use\n- Planning',
  research: { query: 'agent tool use', text: 'More detail [1].', sources: [{ title: 'Paper', url: 'https://arxiv.org/x' }] },
};

test('a note becomes Markdown with YAML frontmatter for Obsidian and Logseq', () => {
  const md = S.noteToMarkdown(NOTE);
  assert.match(md, /^---\ntitle: "How AI agents use tools: a \\"practical\\" guide"\nsource: "https:\/\/blog\.example\.com\/agents"\nsite: "blog\.example\.com"\ntype: "summary"\ntags:\n  - ai-agents\n  - llm\ncreated: 2026-10-20T10:00:00\.000Z\nmodel: "qwen3"\nsoroagent_id: "n1"\n---\n\n# How AI agents use tools/);
  assert.match(md, /\*\*TL;DR:\*\* Agents plan and call tools\./);
  assert.match(md, /## Research: agent tool use\n\nMore detail \[1\]\.\n\n### Sources\n\n1\. \[Paper\]\(https:\/\/arxiv\.org\/x\)/);
  const page = S.noteToMarkdown({ id: 'p', kind: 'page', title: 'Saved', summary: 'An excerpt.', text: 'Full text.', createdAt: '2026-10-21T00:00:00Z' });
  assert.match(page, /type: "saved page"\ntags: \[\]/);
  assert.match(page, /> An excerpt\.\n\n## From the page\n\nFull text\./);
});

test('file names are safe and readable', () => {
  assert.equal(S.safeFileName('What/is: "this"? <test> | #1'), 'What is this test 1');
  assert.equal(S.safeFileName('...'), 'Untitled');
  assert.ok(S.safeFileName('x'.repeat(300)).length <= 90);
});

test('planning writes new and changed notes, renames, de-duplicates names and deletes removed ones', () => {
  const a = { ...NOTE, id: 'a', title: 'Owls' };
  const b = { ...NOTE, id: 'b', title: 'Owls', createdAt: '2026-10-21T00:00:00Z' };
  const first = S.planExport([a, b], {});
  assert.deepEqual(first.writes.map((w) => w.name), ['Owls.md', 'Owls 2.md']);
  const index = Object.fromEntries(first.writes.map((w) => [w.id, { name: w.name, hash: w.hash }]));
  assert.equal(S.planExport([a, b], index).writes.length, 0, 'nothing changed, nothing written');
  const renamed = S.planExport([{ ...a, title: 'Barn owls' }, b], index);
  assert.deepEqual(renamed.writes.map((w) => [w.name, w.replaces]), [['Barn owls.md', 'Owls.md']]);
  assert.deepEqual(S.planExport([a], index).deletes, [{ id: 'b', name: 'Owls 2.md' }]);
});

test('exporting to a folder: writes, keeps files edited in the vault, removes deleted notes', async () => {
  const files = new Map(); // name -> { text, lastModified }
  let clock = Date.now();
  const dir = {
    queryPermission: async () => 'granted',
    getFileHandle: async (name, opts = {}) => {
      if (!files.has(name) && !opts.create) throw new Error('NotFound');
      return {
        getFile: async () => ({ lastModified: files.get(name).lastModified }),
        createWritable: async () => {
          let buf = '';
          return { write: async (t) => (buf += t), close: async () => files.set(name, { text: buf, lastModified: clock }) };
        },
      };
    },
    removeEntry: async (name) => files.delete(name),
  };
  const store = { 'snippet:a': { ...NOTE, id: 'a', title: 'Owls' }, 'snippet:b': { ...NOTE, id: 'b', title: 'Herons' } };
  const ext = { storage: { local: {
    get: async (k) => (k === null ? { ...store } : { [k]: store[k] }),
    set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))),
    remove: async (ks) => [].concat(ks).forEach((x) => delete store[x]),
  } } };
  const realList = S.listSnippets;
  S.listSnippets = async () => Object.keys(store).filter((k) => k.startsWith('snippet:')).map((k) => store[k]);
  const realNow = Date.now;
  Date.now = () => clock;
  try {
    const md = S.createMarkdownExport({ ext, handles: { get: async () => dir, set: async () => {}, clear: async () => {} } });
    await md.enable({ mode: 'folder', folderName: 'Vault' });
    assert.deepEqual([...files.keys()].sort(), ['Herons.md', 'Owls.md']);
    // The user edits Owls.md in Obsidian; soroagent then changes that note: the edit wins.
    clock += 60000;
    files.set('Owls.md', { text: 'my own notes', lastModified: clock });
    store['snippet:a'] = { ...store['snippet:a'], text: 'new summary' };
    const res = await md.exportNow();
    assert.equal(files.get('Owls.md').text, 'my own notes');
    assert.equal(res.skipped, 1);
    // A note deleted in soroagent disappears from the folder.
    delete store['snippet:b'];
    await md.exportNow();
    assert.ok(!files.has('Herons.md'));
  } finally {
    S.listSnippets = realList;
    Date.now = realNow;
  }
});

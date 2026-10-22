import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/markdown.js', 'shared/prompts.js', 'background/jobs.js');
const rec = (id, createdAt, extra = {}) => ({ id, createdAt, status: 'done', seen: true, url: 'https://a.test/', ...extra });

test('fillPlaceholder inserts merged notes into the final prompt', () => {
  const out = S.fillPlaceholder([{ role: 'system', content: 'sys' }, { role: 'user', content: 'Notes:\n@@N@@\nEnd @@N@@' }], '@@N@@', 'A');
  assert.deepEqual(out, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Notes:\nA\nEnd A' }]);
});

test('history is pruned oldest first and never drops a running job', () => {
  const records = [
    rec('new', '2026-10-21T10:00:00Z'),
    rec('mid', '2026-10-20T10:00:00Z'),
    rec('old-running', '2026-10-01T10:00:00Z', { status: 'running' }),
    rec('old', '2026-09-01T10:00:00Z'),
  ];
  assert.deepEqual(S.idsToPrune(records, 2), ['old']);
  assert.deepEqual(S.idsToPrune(records, 10), []);
});

test('a page shows its running jobs and unseen results, oldest first', () => {
  const records = [
    rec('seen', '2026-10-21T09:00:00Z'),
    rec('unseen', '2026-10-21T10:00:00Z', { seen: false }),
    rec('running', '2026-10-21T08:00:00Z', { status: 'running', seen: false }),
    rec('other-page', '2026-10-21T11:00:00Z', { seen: false, url: 'https://b.test/' }),
    rec('failed', '2026-10-21T12:00:00Z', { status: 'error', seen: false }),
  ];
  assert.deepEqual(S.pendingForUrl(records, 'https://a.test/').map((r) => r.id), ['running', 'unseen', 'failed']);
  assert.equal(S.unseenCount(records), 3, 'badge counts finished results not yet seen (any page)');
});

test('a summary prepared on page visit is recorded without asking the model again', async () => {
  const store = {};
  const ext = {
    storage: { local: {
      get: async (k) => (k === null ? { ...store } : Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, store[x]]))),
      set: async (o) => Object.assign(store, o),
      remove: async (ks) => [].concat(ks).forEach((x) => delete store[x]),
    } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    runtime: { getPlatformInfo: async () => ({}) },
  };
  let modelCalls = 0;
  const runner = S.createJobRunner({ ext, runChat: async () => (modelCalls++, 'from the model'), errorPayload: (e) => ({ error: e.message }), getSettings: async () => ({}) });
  const messages = [];
  const port = { postMessage: (m) => messages.push(m) };
  await runner.start({ url: 'https://a.test/', label: 'Summarize this page', kind: 'page', fingerprint: 'fp', final: [], preset: '**TL;DR:** prepared.' }, port);
  for (let i = 0; i < 50 && !messages.some((m) => m.type === 'done'); i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(modelCalls, 0);
  assert.ok(messages.some((m) => m.type === 'token' && m.text === '**TL;DR:** prepared.'), 'the page sees the text');
  const record = Object.values(store).find((r) => r && r.label === 'Summarize this page');
  assert.equal(record.status, 'done');
  assert.equal(record.text, '**TL;DR:** prepared.');
  assert.equal((await runner.find('https://a.test/', 'fp')).text, '**TL;DR:** prepared.', 'found again by fingerprint');
});

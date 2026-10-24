import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/config.js', 'shared/backup.js');

test('storage upgrades add snippet kinds once and record the schema version', () => {
  const all = {
    'snippet:a': { id: 'a', source: 'selection', text: 'x' },
    'snippet:b': { id: 'b', source: 'page', text: 'y' },
    'snippet:c': { id: 'c', kind: 'summary', text: 'z' },
    settings: { model: 'm' },
  };
  const updates = S.planMigrations(all);
  assert.equal(updates['snippet:a'].kind, 'selection');
  assert.equal(updates['snippet:b'].kind, 'page');
  assert.equal(updates['snippet:c'], undefined, 'already upgraded');
  assert.equal(updates.meta.schemaVersion, S.SCHEMA_VERSION);
  assert.deepEqual(S.planMigrations({ ...all, ...updates }), {}, 'nothing left to do');
});

test('backups carry snippets, finished summaries and settings, never keys', () => {
  const all = {
    settings: { model: 'm', apiKey: 'secret-local-key', cloudProvider: 'anthropic' },
    apiKeys: { anthropic: 'sk-ant' },
    'snippet:a': { id: 'a', text: 'x' },
    'summary:1': { id: '1', status: 'done', text: 's' },
    'summary:2': { id: '2', status: 'running', text: '' },
  };
  const backup = S.buildBackup(all, '2.8.0');
  assert.equal(backup.format, 'soroagent-backup');
  assert.equal(JSON.stringify(backup).includes('secret-local-key'), false);
  assert.equal(JSON.stringify(backup).includes('sk-ant'), false);
  assert.deepEqual(backup.snippets.map((s) => s.id), ['a']);
  assert.deepEqual(backup.summaries.map((s) => s.id), ['1'], 'running jobs are not backed up');
});

test('restoring never overwrites existing items and keeps the current local key', () => {
  const backup = { format: 'soroagent-backup', snippets: [{ id: 'a', text: 'old' }, { id: 'b', text: 'new' }, { id: 'bad' }], summaries: [{ id: '1', status: 'done', seen: false }], settings: { model: 'restored' } };
  const all = { 'snippet:a': { id: 'a', text: 'mine' }, settings: { model: 'current', apiKey: 'k' } };
  const { updates, counts } = S.planRestore(backup, all);
  assert.deepEqual(Object.keys(updates).sort(), ['settings', 'snippet:b', 'summary:1']);
  assert.equal(updates['summary:1'].seen, true);
  assert.deepEqual(updates.settings, { model: 'restored', apiKey: 'k' });
  assert.deepEqual(counts, { snippets: 1, summaries: 1, settings: true });
  assert.equal(S.planRestore(backup, all, { includeSettings: false }).updates.settings, undefined);
  assert.throws(() => S.planRestore({ format: 'nope' }, all), /not a soroagent backup/);
});

test('only snippets, summaries and settings trigger an automatic backup', () => {
  assert.ok(S.isBackupWorthy({ 'snippet:x': {} }));
  assert.ok(S.isBackupWorthy({ settings: {} }));
  assert.ok(!S.isBackupWorthy({ 'stats:2026-10-22': {}, backupState: {} }));
});

test('backup file paths become file URLs on every platform', () => {
  assert.equal(S.fileUrl('/Users/a b/Downloads/soroagent/soroagent-backup.json'), 'file:///Users/a%20b/Downloads/soroagent/soroagent-backup.json');
  assert.equal(S.fileUrl('C:\\Users\\a\\Downloads\\soroagent\\soroagent-backup.json'), 'file:///C:/Users/a/Downloads/soroagent/soroagent-backup.json');
  assert.ok(new RegExp(S.BACKUP_FILE_PATTERN).test('/x/Downloads/soroagent/soroagent-backup (1).json'));
  assert.ok(!new RegExp(S.BACKUP_FILE_PATTERN).test('/x/soroagent-backup.json/other.txt'));
});

test('retired features keep your pages and drop their own data', () => {
  const all = {
    meta: { schemaVersion: 2 },
    'snippet:w': { id: 'w', kind: 'wishlist', source: 'wishlist', title: 'Owl lamp', url: 'https://shop/x', price: '$19', image: 'https://img', text: '' },
    'snippet:r': { id: 'r', kind: 'readlater', source: 'readlater', title: 'Long read', url: 'https://a/', readAt: '2026-10-01', text: '' },
    'stats:2026-10-20': { hosts: {}, pages: {} },
    'xstats:dev:2026-10-20': { hosts: {}, pages: {} },
  };
  const updates = S.planMigrations(all);
  assert.equal(updates['snippet:w'].kind, 'page', 'wish list → read later → saved page');
  assert.equal(updates['snippet:w'].summary, '$19');
  assert.equal(updates['snippet:r'].kind, 'page');
  assert.equal(updates['snippet:r'].readAt, undefined);
  assert.equal(updates.meta.schemaVersion, S.SCHEMA_VERSION);
  assert.deepEqual(S.planRemovals(all).sort(), ['stats:2026-10-20', 'xstats:dev:2026-10-20']);
});

test('v5: automatic AI work that was on (the old default) becomes "auto"; off stays off', () => {
  const on = S.planMigrations({ meta: { schemaVersion: 4 }, settings: { source: 'cloud', preparePages: true, pageQuestions: true, model: 'm' } });
  assert.equal(on.settings.preparePages, 'auto');
  assert.equal(on.settings.pageQuestions, 'auto');
  assert.equal(on.settings.model, 'm');
  const off = S.planMigrations({ meta: { schemaVersion: 4 }, settings: { preparePages: false, pageQuestions: false } });
  assert.equal(off.settings.preparePages, false);
  assert.equal(off.settings.pageQuestions, false);
  assert.equal(S.autoOn({ preparePages: 'auto', source: 'cloud' }, 'preparePages'), false);
  assert.equal(S.autoOn({ preparePages: 'auto', source: 'local' }, 'preparePages'), true);
  assert.equal(S.autoOn({ preparePages: 'auto', source: 'browser' }, 'preparePages'), true);
  assert.equal(S.autoOn({ preparePages: true, source: 'cloud' }, 'preparePages'), true, 'turned on by hand');
  assert.equal(S.autoOn({ source: 'local' }, 'preparePages'), true);
});

test('v6: the floating owl is the default again; the three modes map to two settings', () => {
  const up = S.planMigrations({ meta: { schemaVersion: 5 }, settings: { openIn: 'sidepanel', showLauncher: false, model: 'm' } });
  assert.equal(up.settings.openIn, 'page');
  assert.equal(up.settings.showLauncher, true);
  assert.equal(up.settings.model, 'm');
  assert.deepEqual(S.planMigrations({ meta: { schemaVersion: 5 } }), { meta: { schemaVersion: S.SCHEMA_VERSION } });
  assert.equal(S.DEFAULT_SETTINGS.openIn, 'page');
  assert.equal(S.DEFAULT_SETTINGS.showLauncher, true);
  assert.equal(S.appearanceOf(S.DEFAULT_SETTINGS), 'owl');
  for (const mode of ['owl', 'sidepanel', 'quiet']) assert.equal(S.appearanceOf(S.APPEARANCES[mode]), mode);
  assert.equal(S.appearanceOf({ openIn: 'sidepanel', showLauncher: true }), 'sidepanel');
});

test('v7: the automatic backup is opt-in, and Stats, Tasks and the pictures offer leave no data behind', () => {
  const all = { meta: { schemaVersion: 6 }, settings: { autoBackup: true, readingLog: true, offerPictures: true, pictureNeverSites: ['a.com'], source: 'local' }, readingLog: [{ d: '2026-10-24' }], recentTasks: ['x'], 'snippet:a': { id: 'a', kind: 'summary' } };
  const updates = S.planMigrations(all);
  assert.deepEqual(updates.settings, { autoBackup: false, source: 'local' });
  assert.deepEqual(S.planRemovals(all).sort(), ['readingLog', 'recentTasks']);
  assert.equal(S.DEFAULT_SETTINGS.autoBackup, false);
  assert.equal(S.DEFAULT_SETTINGS.followUps, true);
});

test('v8: stored screenshots are deleted with the feature', () => {
  const all = { meta: { schemaVersion: 7 }, 'snippet:a': { id: 'a', kind: 'summary' }, 'snippet:s': { id: 's', kind: 'screenshot', image: 'data:' } };
  assert.deepEqual(S.planRemovals(all), ['snippet:s']);
  assert.equal(S.planMigrations(all).meta.schemaVersion, 8);
});

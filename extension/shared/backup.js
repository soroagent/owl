// Backups and storage upgrades for soroagent's data (settings, snippets, summary history).
// Data lives in chrome.storage.local, which survives extension updates as long as the extension
// ID stays the same (the Chrome build pins it; see keys/README.md). Backups move data between
// installs with different IDs (for example from an older unpacked copy to the store version).
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});
  const SCHEMA_VERSION = 5;
  const FORMAT = 'soroagent-backup';
  // Data from retired features, deleted on upgrade: browsing-time stats (this browser's and synced).
  const RETIRED_PREFIXES = ['stats:', 'xstats:'];
  // The automatic backup, relative to the browser's Downloads folder (overwritten each time).
  const BACKUP_FILE = 'soroagent/soroagent-backup.json';
  const BACKUP_FILE_PATTERN = 'soroagent-backup[^/\\\\]*\\.json$';

  // Each step upgrades stored data from version n-1 to n. Steps must be safe to re-run.
  const MIGRATIONS = {
    // v2: snippets get a `kind` (summary | selection | page | research) for the reading view.
    2: (all) => {
      const updates = {};
      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith('snippet:') && value && !value.kind) {
          updates[key] = { ...value, kind: value.source === 'selection' ? 'selection' : value.source === 'summary' ? 'summary' : 'page' };
        }
      }
      return updates;
    },
    // v3: the wish list was retired; its items become read-later pages (with the price kept).
    3: (all) => {
      const updates = {};
      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith('snippet:') && value && value.kind === 'wishlist') {
          const { price, image, boughtAt, ...rest } = value;
          updates[key] = { ...rest, kind: 'readlater', source: 'readlater', summary: value.summary || price || '', ...(boughtAt ? { readAt: boughtAt } : {}) };
        }
      }
      return updates;
    },
    // v4: "Read later" was retired; those pages become ordinary saved pages (nothing is lost).
    4: (all) => {
      const updates = {};
      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith('snippet:') && value && value.kind === 'readlater') {
          const { readAt, ...rest } = value;
          updates[key] = { ...rest, kind: 'page', source: 'page' };
        }
      }
      return updates;
    },
    // v5: automatic AI work becomes 'auto' (off with a cloud key). Installs that had it on, the old
    // default, get 'auto'; anyone who turned it off keeps it off.
    5: (all) => {
      const s = all.settings;
      if (!s || (s.preparePages !== true && s.pageQuestions !== true)) return {};
      return { settings: { ...s, ...(s.preparePages === true ? { preparePages: 'auto' } : {}), ...(s.pageQuestions === true ? { pageQuestions: 'auto' } : {}) } };
    },
  };

  /** Pure: keys of retired features to delete. */
  const planRemovals = (all) => Object.keys(all).filter((k) => RETIRED_PREFIXES.some((p) => k.startsWith(p)));

  /** Pure: the storage updates needed to bring `all` (a storage dump) to the current schema. */
  function planMigrations(all) {
    const from = Number((all.meta && all.meta.schemaVersion) || 1);
    let working = { ...all };
    const updates = {};
    for (let version = from + 1; version <= SCHEMA_VERSION; version++) {
      const step = MIGRATIONS[version];
      if (!step) continue;
      const changes = step(working);
      Object.assign(updates, changes);
      working = { ...working, ...changes };
    }
    if (from < SCHEMA_VERSION) updates.meta = { ...(all.meta || {}), schemaVersion: SCHEMA_VERSION };
    return updates;
  }

  async function migrate(storage) {
    const all = await storage.get(null);
    const updates = planMigrations(all);
    const removals = planRemovals(all);
    if (Object.keys(updates).length) await storage.set(updates);
    if (removals.length) await storage.remove(removals);
    return Object.keys(updates).length + removals.length;
  }

  /** True when storage changes touch data worth backing up. */
  function isBackupWorthy(changes) {
    return Object.keys(changes).some((k) => k === 'settings' || k.startsWith('snippet:') || k.startsWith('summary:'));
  }

  /** Pure: a file:// URL for a local path from the downloads API (macOS, Linux or Windows). */
  function fileUrl(path) {
    const forward = String(path || '').replace(/\\/g, '/');
    return `file://${forward.startsWith('/') ? '' : '/'}${encodeURI(forward).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
  }

  /** Pure: a backup object from a storage dump. API keys are never included. */
  function buildBackup(all, appVersion) {
    const settings = { ...(all.settings || {}) };
    delete settings.apiKey; // local-server key; cloud keys are stored encrypted elsewhere
    const pick = (prefix) => Object.keys(all).filter((k) => k.startsWith(prefix)).map((k) => all[k]);
    return {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      appVersion,
      exportedAt: new Date().toISOString(),
      settings,
      snippets: pick('snippet:'),
      summaries: pick('summary:').filter((s) => s.status !== 'running'),
    };
  }

  /**
   * Pure: storage updates that restore a backup into `all` without overwriting anything that's
   * already there (matching ids are skipped). Returns { updates, counts }.
   */
  function planRestore(backup, all, { includeSettings = true } = {}) {
    if (!backup || backup.format !== FORMAT) throw new Error('This file is not a soroagent backup.');
    const updates = {};
    const counts = { snippets: 0, summaries: 0, settings: false };
    for (const snippet of backup.snippets || []) {
      if (snippet && snippet.id && typeof snippet.text === 'string' && !all[`snippet:${snippet.id}`]) {
        updates[`snippet:${snippet.id}`] = snippet;
        counts.snippets++;
      }
    }
    for (const summary of backup.summaries || []) {
      if (summary && summary.id && !all[`summary:${summary.id}`]) {
        updates[`summary:${summary.id}`] = { ...summary, seen: true };
        counts.summaries++;
      }
    }
    if (includeSettings && backup.settings) {
      updates.settings = { ...(all.settings || {}), ...backup.settings, apiKey: (all.settings || {}).apiKey || '' };
      counts.settings = true;
    }
    return { updates, counts };
  }

  Object.assign(soroagent, { SCHEMA_VERSION, BACKUP_FILE, BACKUP_FILE_PATTERN, isBackupWorthy, fileUrl, planMigrations, planRemovals, migrate, buildBackup, planRestore });
})(globalThis);

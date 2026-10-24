// Automatic backup: soroagent's data (snippets, summary history and settings; never API keys)
// is saved as a JSON file in the Downloads folder, overwriting the previous one, a couple of
// minutes after it changes (at most every 30 minutes) and on browser start if it's been a day.
// After a fresh install, the browser's download history tells us where that file is, so the
// welcome page can offer to restore it.
(function (root) {
  'use strict';

  const soroagent = root.soroagent;
  const { ext, getSettings, buildBackup, BACKUP_FILE, BACKUP_FILE_PATTERN, isBackupWorthy } = soroagent;
  const ALARM = 'soroagent-backup';
  const MIN_GAP_MINUTES = 30;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const getState = async () => (await ext.storage.local.get('backupState')).backupState || {};

  // A URL the downloads API can save. Firefox's event page can make blob URLs; Chrome's service
  // worker can't, so a hidden offscreen document makes it there.
  async function blobUrl(json) {
    if (typeof URL.createObjectURL === 'function') return { url: URL.createObjectURL(new Blob([json], { type: 'application/json' })), revoke: (u) => URL.revokeObjectURL(u) };
    if (!(await ext.offscreen.hasDocument())) {
      await ext.offscreen.createDocument({ url: 'pages/offscreen.html', reasons: ['BLOBS'], justification: 'Save the automatic backup file to Downloads.' });
    }
    const res = await ext.runtime.sendMessage({ type: 'offscreen:blob', json });
    if (!res || !res.url) throw new Error('Could not prepare the backup file.');
    return { url: res.url, revoke: (u) => ext.runtime.sendMessage({ type: 'offscreen:revoke', url: u }).catch(() => {}) };
  }

  const finished = (id) =>
    new Promise((resolve) => {
      const timer = setTimeout(done, 60000);
      function done(state) {
        clearTimeout(timer);
        ext.downloads.onChanged.removeListener(listener);
        resolve(state || 'unknown');
      }
      function listener(delta) {
        if (delta.id === id && delta.state && delta.state.current !== 'in_progress') done(delta.state.current);
      }
      ext.downloads.onChanged.addListener(listener);
    });

  let running = null;
  /** Writes the backup file now. Resolves with the new backup state. */
  function backupNow() {
    running = running || (async () => {
      const all = await ext.storage.local.get(null);
      const backup = buildBackup(all, ext.runtime.getManifest().version);
      const json = JSON.stringify(backup);
      const { url, revoke } = await blobUrl(json);
      try {
        const id = await ext.downloads.download({ url, filename: BACKUP_FILE, conflictAction: 'overwrite', saveAs: false });
        const outcome = await finished(id);
        if (outcome !== 'complete') throw new Error(`The backup download ${outcome === 'interrupted' ? 'was interrupted' : 'did not finish'}.`);
        const [item] = await ext.downloads.search({ id });
        // Keep one entry in the download history (the file itself is overwritten in place).
        const older = await ext.downloads.search({ filenameRegex: BACKUP_FILE_PATTERN });
        for (const entry of older) if (entry.id !== id) await ext.downloads.erase({ id: entry.id }).catch(() => {});
        const state = { at: new Date().toISOString(), id, path: (item && item.filename) || '', bytes: json.length, snippets: backup.snippets.length, summaries: backup.summaries.length, error: '' };
        await ext.storage.local.set({ backupState: state });
        return state;
      } catch (err) {
        const state = { ...(await getState()), error: err.message || String(err), failedAt: new Date().toISOString() };
        await ext.storage.local.set({ backupState: state });
        throw err;
      } finally {
        setTimeout(() => revoke(url), 10000);
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  async function schedule() {
    const settings = await getSettings();
    if (settings.autoBackup === false) return;
    const last = Date.parse((await getState()).at || 0) || 0;
    const sinceMinutes = (Date.now() - last) / 60000;
    ext.alarms.create(ALARM, { delayInMinutes: Math.max(2, MIN_GAP_MINUTES - sinceMinutes) });
  }

  /** The newest backup file in the download history that still exists: { path, at, bytes } or null. */
  async function findBackupFile() {
    const items = await ext.downloads.search({ filenameRegex: BACKUP_FILE_PATTERN, exists: true, state: 'complete', orderBy: ['-startTime'], limit: 5 });
    const item = items.find((i) => i.exists !== false);
    return item ? { path: item.filename, at: item.endTime || item.startTime, bytes: item.fileSize || item.totalBytes || 0, id: item.id } : null;
  }

  ext.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) backupNow().catch((err) => console.warn('[soroagent] Automatic backup failed:', err));
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && isBackupWorthy(changes)) schedule().catch(() => {});
  });
  // Browser start: back up if the last one is more than a day old and there's something to keep.
  ext.runtime.onStartup.addListener(async () => {
    const last = Date.parse((await getState()).at || 0) || 0;
    if (Date.now() - last > DAY_MS) schedule().catch(() => {});
  });

  Object.assign(soroagent, { backupNow, findBackupFile, scheduleBackup: schedule });
})(globalThis);

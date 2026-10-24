// Sync across browsers: one library in every browser where soroagent is installed (Chrome,
// Firefox, Edge, Brave… on any computer). Browsers can't share an extension's storage and soroagent
// has no servers, so the shared copy lives in the user's own storage (their Google Drive, a WebDAV
// folder or a private GitHub Gist), end-to-end encrypted with their passphrase (PBKDF2 → AES-GCM) before it leaves the
// browser. Notes and history merge item by item (newest wins; deletions carry over); preferences
// sync but each browser keeps its own AI connection and keys. The merge and crypto are pure/portable and unit tested.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});
  const FORMAT = 'soroagent-sync';
  const ENVELOPE = 'soroagent-sync-encrypted';
  const FILE_NAME = 'soroagent-sync.json';
  const GIST_DESCRIPTION = 'soroagent sync (end-to-end encrypted)';
  const TOMBSTONE_DAYS = 120;
  // Google Drive: soroagent's OAuth client (a public identifier, not a secret) and its only scope,
  // a hidden per-app folder in the user's Drive that soroagent can see and nothing else.
  const GOOGLE_CLIENT_ID = '991479969577-mpl1gaq4ku16jpn9fivc63pcvnsceg1j.apps.googleusercontent.com';
  const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const PROVIDERS = ['gdrive', 'webdav', 'gist'];
  // Settings that belong to one browser: how it reaches its AI, and where its owl sits.
  const LOCAL_ONLY_SETTINGS = new Set(['source', 'baseUrl', 'provider', 'apiKey', 'cloudProvider', 'cloudModels', 'model', 'customBaseUrl', 'onboarded', 'modelTipSeen', 'launcherPlacements', 'panelWidth', 'panelHeight', 'updatedAt']);

  // ---------------------------------------------------------------------------
  // Pure: what syncs, and merging
  // ---------------------------------------------------------------------------

  const isSyncedKey = (key, value) => key.startsWith('snippet:') || (key.startsWith('summary:') && !(value && value.status === 'running'));
  const timeOf = (v) => Date.parse((v && (v.updatedAt || v.finishedAt || v.createdAt)) || 0) || 0;
  const syncableSettings = (settings) => Object.fromEntries(Object.entries(settings || {}).filter(([k]) => !LOCAL_ONLY_SETTINGS.has(k)));

  /**
   * Pure: merges this browser's data with the shared copy.
   * local: a storage dump; remote: the decrypted shared document (or null the first time);
   * state: { deviceId, deviceName, knownKeys (synced keys after the last sync), settingsTime }.
   * Returns { updates, removals, doc, knownKeys } — storage changes for this browser and the new
   * shared document.
   */
  function mergeSync(local, remote, { deviceId, deviceName = '', knownKeys = [], settingsTime = 0, now = Date.now() }) {
    const doc = remote && remote.format === FORMAT ? JSON.parse(JSON.stringify(remote)) : { format: FORMAT, v: 1, items: {}, tombstones: {}, settings: null, devices: {} };
    doc.items = doc.items || {};
    doc.tombstones = doc.tombstones || {};
    doc.devices = doc.devices || {};
    const updates = {};
    const removals = [];

    const localKeys = Object.keys(local).filter((k) => isSyncedKey(k, local[k]));
    const localSet = new Set(localKeys);
    // Deleted here since the last sync → a tombstone, so other browsers delete it too.
    for (const key of knownKeys) if (!localSet.has(key) && !doc.tombstones[key]) doc.tombstones[key] = now;

    for (const key of new Set([...localKeys, ...Object.keys(doc.items)])) {
      const mine = local[key];
      const theirs = doc.items[key];
      const tomb = doc.tombstones[key] || 0;
      const mineT = mine ? timeOf(mine) : 0;
      const theirsT = theirs ? theirs._t || timeOf(theirs) : 0;
      if (tomb && tomb >= Math.max(mineT, theirsT)) {
        if (mine) removals.push(key);
        delete doc.items[key];
        continue;
      }
      if (tomb) delete doc.tombstones[key]; // edited after it was deleted elsewhere: it lives
      if (mine && (!theirs || mineT > theirsT)) doc.items[key] = { ...mine, _t: mineT };
      else if (theirs && (!mine || theirsT > mineT)) {
        const { _t, ...value } = theirs;
        updates[key] = value;
      }
    }

    // Preferences: the newer side wins; each browser keeps its own connection settings.
    const localSettings = local.settings || {};
    if (!doc.settings || settingsTime > (doc.settings._t || 0)) doc.settings = { ...syncableSettings(localSettings), _t: settingsTime };
    else if ((doc.settings._t || 0) > settingsTime) {
      const { _t, ...shared } = doc.settings;
      updates.settings = { ...localSettings, ...syncableSettings(shared), updatedAt: _t };
    }

    // Old tombstones are forgotten.
    const cutoff = now - TOMBSTONE_DAYS * 86400000;
    for (const [key, t] of Object.entries(doc.tombstones)) if (t < cutoff) delete doc.tombstones[key];

    doc.devices[deviceId] = { name: deviceName, lastSync: new Date(now).toISOString() };
    doc.updatedAt = new Date(now).toISOString();
    return { updates, removals, doc, knownKeys: Object.keys(doc.items) };
  }

  // ---------------------------------------------------------------------------
  // Portable: encryption (WebCrypto) and compression
  // ---------------------------------------------------------------------------

  const toB64 = (bytes) => {
    let bin = '';
    const u8 = new Uint8Array(bytes);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  async function deriveKey(passphrase, saltB64, extractable = false) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: fromB64(saltB64), iterations: 250000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
  }

  async function gzip(text) {
    if (typeof CompressionStream === 'undefined') return { data: new TextEncoder().encode(text), z: false };
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return { data: new Uint8Array(await new Response(stream).arrayBuffer()), z: true };
  }
  async function gunzip(bytes, z) {
    if (!z) return new TextDecoder().decode(bytes);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  /** Encrypts a document: { format, v, salt, iv, z, data } (all base64). */
  async function seal(doc, key, salt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const { data, z } = await gzip(JSON.stringify(doc));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { format: ENVELOPE, v: 1, salt, iv: toB64(iv), z, data: toB64(cipher) };
  }

  /** Decrypts an envelope. A wrong passphrase throws. */
  async function open(envelope, key) {
    if (!envelope || envelope.format !== ENVELOPE) throw new Error('The sync file is not a soroagent sync file.');
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(envelope.iv) }, key, fromB64(envelope.data));
    } catch {
      throw Object.assign(new Error('Wrong passphrase for this sync file.'), { code: 'passphrase' });
    }
    return JSON.parse(await gunzip(new Uint8Array(plain), envelope.z));
  }

  const newSalt = () => toB64(crypto.getRandomValues(new Uint8Array(16)));

  // ---------------------------------------------------------------------------
  // Remotes: the user's own storage
  // ---------------------------------------------------------------------------

  function webdavRemote({ url, user, secret }, fetchImpl = root.fetch.bind(root)) {
    const auth = { Authorization: `Basic ${btoa(unescape(encodeURIComponent(`${user}:${secret}`)))}` };
    const fileUrl = /\.json$/i.test(url) ? url : `${url.replace(/\/+$/, '')}/${FILE_NAME}`;
    return {
      label: new URL(fileUrl).hostname,
      async read() {
        const res = await fetchImpl(fileUrl, { headers: { ...auth, Accept: 'application/json' }, cache: 'no-store', credentials: 'omit' });
        if (res.status === 404) return { envelope: null, version: '' };
        if (res.status === 401 || res.status === 403) throw new Error('The WebDAV server rejected the username or password.');
        if (!res.ok) throw new Error(`WebDAV error ${res.status}.`);
        return { envelope: JSON.parse(await res.text()), version: res.headers.get('ETag') || '' };
      },
      async write(envelope, version) {
        const headers = { ...auth, 'Content-Type': 'application/json', ...(version ? { 'If-Match': version } : { 'If-None-Match': '*' }) };
        const res = await fetchImpl(fileUrl, { method: 'PUT', headers, body: JSON.stringify(envelope), credentials: 'omit' });
        if (res.status === 412) throw Object.assign(new Error('Changed by another browser meanwhile.'), { code: 'conflict' });
        if (!res.ok && res.status !== 201 && res.status !== 204) throw new Error(`WebDAV error ${res.status} while saving.`);
        return res.headers.get('ETag') || '';
      },
    };
  }

  function gistRemote({ secret, gistId: knownId = '' }, fetchImpl = root.fetch.bind(root)) {
    const api = 'https://api.github.com';
    const headers = { Authorization: `Bearer ${secret}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    let gistId = knownId;
    const call = async (path, init = {}) => {
      const res = await fetchImpl(`${api}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) }, cache: 'no-store', credentials: 'omit' });
      if (res.status === 401) throw new Error('GitHub rejected the token. It needs the "gist" permission.');
      if (!res.ok) throw new Error(`GitHub error ${res.status}.`);
      return res.json();
    };
    async function find() {
      if (gistId) return gistId;
      const list = await call('/gists?per_page=100');
      const hit = list.find((g) => g.description === GIST_DESCRIPTION && g.files && g.files[FILE_NAME]);
      gistId = hit ? hit.id : '';
      return gistId;
    }
    return {
      label: 'GitHub Gist',
      get gistId() {
        return gistId;
      },
      async read() {
        if (!(await find())) return { envelope: null, version: '' };
        const gist = await call(`/gists/${gistId}`);
        const file = gist.files && gist.files[FILE_NAME];
        if (!file) return { envelope: null, version: '' };
        const text = file.truncated ? await (await fetchImpl(file.raw_url, { cache: 'no-store', credentials: 'omit' })).text() : file.content;
        return { envelope: JSON.parse(text), version: gist.updated_at || '' };
      },
      async write(envelope, version) {
        const body = JSON.stringify({ description: GIST_DESCRIPTION, files: { [FILE_NAME]: { content: JSON.stringify(envelope) } } });
        if (!gistId) {
          const created = await call('/gists', { method: 'POST', body: JSON.stringify({ description: GIST_DESCRIPTION, public: false, files: { [FILE_NAME]: { content: JSON.stringify(envelope) } } }) });
          gistId = created.id;
          return created.updated_at || '';
        }
        // Gists have no conditional writes: check nobody saved since we read.
        if (version) {
          const current = await call(`/gists/${gistId}`);
          if (current.updated_at !== version) throw Object.assign(new Error('Changed by another browser meanwhile.'), { code: 'conflict' });
        }
        const saved = await call(`/gists/${gistId}`, { method: 'PATCH', body });
        return saved.updated_at || '';
      },
    };
  }

  // Google Drive: one file in the app's hidden folder (appDataFolder). getToken(force) returns an
  // access token; on a 401 it's asked once for a fresh one.
  function driveRemote({ getToken }, fetchImpl = root.fetch.bind(root)) {
    const api = 'https://www.googleapis.com';
    let fileId = '';
    const call = async (url, init = {}, raw = false) => {
      let res;
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = await getToken(attempt > 0);
        res = await fetchImpl(`${api}${url}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) }, cache: 'no-store', credentials: 'omit' });
        if (res.status !== 401) break;
      }
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Google Drive needs you to connect again.'), { code: 'auth' });
      if (!res.ok) throw new Error(`Google Drive error ${res.status}.`);
      return raw ? res : res.json();
    };
    const meta = async () => {
      if (fileId) return call(`/drive/v3/files/${fileId}?fields=id,version`).catch((err) => (/ 404\./.test(err.message) ? ((fileId = ''), null) : Promise.reject(err)));
      const q = encodeURIComponent(`name = '${FILE_NAME}' and trashed = false`);
      const { files = [] } = await call(`/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,version)&orderBy=createdTime&pageSize=1`);
      if (files[0]) fileId = files[0].id;
      return files[0] || null;
    };
    return {
      label: 'Google Drive',
      async read() {
        const m = await meta();
        if (!m) return { envelope: null, version: '' };
        const res = await call(`/drive/v3/files/${m.id}?alt=media`, {}, true);
        return { envelope: JSON.parse(await res.text()), version: String(m.version || '') };
      },
      async write(envelope, version) {
        const body = JSON.stringify(envelope);
        if (!fileId) {
          const boundary = `soroagent${Date.now()}`;
          const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
          const created = await call('/upload/drive/v3/files?uploadType=multipart&fields=id,version', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
          fileId = created.id;
          return String(created.version || '');
        }
        // Drive has no conditional writes: check nobody saved since we read.
        if (version) {
          const current = await meta();
          if (!current || String(current.version) !== version) throw Object.assign(new Error('Changed by another browser meanwhile.'), { code: 'conflict' });
        }
        const saved = await call(`/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,version`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
        return String(saved.version || '');
      },
    };
  }

  /** Pure: the Google sign-in URL. */
  function googleAuthUrl({ redirectUri, interactive, clientId = GOOGLE_CLIENT_ID }) {
    const params = new URLSearchParams({ client_id: clientId, response_type: 'token', redirect_uri: redirectUri, scope: GOOGLE_SCOPE, include_granted_scopes: 'true' });
    if (!interactive) params.set('prompt', 'none');
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /** Pure: the token from the URL Google redirects back to (or throws with Google's error). */
  function parseGoogleRedirect(url, now = Date.now()) {
    const hash = new URLSearchParams(String(url || '').split('#')[1] || '');
    const query = new URLSearchParams((String(url || '').split('#')[0].split('?')[1]) || '');
    const error = hash.get('error') || query.get('error');
    if (error) throw Object.assign(new Error(error === 'access_denied' ? 'Google Drive access was not allowed.' : `Google sign-in failed (${error}).`), { code: 'auth' });
    const token = hash.get('access_token');
    if (!token) throw Object.assign(new Error('Google sign-in did not finish.'), { code: 'auth' });
    if (hash.get('scope') && !hash.get('scope').split(' ').includes(GOOGLE_SCOPE)) throw Object.assign(new Error('Allow soroagent to use its own folder in your Google Drive.'), { code: 'auth' });
    return { token, expiresAt: now + (Number(hash.get('expires_in')) || 3600) * 1000 };
  }

  /** Pure: where Google sends the user back. Firefox's own domain isn't accepted by Google, so it uses its loopback form. */
  function googleRedirectUri(identityRedirect, firefox) {
    if (!firefox) return identityRedirect;
    const sub = new URL(identityRedirect).hostname.split('.')[0];
    return `http://127.0.0.1/mozoauth2/${sub}`;
  }

  // Google access tokens last about an hour; this keeps one (in memory and session storage, never on
  // disk) and renews it quietly through the browser's sign-in. The sign-in window itself opens from
  // the Settings page (getToken(false, true)); the background worker then finds the token in session storage.
  function googleAuth(ext) {
    let cached = null;
    const firefox = typeof root.browser !== 'undefined' && /Firefox\//.test((root.navigator && root.navigator.userAgent) || '');
    const session = ext.storage && ext.storage.session;
    async function signIn(interactive) {
      if (!ext.identity || !ext.identity.launchWebAuthFlow) throw new Error('This browser can\'t sign in to Google from an extension.');
      const redirectUri = googleRedirectUri(ext.identity.getRedirectURL(), firefox);
      const back = await ext.identity.launchWebAuthFlow({ url: googleAuthUrl({ redirectUri, interactive }), interactive });
      cached = parseGoogleRedirect(back);
      if (session) await session.set({ googleToken: cached }).catch(() => {});
      return cached.token;
    }
    async function getToken(force = false, interactive = false) {
      if (!force && !interactive) {
        if (!cached && session) cached = (await session.get('googleToken').catch(() => ({}))).googleToken || null;
        if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
      }
      try {
        return await signIn(interactive);
      } catch (err) {
        if (interactive) throw err;
        throw Object.assign(new Error('Google Drive needs you to connect again.'), { code: 'auth' });
      }
    }
    async function forget() {
      const token = cached && cached.token;
      cached = null;
      if (session) await session.remove('googleToken').catch(() => {});
      if (token) await root.fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', credentials: 'omit' }).catch(() => {});
    }
    return { getToken, forget };
  }

  /** Pure: whether two shared documents differ in content (not just in sync timestamps). */
  function docChanged(before, after) {
    const strip = (d) => (d ? { items: d.items, tombstones: d.tombstones, settings: d.settings, devices: Object.keys(d.devices || {}).sort() } : null);
    return JSON.stringify(strip(before)) !== JSON.stringify(strip(after));
  }

  // ---------------------------------------------------------------------------
  // The runner (background worker only)
  // ---------------------------------------------------------------------------

  // The derived encryption key lives in IndexedDB as a non-extractable CryptoKey: usable here,
  // never readable, and the passphrase itself is not stored.
  function keyStore(idb = root.indexedDB) {
    let db;
    const open = () => (db ||= new Promise((resolve, reject) => {
      const req = idb.open('soroagent-sync', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keys');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    const run = async (mode, fn) => {
      const d = await open();
      return new Promise((resolve, reject) => {
        const tx = d.transaction('keys', mode);
        const req = fn(tx.objectStore('keys'));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
      });
    };
    return { get: () => run('readonly', (s) => s.get('main')), set: (v) => run('readwrite', (s) => s.put(v, 'main')), clear: () => run('readwrite', (s) => s.delete('main')) };
  }

  function browserName() {
    const ua = (root.navigator && root.navigator.userAgent) || '';
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Brave/.test(ua) ? 'Brave' : 'Chrome';
    const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'a computer';
    return `${browser} on ${os}`;
  }

  function createSync({ ext, secrets, keys = keyStore(), google = googleAuth(ext) }) {
    let running = null;
    let quietUntil = 0; // our own storage writes don't trigger another sync

    const getConfig = async () => (await ext.storage.local.get('syncConfig')).syncConfig || null;
    const getState = async () => (await ext.storage.local.get('syncState')).syncState || {};
    const secretFor = async (cfg) => (await secrets.getAll())[`sync:${cfg.provider}`] || '';
    const remoteFor = (cfg, secret) => {
      if (cfg.provider === 'gdrive') return driveRemote({ getToken: (force) => google.getToken(force) });
      return cfg.provider === 'gist' ? gistRemote({ secret, gistId: cfg.gistId }) : webdavRemote({ url: cfg.url, user: cfg.user, secret });
    };

    /** Sets sync up (or joins an existing sync file). The passphrase is checked against the file. */
    async function connect({ provider, url = '', user = '', secret, passphrase }) {
      if (!PROVIDERS.includes(provider)) throw new Error('Choose where to keep the encrypted copy.');
      if (provider === 'webdav' && !/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/i.test(url)) throw new Error('Use an https:// WebDAV address.');
      if (provider !== 'gdrive' && !secret) throw new Error(provider === 'gist' ? 'Paste a GitHub token with the "gist" permission.' : 'Enter the WebDAV password (an app password is best).');
      if (!passphrase || passphrase.length < 8) throw new Error('Choose a passphrase of at least 8 characters, and use the same one in every browser.');
      const previous = await getConfig();
      if (provider === 'gdrive') await google.getToken(); // signed in by the Settings page just before
      const cfg = { provider, url: url.trim(), user: user.trim(), gistId: '', deviceId: (previous && previous.deviceId) || crypto.randomUUID(), deviceName: browserName() };
      const remote = remoteFor(cfg, secret);
      const { envelope } = await remote.read();
      const salt = envelope ? envelope.salt : newSalt();
      const key = await deriveKey(passphrase, salt);
      if (envelope) await open(envelope, key); // throws on a wrong passphrase
      await keys.set({ key, salt });
      if (provider !== 'gdrive') await secrets.set(`sync:${provider}`, secret);
      await ext.storage.local.set({ syncConfig: { ...cfg, gistId: remote.gistId || '' }, syncState: { knownKeys: [], joined: Boolean(envelope) } });
      return syncNow();
    }

    /** Pulls, merges and pushes. Resolves with the new state. */
    function syncNow() {
      running = running || (async () => {
        const cfg = await getConfig();
        if (!cfg) return { off: true };
        const stored = await keys.get();
        if (!stored) throw new Error('Enter your sync passphrase again in Settings.');
        const remote = remoteFor(cfg, await secretFor(cfg));
        for (let attempt = 0; attempt < 3; attempt++) {
          const st = await getState();
          const { envelope, version } = await remote.read();
          if (envelope && envelope.salt !== stored.salt) throw Object.assign(new Error('The sync file was re-created with another passphrase. Connect again in Settings.'), { code: 'passphrase' });
          const before = envelope ? await open(envelope, stored.key) : null;
          const local = await ext.storage.local.get(null);
          // A browser joining an existing sync takes the shared preferences rather than its fresh defaults.
          const joining = st.joined && !st.lastSync;
          const res = mergeSync(local, before, { deviceId: cfg.deviceId, deviceName: cfg.deviceName, knownKeys: st.knownKeys || [], settingsTime: joining ? 0 : (local.settings || {}).updatedAt || 0 });
          quietUntil = Date.now() + 3000;
          if (Object.keys(res.updates).length) await ext.storage.local.set(res.updates);
          if (res.removals.length) await ext.storage.local.remove(res.removals);
          try {
            if (!before || docChanged(before, res.doc)) await remote.write(await seal(res.doc, stored.key, stored.salt), version);
          } catch (err) {
            if (err.code === 'conflict') continue; // another browser saved meanwhile: merge again
            throw err;
          }
          const state = {
            code: '',
            knownKeys: res.knownKeys,
            lastSync: new Date().toISOString(),
            error: '',
            devices: res.doc.devices,
            received: Object.keys(res.updates).filter((k) => k.startsWith('snippet:')).length,
            removed: res.removals.length,
          };
          await ext.storage.local.set({ syncState: state, ...(remote.gistId && remote.gistId !== cfg.gistId ? { syncConfig: { ...cfg, gistId: remote.gistId } } : {}) });
          return state;
        }
        throw new Error('Other browsers kept saving at the same time. Try again in a moment.');
      })().catch(async (err) => {
        const st = await getState();
        await ext.storage.local.set({ syncState: { ...st, error: err.message || String(err), code: err.code || '', failedAt: new Date().toISOString() } });
        throw err;
      }).finally(() => {
        running = null;
      });
      return running;
    }

    async function disconnect() {
      const cfg = await getConfig();
      if (cfg && cfg.provider === 'gdrive') await google.forget();
      else if (cfg) await secrets.remove(`sync:${cfg.provider}`);
      await keys.clear().catch(() => {});
      await ext.storage.local.remove(['syncConfig', 'syncState']);
      return { ok: true };
    }

    async function status() {
      const cfg = await getConfig();
      return { on: Boolean(cfg), provider: cfg && cfg.provider, url: cfg && cfg.url, user: cfg && cfg.user, deviceName: cfg && cfg.deviceName, deviceId: cfg && cfg.deviceId, ...(await getState()), knownKeys: undefined };
    }

    const quiet = () => Date.now() < quietUntil;
    return { connect, syncNow, disconnect, status, quiet, getConfig };
  }

  Object.assign(soroagent, {
    createSync,
    docChanged,
    isSyncedKey,
    syncableSettings,
    mergeSync,
    deriveSyncKey: deriveKey,
    newSyncSalt: newSalt,
    sealSync: seal,
    openSync: open,
    webdavRemote,
    gistRemote,
    driveRemote,
    googleAuthUrl,
    parseGoogleRedirect,
    googleRedirectUri,
    GOOGLE_CLIENT_ID,
    createGoogleAuth: googleAuth,
  });
})(globalThis);

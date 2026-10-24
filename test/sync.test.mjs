import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('background/sync.js');

const note = (id, t, extra = {}) => ({ id, kind: 'summary', title: id, text: id, createdAt: t, ...extra });

// Two browsers, each with its own storage, sharing one encrypted file.
function browser(deviceId, google) {
  const store = {};
  const ext = { storage: { local: {
    get: async (k) => (k === null || k === undefined ? { ...store } : typeof k === 'string' ? (k in store ? { [k]: store[k] } : {}) : Object.fromEntries(k.filter((x) => x in store).map((x) => [x, store[x]]))),
    set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))),
    remove: async (ks) => [].concat(ks).forEach((x) => delete store[x]),
  } } };
  const secretsMap = {};
  const secrets = { getAll: async () => ({ ...secretsMap }), set: async (p, v) => (secretsMap[p] = v), remove: async (p) => delete secretsMap[p] };
  let saved = null;
  const keys = { get: async () => saved, set: async (v) => (saved = v), clear: async () => (saved = null) };
  return { store, sync: S.createSync({ ext, secrets, keys, ...(google ? { google } : {}) }), deviceId };
}

// A WebDAV server in memory, with ETags.
function davServer() {
  let file = null;
  let etag = 0;
  const handler = (url, init = {}) => {
    if (!init.method || init.method === 'GET') return file ? new Response(file, { status: 200, headers: { ETag: `"${etag}"` } }) : new Response('', { status: 404 });
    const h = init.headers || {};
    if (h['If-Match'] && h['If-Match'] !== `"${etag}"`) return new Response('', { status: 412 });
    if (h['If-None-Match'] === '*' && file) return new Response('', { status: 412 });
    file = init.body;
    etag++;
    return new Response('', { status: 201, headers: { ETag: `"${etag}"` } });
  };
  return { handler, peek: () => file };
}

test('merging: newest wins, both sides keep their new notes, deletions carry over', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  const a = { 'snippet:1': note('1', '2026-10-20T00:00:00Z'), 'snippet:2': note('2', '2026-10-21T00:00:00Z', { updatedAt: '2026-10-22T10:00:00Z', title: 'edited on A' }) };
  const first = S.mergeSync(a, null, { deviceId: 'A', now });
  assert.deepEqual(Object.keys(first.doc.items).sort(), ['snippet:1', 'snippet:2']);
  const b = { 'snippet:2': note('2', '2026-10-21T00:00:00Z', { title: 'old on B' }), 'snippet:3': note('3', '2026-10-22T09:00:00Z') };
  const second = S.mergeSync(b, first.doc, { deviceId: 'B', now });
  assert.equal(second.updates['snippet:2'].title, 'edited on A', 'the newer edit wins');
  assert.ok(second.updates['snippet:1'], "A's note arrives on B");
  assert.ok(second.doc.items['snippet:3'], "B's note goes to the shared copy");
  // A deletes note 1; B then drops it too.
  const aAfter = { ...a };
  delete aAfter['snippet:1'];
  const third = S.mergeSync(aAfter, second.doc, { deviceId: 'A', knownKeys: first.knownKeys, now: now + 1000 });
  assert.ok(third.doc.tombstones['snippet:1']);
  const fourth = S.mergeSync({ ...b, ...second.updates }, third.doc, { deviceId: 'B', knownKeys: second.knownKeys, now: now + 2000 });
  assert.deepEqual(fourth.removals, ['snippet:1']);
});

test('preferences sync, but each browser keeps its own AI connection', () => {
  const doc = S.mergeSync({ settings: { source: 'cloud', cloudProvider: 'anthropic', darkSites: { 'a.com': {} }, updatedAt: 200 } }, null, { deviceId: 'A', settingsTime: 200 }).doc;
  assert.equal(doc.settings.source, undefined);
  const res = S.mergeSync({ settings: { source: 'local', baseUrl: 'http://127.0.0.1:11434', updatedAt: 100 } }, doc, { deviceId: 'B', settingsTime: 100 });
  assert.equal(res.updates.settings.source, 'local', 'own connection kept');
  assert.deepEqual(res.updates.settings.darkSites, { 'a.com': {} }, 'shared preference arrives');
});

test('the shared copy is encrypted; a wrong passphrase cannot read it', async () => {
  const salt = S.newSyncSalt();
  const key = await S.deriveSyncKey('correct horse battery', salt);
  const sealed = await S.sealSync({ format: 'soroagent-sync', items: { 'snippet:x': { title: 'secret plans' } } }, key, salt);
  assert.doesNotMatch(JSON.stringify(sealed), /secret plans/);
  assert.equal((await S.openSync(sealed, key)).items['snippet:x'].title, 'secret plans');
  const wrong = await S.deriveSyncKey('wrong passphrase!', salt);
  await assert.rejects(S.openSync(sealed, wrong), /Wrong passphrase/);
});

test('two browsers converge through WebDAV, end to end', async () => {
  const dav = davServer();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => dav.handler(url, init);
  try {
    const A = browser('A');
    const B = browser('B');
    A.store['snippet:a'] = note('a', '2026-10-20T00:00:00Z');
    B.store['snippet:b'] = note('b', '2026-10-21T00:00:00Z');
    const setup = { provider: 'webdav', url: 'https://dav.example.com/soroagent/', user: 'me', secret: 'app-pass', passphrase: 'owl passphrase' };
    await A.sync.connect(setup);
    await B.sync.connect(setup);
    await A.sync.syncNow();
    assert.ok(A.store['snippet:b'] && B.store['snippet:a'], 'both browsers have both notes');
    assert.doesNotMatch(dav.peek(), /"title":"a"/, 'the server only sees ciphertext');
    await assert.rejects(browser('C').sync.connect({ ...setup, passphrase: 'not the same one' }), /Wrong passphrase/);
    const st = await B.sync.status();
    assert.equal(Object.keys(st.devices).length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a WebDAV conflict is merged and retried, never overwritten', async () => {
  const dav = davServer();
  const remote = S.webdavRemote({ url: 'https://dav.example.com/x/', user: 'u', secret: 'p' }, async (url, init) => dav.handler(url, init));
  const first = await remote.read();
  assert.equal(first.envelope, null);
  await remote.write({ format: 'soroagent-sync-encrypted', v: 1 }, first.version);
  await assert.rejects(remote.write({ format: 'soroagent-sync-encrypted', v: 1 }, ''), (err) => err.code === 'conflict', 'creating over an existing file is a conflict');
  const second = await remote.read();
  await remote.write({ format: 'soroagent-sync-encrypted', v: 1 }, second.version);
  await assert.rejects(remote.write({ format: 'soroagent-sync-encrypted', v: 1 }, second.version), (err) => err.code === 'conflict', 'a stale version is a conflict');
});

// Google Drive's appDataFolder in memory: files with ids and versions, bearer tokens checked.
function driveServer(validTokens) {
  const files = new Map();
  let next = 1;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return {
    files,
    async handler(url, init = {}) {
      const u = new URL(url);
      if (!validTokens.has(String(init.headers.Authorization).replace('Bearer ', ''))) return json(401, { error: 'invalid' });
      const method = init.method || 'GET';
      const id = (u.pathname.match(/\/files\/([^/]+)$/) || [])[1];
      if (method === 'GET' && u.pathname === '/drive/v3/files') {
        assert.equal(u.searchParams.get('spaces'), 'appDataFolder');
        return json(200, { files: [...files.entries()].map(([fid, f]) => ({ id: fid, version: String(f.version) })) });
      }
      if (method === 'GET' && id) {
        const f = files.get(id);
        if (!f) return json(404, {});
        return u.searchParams.get('alt') === 'media' ? new Response(f.content) : json(200, { id, version: String(f.version) });
      }
      if (method === 'POST') {
        assert.match(init.headers['Content-Type'], /multipart\/related/);
        assert.match(init.body, /"parents":\["appDataFolder"\]/);
        const content = init.body.split('\r\n\r\n')[2].split('\r\n--')[0];
        const fid = `f${next++}`;
        files.set(fid, { content, version: 1 });
        return json(200, { id: fid, version: '1' });
      }
      if (method === 'PATCH') {
        const f = files.get(id);
        f.content = init.body;
        f.version += 1;
        return json(200, { id, version: String(f.version) });
      }
      return json(400, {});
    },
  };
}

test('two browsers converge through Google Drive; an expired token is renewed once', async () => {
  const tokens = new Set(['t1']);
  const drive = driveServer(tokens);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => drive.handler(url, init);
  let renewals = 0;
  const google = { getToken: async (force) => (force ? (renewals++, tokens.add('t2'), 't2') : 't1'), forget: async () => {} };
  try {
    const A = browser('A', google);
    const B = browser('B', google);
    A.store['snippet:a'] = note('a', '2026-10-20T00:00:00Z');
    B.store['snippet:b'] = note('b', '2026-10-21T00:00:00Z');
    await A.sync.connect({ provider: 'gdrive', passphrase: 'owl passphrase' });
    tokens.delete('t1'); // the hour is up
    await B.sync.connect({ provider: 'gdrive', passphrase: 'owl passphrase' });
    await A.sync.syncNow();
    assert.ok(A.store['snippet:b'] && B.store['snippet:a'], 'both browsers have both notes');
    assert.equal(drive.files.size, 1, 'one sync file');
    assert.doesNotMatch([...drive.files.values()][0].content, /"title":"a"/, 'Google only sees ciphertext');
    assert.ok(renewals >= 1);
    assert.equal((await A.sync.status()).provider, 'gdrive');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Google Drive: lost access is reported so Settings can offer to reconnect', async () => {
  const drive = driveServer(new Set());
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => drive.handler(url, init);
  try {
    const remote = S.driveRemote({ getToken: async () => 'revoked' });
    await assert.rejects(remote.read(), (err) => err.code === 'auth');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Google sign-in: URL, redirect and token parsing', () => {
  const url = new URL(S.googleAuthUrl({ redirectUri: 'https://abc.chromiumapp.org/', interactive: false }));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), S.GOOGLE_CLIENT_ID);
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.appdata');
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.equal(url.searchParams.get('prompt'), 'none');
  assert.equal(new URL(S.googleAuthUrl({ redirectUri: 'x', interactive: true })).searchParams.get('prompt'), null);

  assert.equal(S.googleRedirectUri('https://jomghmmgdlajfonjihmagbhomimadpcg.chromiumapp.org/', false), 'https://jomghmmgdlajfonjihmagbhomimadpcg.chromiumapp.org/');
  assert.equal(S.googleRedirectUri('https://2cc4144500e90330e1a3d0c39bbd9cc2e7ce6aeb.extensions.allizom.org/', true), 'http://127.0.0.1/mozoauth2/2cc4144500e90330e1a3d0c39bbd9cc2e7ce6aeb');

  const t = S.parseGoogleRedirect('https://abc.chromiumapp.org/#access_token=ya29.x&token_type=Bearer&expires_in=3599&scope=https://www.googleapis.com/auth/drive.appdata', 1000);
  assert.deepEqual(t, { token: 'ya29.x', expiresAt: 1000 + 3599000 });
  assert.throws(() => S.parseGoogleRedirect('https://abc.chromiumapp.org/#error=access_denied'), /not allowed/);
  assert.throws(() => S.parseGoogleRedirect('https://abc.chromiumapp.org/?error=interaction_required'), /interaction_required/);
  assert.throws(() => S.parseGoogleRedirect('https://abc.chromiumapp.org/#access_token=x&scope=email'), /own folder/);
});

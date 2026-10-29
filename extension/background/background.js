// Background worker: talks to the local LLM on behalf of pages, and wires up menus and shortcuts.
// Loaded after shared/config.js and background/llm.js (see sw.js for Chrome, manifest scripts for Firefox).
(function () {
  'use strict';

  const { ext, getSettings, resolveConnection, listModels, chat, normalizeBaseUrl, createSecretStore, recommendModels, PULL_SUGGESTION, createJobRunner } =
    globalThis.soroagent;

  // Flight recorder (flight.js): the last 50 internal problems, scrubbed, in session storage only.
  const diag = (globalThis.soroagent.diag = globalThis.soroagent.createFlightRecorder({ ext }));
  globalThis.addEventListener('error', (e) => diag.record({ area: 'error', code: 'uncaught', message: e.message, detail: { where: 'background' } }));
  globalThis.addEventListener('unhandledrejection', (e) => diag.record({ area: 'error', code: 'unhandled', message: (e.reason && e.reason.message) || String(e.reason), detail: { where: 'background' } }));

  // Routine failures (the AI unreachable, a shortcut pressed on a browser page) go to the diagnostic
  // log, not the console: Chrome lists every console warning on the extension's Errors page.
  let dwellQueue = Promise.resolve();
  const quietly = (where) => (err) => diag.record({ area: 'error', code: (err && err.code) || 'failed', message: (err && err.message) || String(err), detail: { where } });

  // The in-browser AI (Gemini Nano, WebLLM); llm.js routes "browser" connections to it.
  globalThis.soroagent.browserAI = globalThis.soroagent.createBrowserAI({ ext });

  const secrets = createSecretStore();
  // Keys saved in plain text by 2.1.0 are encrypted and removed from chrome.storage on first run.
  const migrated = secrets.migrateFrom(ext.storage.local).catch((err) => console.warn('[soroagent] Key migration failed:', err));

  // ---------------------------------------------------------------------------
  // Origin rewriting
  //
  // Ollama answers 403 to requests whose Origin is chrome-extension:// or moz-extension://
  // unless OLLAMA_ORIGINS is configured. We rewrite the Origin of *our own* background
  // requests to the server's own origin, which it always accepts. Web pages are never affected.
  // ---------------------------------------------------------------------------

  const ORIGIN_RULE_ID = 1;
  const extensionBase = ext.runtime.getURL('');
  const manifestPermissions = ext.runtime.getManifest().permissions || [];
  const useWebRequest = manifestPermissions.includes('webRequestBlocking') && Boolean(ext.webRequest);
  let llmOrigin = '';
  let ruleOrigin = '';

  if (useWebRequest) {
    // Firefox: rewrite with blocking webRequest. Registered synchronously so it survives event-page restarts.
    ext.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        const fromUs = details.tabId === -1 && (details.originUrl || '').startsWith(extensionBase);
        if (!fromUs || !llmOrigin || !details.url.startsWith(llmOrigin + '/')) return {};
        const requestHeaders = details.requestHeaders.filter((h) => h.name.toLowerCase() !== 'origin');
        requestHeaders.push({ name: 'Origin', value: llmOrigin });
        return { requestHeaders };
      },
      { urls: ['http://*/*', 'https://*/*'], types: ['xmlhttprequest'] },
      ['blocking', 'requestHeaders']
    );
  }

  async function ensureOriginRewrite(baseUrl) {
    llmOrigin = new URL(baseUrl).origin;
    if (useWebRequest || !ext.declarativeNetRequest || ruleOrigin === llmOrigin) return;
    try {
      // Chrome: a session rule limited to requests made by this extension outside any tab.
      await ext.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ORIGIN_RULE_ID],
        addRules: [
          {
            id: ORIGIN_RULE_ID,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [{ header: 'origin', operation: 'set', value: llmOrigin }],
            },
            condition: {
              urlFilter: `|${llmOrigin}/`,
              tabIds: [-1],
              initiatorDomains: [ext.runtime.id],
              resourceTypes: ['xmlhttprequest', 'other'],
            },
          },
        ],
      });
      ruleOrigin = llmOrigin;
    } catch (err) {
      console.warn('[soroagent] Could not install origin rule:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // LLM access
  // ---------------------------------------------------------------------------

  const apiCache = new Map(); // local baseUrl -> 'ollama' | 'openai' (for "auto" detection)

  // overrides: { settings, apiKeys } — lets the settings page test values before saving them.
  // Callers must only pass overrides that came from an extension page (see fromExtensionPage).
  async function getConnection(overrides = {}) {
    await migrated;
    const settings = { ...(await getSettings()), ...(overrides.settings || {}) };
    const apiKeys = { ...(await secrets.getAll()), ...(overrides.apiKeys || {}) };
    const connection = resolveConnection(settings, apiKeys);
    // Only local servers need the Origin rewrite; hosted APIs accept extension requests.
    if (!connection.cloud && connection.api !== 'browser') await ensureOriginRewrite(normalizeBaseUrl(connection.baseUrl));
    return connection;
  }

  async function getStatus(overrides) {
    const connection = await getConnection(overrides);
    const result = await listModels(connection);
    const server = !connection.cloud && connection.api !== 'browser';
    if (server) apiCache.set(result.baseUrl, result.api);
    const ids = result.models.map((m) => m.id);
    // For local servers, rank what's installed and suggest the best fit for soroagent.
    const recommended = server ? recommendModels(result.models) : [];
    let model = connection.model;
    if (!model || (!connection.cloud && !ids.includes(model))) model = (recommended[0] && recommended[0].id) || result.suggested;
    // Hosted APIs accept models that aren't listed (aliases, new releases): keep the user's choice.
    if (model && !ids.includes(model)) result.models.unshift({ id: model, size: '', capabilities: [] });
    return {
      ok: true,
      api: result.api,
      baseUrl: result.baseUrl,
      models: result.models,
      model,
      cloud: connection.cloud,
      providerLabel: connection.label,
      recommended,
      // When nothing installed fits well, suggest a download.
      browser: connection.api === 'browser',
      pullSuggestion: server && (!recommended.length || recommended[0].score < 8) ? PULL_SUGGESTION : null,
    };
  }

  async function resolveChat(modelOverride) {
    const connection = await getConnection();
    if (modelOverride) connection.model = modelOverride;
    let api = connection.api === 'auto' ? apiCache.get(normalizeBaseUrl(connection.baseUrl)) : connection.api;
    if (!api || !connection.model) {
      const status = await getStatus();
      api = status.api;
      connection.model = connection.model || status.model;
    }
    return { connection, api };
  }

  function errorPayload(err) {
    return { ok: false, code: err.code || 'error', error: err.message || String(err), hint: err.hint || '' };
  }

  // Model errors go to the flight recorder with what's safe to know about the connection.
  function recordLlmError(err, connection, where) {
    if (!err || err.name === 'AbortError') return;
    diag.record({
      area: 'llm',
      code: err.code || 'error',
      message: err.message,
      detail: { where, api: connection && connection.api, provider: connection && connection.id, engine: connection && connection.engine, model: connection && connection.model, status: err.status || undefined },
    });
  }

  // Long-lived port per request. The content script pings it while waiting, which also keeps
  // Chrome's service worker alive during slow model loads.
  ext.runtime.onConnect.addListener((port) => {
    if (port.name !== 'llm') return;
    const controller = new AbortController();
    let open = true;
    port.onDisconnect.addListener(() => {
      open = false;
      controller.abort();
    });
    const post = (msg) => {
      if (!open) return;
      try {
        port.postMessage(msg);
      } catch {
        open = false;
      }
    };

    port.onMessage.addListener(async (msg) => {
      if (!msg || msg.type !== 'chat') return;
      let sentThinking = false;
      let used = null;
      try {
        const { connection, api } = await resolveChat(msg.model);
        used = { ...connection, api };
        const text = await chat({
          connection,
          api,
          messages: msg.messages,
          json: Boolean(msg.json),
          quick: Boolean(msg.quick),
          signal: controller.signal,
          onToken: (token) => post({ type: 'token', text: token }),
          onThinking: () => {
            if (!sentThinking) post({ type: 'thinking' });
            sentThinking = true;
          },
        });
        post({ type: 'done', text, model: connection.model });
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        recordLlmError(err, used, 'chat');
        post({ type: 'error', ...errorPayload(err) });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Summary jobs: run here, not in the page, so they finish even if the reader leaves.
  // ---------------------------------------------------------------------------

  const jobs = createJobRunner({
    ext,
    errorPayload: (err) => (recordLlmError(err, null, 'summary job'), errorPayload(err)),
    getSettings,
    runChat: async ({ messages, model, signal, onToken, onThinking, json }) => {
      const { connection, api } = await resolveChat(model);
      return chat({ connection, api, messages, signal, onToken, onThinking, json });
    },
  });
  jobs.recover();

  ext.runtime.onConnect.addListener((port) => {
    if (port.name !== 'summary') return;
    port.onDisconnect.addListener(() => jobs.detach(port)); // the job keeps running
    port.onMessage.addListener(async (msg) => {
      try {
        if (msg.type === 'start') await jobs.start(msg.job, port);
        else if (msg.type === 'attach' && !jobs.attach(msg.id, port)) port.postMessage({ type: 'gone', id: msg.id });
        else if (msg.type === 'stop') jobs.stop(msg.id);
      } catch (err) {
        port.postMessage({ type: 'error', record: { status: 'error', ...errorPayload(err) } });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Toolbar icon follows the browser theme: white tile in light mode, dark tile in dark mode.
  // ---------------------------------------------------------------------------

  const ICON_SIZES = [16, 32, 48, 128];
  let iconTheme = null;
  async function setThemeIcon(dark) {
    if (iconTheme === dark) return { ok: true };
    iconTheme = dark;
    const path = Object.fromEntries(ICON_SIZES.map((size) => [size, `icons/${dark ? 'dark/' : ''}icon-${size}.png`]));
    try {
      await ext.action.setIcon({ path });
    } catch {
      // Older browsers: keep the manifest icon.
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // One-shot messages from content scripts and extension pages
  // ---------------------------------------------------------------------------

  // True for soroagent's own pages (settings, snippets); false for content scripts in web pages.
  function fromExtensionPage(sender) {
    return Boolean(sender && sender.id === ext.runtime.id && (sender.url || '').startsWith(extensionBase));
  }

  function requireExtensionPage(sender) {
    if (!fromExtensionPage(sender)) throw new Error('Not allowed from a web page.');
  }

  // Bumped whenever keys change, so open pages can reconnect without ever seeing a key.
  const announceKeysChanged = () => ext.storage.local.set({ keysVersion: Date.now() });

  const S = globalThis.soroagent;
  let labelQueue = Promise.resolve();

  // ---------------------------------------------------------------------------
  // The library index: semantic + keyword search over everything saved (library.js)
  // ---------------------------------------------------------------------------

  let embedTarget = { at: 0, value: null };
  async function getEmbeddingTarget() {
    if (Date.now() - embedTarget.at < 60000) return embedTarget.value;
    const settings = await getSettings();
    let value = null;
    if (settings.semanticSearch !== false) {
      const local = { ...S.resolveConnection({ ...settings, source: 'local' }, {}) };
      const cloud = settings.source === 'cloud' ? await getConnection() : null;
      if (local.baseUrl) await ensureOriginRewrite(normalizeBaseUrl(local.baseUrl)).catch(() => {});
      value = await S.embeddingTarget({ local, cloud });
      // The chat connection may need its own Origin rule back.
      if (settings.source !== 'cloud') await getConnection().catch(() => {});
    }
    embedTarget = { at: Date.now(), value };
    return value;
  }
  const library = S.createLibrary({ ext, getTarget: getEmbeddingTarget, embed: S.embed });
  let indexTimer = 0;
  const scheduleIndex = (delay = 4000) => {
    clearTimeout(indexTimer);
    indexTimer = setTimeout(() => library.indexNow().catch(() => {}), delay);
  };
  scheduleIndex(8000);
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some((k) => k.startsWith('snippet:'))) scheduleIndex();
    if (changes.settings || changes.keysVersion) embedTarget = { at: 0, value: null };
  });

  // ---------------------------------------------------------------------------
  // Sync across browsers (sync.js): the user's own storage, end-to-end encrypted
  // ---------------------------------------------------------------------------

  const sync = S.createSync({ ext, secrets });
  const SYNC_ALARM = 'soroagent-sync';
  let syncTimer = 0;
  const syncSoon = (delay = 20000) => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sync.syncNow().catch(() => {}), delay);
  };
  sync.getConfig().then((cfg) => {
    if (!cfg) return;
    ext.alarms.create(SYNC_ALARM, { periodInMinutes: 10 });
    syncSoon(5000);
  }).catch(() => {});
  ext.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) sync.syncNow().catch(() => {});
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || sync.quiet()) return;
    if (Object.keys(changes).some((k) => k.startsWith('snippet:') || k.startsWith('summary:') || k === 'settings')) {
      sync.getConfig().then((cfg) => cfg && syncSoon()).catch(() => {});
    }
  });

  // ---------------------------------------------------------------------------
  // Markdown folder sync (mdexport.js): Obsidian/Logseq-ready .md files in a folder on disk
  // ---------------------------------------------------------------------------

  const markdown = S.createMarkdownExport({ ext });
  let markdownTimer = 0;
  const exportSoon = (delay = 5000) => {
    clearTimeout(markdownTimer);
    markdownTimer = setTimeout(() => markdown.exportNow().catch(() => {}), delay);
  };
  markdown.getConfig().then((cfg) => cfg && exportSoon(6000)).catch(() => {});
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('snippet:'))) markdown.getConfig().then((cfg) => cfg && exportSoon()).catch(() => {});
  });

  const handlers = {
    // Only extension pages may test unsaved values: overrides can redirect a key to another URL.
    'llm:status': (msg, sender) => getStatus(fromExtensionPage(sender) ? msg.overrides || {} : {}),
    'keys:describe': async (msg, sender) => {
      requireExtensionPage(sender);
      await migrated;
      return { ok: true, keys: await secrets.describe() };
    },
    'keys:set': async (msg, sender) => {
      requireExtensionPage(sender);
      await migrated;
      for (const [provider, key] of Object.entries(msg.keys || {})) {
        if (typeof key === 'string' && key.trim()) await secrets.set(provider, key);
      }
      await announceKeysChanged();
      return { ok: true, keys: await secrets.describe() };
    },
    'keys:remove': async (msg, sender) => {
      requireExtensionPage(sender);
      await migrated;
      await secrets.remove(String(msg.provider || ''));
      await announceKeysChanged();
      return { ok: true, keys: await secrets.describe() };
    },
    // `id` opens the snippets page on that snippet.
    'open:pkg': () => ext.tabs.create({ url: ext.runtime.getURL('pages/pkg.html') }),
    'open:snippets': (msg) => {
      const hash = msg && msg.id ? `#${encodeURIComponent(msg.id)}` : msg && msg.view ? `#view=${encodeURIComponent(msg.view)}` : '';
      return ext.tabs.create({ url: ext.runtime.getURL(`pages/snippets.html${hash}`) });
    },
    'open:options': () => ext.runtime.openOptionsPage(),

    // First run: what AI this computer already has. Ollama on its default address (the request
    // never leaves the computer), Chrome's built-in model, and whether WebGPU can run one.
    'ai:detect': async (msg, sender) => {
      requireExtensionPage(sender);
      const ollama = await getStatus({ settings: { source: 'local', baseUrl: S.DEFAULT_SETTINGS.baseUrl, provider: 'auto', model: '' } })
        .then((st) => (st.models.length ? { state: 'ok', model: st.model, count: st.models.length } : { state: 'no-models' }))
        .catch((err) => ({ state: err.code === 'forbidden' ? 'forbidden' : 'offline', error: err.message }));
      const nano = await S.nanoAvailability();
      const webllm = await S.browserAI.status('webllm').catch(() => ({ ready: false, webgpu: false }));
      return { ok: true, ollama, nano, webgpu: webllm.webgpu, webllmReady: webllm.ready };
    },
    // Pages talk to the in-browser engine over a port; in Chrome it lives in the offscreen document.
    'ai:host': async (msg, sender) => {
      requireExtensionPage(sender);
      await S.browserAI.ensureOffscreen();
      return { ok: true };
    },
    'ai:webllm-ready': async (msg, sender) => {
      requireExtensionPage(sender);
      await S.browserAI.markReady();
      return { ok: true };
    },

    // Sync is offered once the library holds 5 things worth keeping (see syncOfferDue).
    'sync:offer': async () => {
      const all = await ext.storage.local.get(null);
      const count = Object.keys(all).filter((k) => k.startsWith('snippet:') && all[k]).length;
      const settings = await getSettings();
      return { ok: true, count, offer: S.syncOfferDue({ count, syncOn: Boolean(all.syncConfig), offer: settings.syncOffer || {} }) };
    },
    'sync:offer-later': async () => {
      const all = await ext.storage.local.get(null);
      const count = Object.keys(all).filter((k) => k.startsWith('snippet:')).length;
      const settings = await getSettings();
      const offer = settings.syncOffer || {};
      await S.saveSettings({ syncOffer: { snoozedAt: count, times: (offer.times || 0) + 1 } });
      return { ok: true };
    },
    // PKG reading time: active time on a page the reader saved (capture.js checks it's saved), added
    // to storage "pkgDwell" one report at a time, in order.
    'pkg:dwell': (msg, sender) => {
      if (!sender || sender.id !== ext.runtime.id || !sender.tab || sender.tab.incognito) return { ok: false };
      dwellQueue = dwellQueue.then(async () => {
        const { pkgDwell = {} } = await ext.storage.local.get('pkgDwell');
        await ext.storage.local.set({ pkgDwell: S.addDwell(pkgDwell, String(msg.url || ''), msg.ms) });
      }).catch(quietly('pkg dwell'));
      return { ok: true };
    },
    // Flight recorder: anything of ours may report (it's scrubbed again here); only extension pages read it.
    'diag:record': async (msg, sender) => {
      if (!sender || sender.id !== ext.runtime.id) return { ok: false };
      await diag.record(msg.event || {});
      return { ok: true };
    },
    'diag:report': async (msg, sender) => {
      requireExtensionPage(sender);
      const all = await ext.storage.local.get(null);
      const env = S.describeEnvironment({
        settings: await getSettings(),
        version: ext.runtime.getManifest().version,
        userAgent: (globalThis.navigator && globalThis.navigator.userAgent) || '',
        schemaVersion: (all.meta && all.meta.schemaVersion) || '',
        libraryCount: Object.keys(all).filter((k) => k.startsWith('snippet:')).length,
        syncOn: Boolean(all.syncConfig),
        markdownOn: Boolean(all.markdownExport),
      });
      const events = await diag.list();
      const markdown = S.formatReport({ events, env });
      return { ok: true, markdown, issueUrl: S.issueUrl(markdown), count: events.length };
    },
    'diag:clear': async (msg, sender) => {
      requireExtensionPage(sender);
      await diag.clear();
      return { ok: true };
    },
    // PDFs (the side panel, the right-click menu): read with pdf.js where ES modules run.
    'pdf:probe': async (msg, sender) => {
      requireExtensionPage(sender);
      const url = String(msg.url || '');
      if (!/^https?:/.test(url)) return { ok: true, pdf: false };
      if (S.isPdf(url)) return { ok: true, pdf: true };
      const res = await fetch(url, { method: 'HEAD', credentials: 'include' }).catch(() => null);
      return { ok: true, pdf: Boolean(res && S.isPdf(url, res.headers.get('content-type') || '')) };
    },
    'pdf:read': async (msg, sender) => {
      requireExtensionPage(sender);
      const url = String(msg.url || '');
      if (!/^https?:/.test(url)) throw new Error('soroagent can read PDFs from the web (http or https).');
      let res;
      if (pdfLocal) res = await pdfLocal.read(url).then((r) => ({ ok: true, ...r }), (err) => ({ ok: false, error: err.message }));
      else {
        await S.browserAI.ensureOffscreen();
        res = await ext.runtime.sendMessage({ type: 'pdf:extract', url });
      }
      if (!res || !res.ok) {
        diag.record({ area: 'extractor', code: 'pdf', message: (res && res.error) || 'No reply from the PDF reader', detail: { where: 'pdf:read' } });
        throw new Error((res && res.error) || 'Couldn’t read this PDF.');
      }
      if (!res.text) diag.record({ area: 'extractor', code: 'pdf-no-text', message: 'The PDF has no text layer (scanned?)', detail: { where: 'pdf:read' } });
      return res;
    },
    // A question the page couldn't answer: web search results for it, read and numbered for the
    // webAnswer prompt. Same search engines and local-network blocking as Research.
    'web:sources': async (msg, sender) => {
      if (!sender || sender.id !== ext.runtime.id) return { ok: false };
      const query = String(msg.query || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!query) throw new Error('Nothing to search for.');
      const settings = await getSettings();
      const sources = await S.gatherSources(query, { count: 4, engine: settings.researchEngine, searxUrl: settings.searxUrl });
      // Fit small models too: share the page-text budget across the sources.
      const each = Math.max(600, Math.floor(Math.min(10000, S.pageCharLimit(settings)) / sources.length));
      const read = sources.map((s) => ({ title: s.title, url: s.url, text: String(s.text || s.snippet || '').slice(0, each) }));
      return { ok: true, engine: sources.engine, sources: read.map(({ title, url }) => ({ title, url })), formatted: S.formatSources(read) };
    },
    // Switch how soroagent appears (owl | sidepanel | quiet), from either panel or Settings.
    'appearance:set': async (msg, sender) => {
      if (!sender || sender.id !== ext.runtime.id || !S.APPEARANCES[msg.mode]) return { ok: false };
      if (msg.mode === 'sidepanel' && !hasSidePanel) return { ok: false, error: 'This browser has no side panel.' };
      await S.saveSettings(S.APPEARANCES[msg.mode]);
      // Firefox only opens its sidebar from the click itself (the toolbar button or the shortcut).
      return { ok: true, openFromToolbar: msg.mode === 'sidepanel' && Boolean(ext.sidebarAction) };
    },
    'open:sync-setup': () => ext.tabs.create({ url: ext.runtime.getURL('pages/onboard.html?sync') }),
    // Pages report the browser's light/dark theme (the worker itself can't see it).
    theme: (msg) => setThemeIcon(Boolean(msg.dark)),
    // Automatic backup file (see autobackup.js).
    'backup:status': async (msg, sender) => {
      requireExtensionPage(sender);
      return { ok: true, state: (await ext.storage.local.get('backupState')).backupState || null, offer: (await ext.storage.local.get('restoreOffer')).restoreOffer || null };
    },
    'backup:now': async (msg, sender) => {
      requireExtensionPage(sender);
      return { ok: true, state: await S.backupNow() };
    },
    'backup:show': async (msg, sender) => {
      requireExtensionPage(sender);
      const state = (await ext.storage.local.get('backupState')).backupState;
      if (state && state.id) ext.downloads.show(state.id);
      else ext.downloads.showDefaultFolder();
      return { ok: true };
    },
    'library:search': async (msg) => {
      const res = await library.search(String(msg.query || '').slice(0, 4000), { limit: Math.min(50, Number(msg.limit) || 12), since: Number(msg.since) || 0, excludeUrl: msg.excludeUrl || '' });
      return { ok: true, ...res };
    },
    'library:related': async (msg) => ({ ok: true, notes: await library.related(String(msg.text || ''), { excludeUrl: msg.excludeUrl || '', limit: 3 }) }),
    'library:status': async () => ({ ok: true, ...(await library.status()) }),
    'library:reindex': async () => {
      embedTarget = { at: 0, value: null };
      return { ok: true, ...(await library.indexNow()) };
    },
    // Saved and captured pages: the AI adds a title, summary and tags, reusing the
    // library's tags. One at a time, so a burst of reading doesn't flood the model.
    'capture:label': (msg, sender) => {
      if (!sender || sender.id !== ext.runtime.id || !Array.isArray(msg.messages)) return { ok: true };
      labelQueue = labelQueue.then(async () => {
        const key = `snippet:${msg.id}`;
        const note = (await ext.storage.local.get(key))[key];
        if (!note || !['read', 'page'].includes(note.kind) || note.labeled) return;
        const vocabulary = S.tagVocabulary(await S.listSnippets(), 40);
        const messages = msg.messages.slice(0, 3).map((m) => ({ role: m.role === 'system' ? 'system' : 'user', content: String(m.content).slice(0, 12000) }));
        if (vocabulary.length) messages[messages.length - 1].content += `\n\nTags already in the user's library: ${vocabulary.map((v) => v.tag).join(', ')}.\nReuse these tags whenever they fit; add a new tag only for a genuinely new topic.`;
        const { connection, api } = await resolveChat();
        const meta = S.parseSnippetMeta(await chat({ connection, api, messages, json: true }), note.title);
        await S.updateSnippet(note.id, { title: meta.title || note.title, summary: meta.summary || note.summary, tags: S.withSourceTags(S.canonicalTags(meta.tags, vocabulary), note.tags), labeled: true });
      }).catch(quietly('label saved page'));
      return { ok: true };
    },
    'md:status': async (msg, sender) => {
      requireExtensionPage(sender);
      return { ok: true, ...(await markdown.status()) };
    },
    'md:enable': async (msg, sender) => {
      requireExtensionPage(sender);
      return { ok: true, ...(await markdown.enable({ mode: msg.mode === 'downloads' ? 'downloads' : 'folder', folderName: String(msg.folderName || '').slice(0, 120) })) };
    },
    'md:now': async (msg, sender) => {
      requireExtensionPage(sender);
      return { ok: true, ...(await markdown.exportNow()) };
    },
    'md:disable': async (msg, sender) => {
      requireExtensionPage(sender);
      return markdown.disable();
    },
    'sync:status': async (msg, sender) => {
      requireExtensionPage(sender);
      return { ok: true, ...(await sync.status()) };
    },
    'sync:connect': async (msg, sender) => {
      requireExtensionPage(sender);
      const state = await sync.connect({ provider: msg.provider, url: msg.url, user: msg.user, secret: msg.secret, passphrase: msg.passphrase });
      ext.alarms.create(SYNC_ALARM, { periodInMinutes: 10 });
      return { ok: true, ...state };
    },
    'sync:now': async (msg, sender) => {
      requireExtensionPage(sender);
      return { ok: true, ...(await sync.syncNow()) };
    },
    'sync:disconnect': async (msg, sender) => {
      requireExtensionPage(sender);
      ext.alarms.clear(SYNC_ALARM);
      return sync.disconnect();
    },
    // The summary history is part of Snippets now (summaries that aren't snippets show there with their status).
    'open:history': () => handlers['open:snippets']({}),
    'kg:run': (msg, sender) => {
      requireExtensionPage(sender);
      knowledge.run({ manual: true }).catch(quietly('knowledge graph'));
      return { ok: true };
    },
    'kg:stop': (msg, sender) => {
      requireExtensionPage(sender);
      knowledge.stop();
      return { ok: true };
    },
    // Read-only lookups for the content script (hovercards, "you've seen this before"); no AI.
    'kg:names': async () => ({ ok: true, index: (await readKG()).index }),
    'kg:page-check': async (msg) => ({ ok: true, ...(await pageCheck({ url: String(msg.url || ''), title: String(msg.title || ''), text: String(msg.text || '') })) }),
    'open:topic': (msg) => ext.tabs.create({ url: ext.runtime.getURL(`pages/topic.html?e=${encodeURIComponent(String(msg.key || ''))}`) }),
    'kg:ask': async (msg, sender) => {
      requireExtensionPage(sender);
      return { ok: true, ...(await askPKG({ question: String(msg.question || '').slice(0, 1000), days: Number(msg.days) || 0, site: String(msg.site || ''), kind: String(msg.kind || '') })) };
    },
    'kg:weekly': async (msg, sender) => {
      requireExtensionPage(sender);
      return { ok: true, weekly: await writeWeekly() };
    },
    'kg:output': async (msg, sender) => {
      requireExtensionPage(sender);
      return { ok: true, ...(await makeOutput({ kind: String(msg.kind || ''), keys: (Array.isArray(msg.keys) ? msg.keys : []).map(String).slice(0, 4) })) };
    },
    'kg:page': async (msg, sender) => {
      requireExtensionPage(sender);
      return { ok: true, page: await knowledge.writePage(String(msg.key || '')) };
    },
    'summary:find': async (msg) => ({ ok: true, record: await jobs.find(msg.url, msg.fingerprint) }),
    'summary:for-url': async (msg) => ({ ok: true, records: await jobs.forUrl(msg.url) }),
    'summary:seen': async (msg) => {
      await jobs.markSeen(msg.ids || []);
      return { ok: true };
    },
    'summary:delete': async (msg, sender) => {
      requireExtensionPage(sender);
      await jobs.remove(msg.ids || []);
      return { ok: true };
    },
  };

  // ---------------------------------------------------------------------------
  // The knowledge graph (kgworker.js, shared/kg.js): built while the browser is idle
  // ---------------------------------------------------------------------------

  const knowledge = S.createKnowledgeWorker({
    ext,
    getSettings,
    runChat: async (messages, { json }) => {
      const { connection, api } = await resolveChat();
      return chat({ connection, api, messages, json });
    },
    getModel: async () => {
      const { connection } = await resolveChat();
      return { api: connection.api, model: connection.model };
    },
    onProblem: quietly('knowledge graph'),
  });
  const KG_ALARM = 'soroagent-kg';
  // The weekly "what you learned", written by itself once a week after an idle run (same switch).
  async function maybeWeekly(result) {
    if (!result || result.skipped || result.error) return;
    const { kgWeekly } = await ext.storage.local.get('kgWeekly');
    if (kgWeekly && Date.now() - Date.parse(kgWeekly.at) < 7 * 86400000) return;
    await writeWeekly();
  }
  if (ext.idle) {
    ext.idle.setDetectionInterval(60);
    ext.idle.onStateChanged.addListener((state) => {
      knowledge.setUserActive(state === 'active');
      if (state === 'idle') knowledge.run().then(maybeWeekly).catch(quietly('knowledge graph'));
    });
    ext.alarms.create(KG_ALARM, { periodInMinutes: 15 });
    ext.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name !== KG_ALARM) return;
      ext.idle.queryState(120).then((state) => state === 'idle' && knowledge.run().then(maybeWeekly)).catch(quietly('knowledge graph'));
    });
  }
  // The graph as the rest of the extension reads it (hovercards, page checks, the address bar):
  // built on demand and kept until a snippet or the graph changes.
  let kgCache = null;
  async function readKG() {
    if (kgCache) return kgCache;
    const all = await ext.storage.local.get(null);
    const pick = (prefix) => Object.fromEntries(Object.keys(all).filter((k) => k.startsWith(prefix)).map((k) => [k.slice(prefix.length), all[k]]));
    const notes = Object.keys(all).filter((k) => k.startsWith('snippet:')).map((k) => all[k]).filter((n) => n && n.id);
    const kg = S.kg.buildKG({ notes, extractions: pick('kgx:'), comparisons: pick('kgcmp:'), edits: all.kgEdits });
    const index = S.kg.nameIndex(kg, pick('kgpage:'));
    kgCache = { kg, notes, notesById: new Map(notes.map((n) => [n.id, n])), index, matcher: S.kg.nameMatcher(index) };
    return kgCache;
  }

  // What you already know about the page you're on: the entities it mentions that you've read about,
  // claims from it that contradict earlier ones, and the same story saved from another site.
  async function pageCheck({ url = '', title = '', text = '' }) {
    const { kg, notes, notesById, matcher } = await readKG();
    const K = S.kg;
    const key = S.pageKey(url);
    const here = notes.filter((n) => S.pageKey(n.url) === key);
    const mentions = K.findMentions(`${title}\n${String(text).slice(0, 20000)}`, matcher).slice(0, 6).map(({ entry, count }) => ({ key: entry.key, name: entry.name, type: entry.type, notes: entry.notes, disputes: entry.disputes, count }));
    const contradicts = [];
    for (const n of here) {
      for (const c of kg.claims.values()) {
        if (c.noteId !== n.id) continue;
        for (const id of c.contradicts) {
          const other = kg.claims.get(id);
          const note = other && notesById.get(other.noteId);
          if (note && contradicts.length < 3) contradicts.push({ text: c.text, other: { text: other.text, at: other.at, host: K.hostOf(note.url), id: note.id, key: other.about[0] || '' } });
        }
      }
    }
    const story = here.length ? null : K.sameStory(title, notes, { url });
    return {
      saved: here.length,
      mentions,
      contradicts,
      sameStory: story ? { id: story.id, title: story.title || story.pageTitle, host: K.hostOf(story.url), at: story.createdAt } : null,
    };
  }

  // Asking your PKG, the weekly review and outputs (shared/kguse.js): on a click, with your AI.
  const kgChat = async (action, vars) => {
    const { connection, api } = await resolveChat();
    const settings = await getSettings();
    const persona = S.customPersona(settings, 'default');
    return S.stripThinking(await chat({ connection, api, messages: S.buildMessages(action, vars, persona ? { persona } : {}), json: action === 'outCards' }));
  };

  async function askPKG({ question, days = 0, site = '', kind = '' }) {
    const U = S.kguse;
    const { kg, notesById } = await readKG();
    const time = U.parseTimeFilter(question, { days });
    const filters = { since: time.since, site, kind };
    const res = await library.search(U.withoutTime(question) || question, { limit: 12, since: time.since, where: (n) => U.passes(n, filters) });
    let hits = (res.results || []).map((r) => r.note);
    // "What did I read last week?": nothing to search for, so everything in that time (newest first).
    if (!hits.length && (time.since || site || kind)) hits = [...notesById.values()].filter((n) => U.passes(n, filters)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 12);
    const ctx = U.askContext({ kg, notesById, hits, question, filters });
    if (!ctx.content) return { answer: '', cites: [], empty: true, label: time.label };
    const limits = [time.label && `Only what the reader saved ${time.label}.`, site && `Only from ${site}.`, kind && `Only their ${kind} snippets.`].filter(Boolean).join(' ');
    const answer = await kgChat('askLibrary', { question, context: limits, content: ctx.content });
    return { answer, cites: U.resolveCites(ctx.cites, kg, notesById), label: time.label, entities: ctx.entities };
  }

  async function writeWeekly({ now = Date.now() } = {}) {
    const U = S.kguse;
    const { kg, notes, notesById } = await readKG();
    const from = now - 7 * 86400000;
    const input = U.weeklyInput(kg, notes, { from, to: now });
    if (!input) return null;
    const text = await kgChat('weekly', { content: input.content });
    const weekly = { at: new Date(now).toISOString(), from: new Date(from).toISOString(), count: input.count, text, cites: input.cites };
    await ext.storage.local.set({ kgWeekly: weekly });
    return { ...weekly, sources: U.resolveCites(input.cites, kg, notesById) };
  }

  async function makeOutput({ kind, keys }) {
    const U = S.kguse;
    const out = U.OUTPUTS[kind];
    if (!out) throw new Error('Unknown output.');
    const { kg, notesById } = await readKG();
    const input = U.outputInput(kg, keys, notesById);
    if (!input) return { text: '', cites: [], empty: true };
    const reply = await kgChat(out.prompt, { question: input.question, content: input.content });
    const cites = U.resolveCites(input.cites, kg, notesById);
    if (kind === 'cards') return { cards: U.parseCards(reply), cites, title: input.question };
    return { text: reply, cites, title: input.question };
  }

  // "kg <words>" in the address bar: your PKG's entities and snippets as suggestions.
  if (ext.omnibox) {
    const xml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const plainText = typeof browser !== 'undefined'; // Firefox shows descriptions as plain text
    const fmt = (s, tag) => (plainText ? String(s) : tag ? `<${tag}>${xml(s)}</${tag}>` : xml(s));
    try {
      ext.omnibox.setDefaultSuggestion({ description: plainText ? 'Search your soroagent PKG' : 'Search your soroagent PKG for <match>%s</match>' });
    } catch {
      // older Firefox: no default suggestion
    }
    ext.omnibox.onInputChanged.addListener((text, suggest) => {
      const query = String(text || '').trim();
      if (query.length < 2) return;
      (async () => {
        const { kg } = await readKG();
        const entities = S.kg.rankEntities(kg, { query }).slice(0, 3).map((e) => ({
          content: `soroagent:topic:${e.key}`,
          description: `${fmt(e.name, 'match')} ${fmt(`· ${S.kg.TYPE_LABEL[e.type]} · ${e.noteIds.length} snippet${e.noteIds.length === 1 ? '' : 's'}`, 'dim')}`,
        }));
        const res = await library.search(query, { limit: 6 });
        const notes = (res.results || []).slice(0, 6 - entities.length).map((r) => ({
          content: `soroagent:snippet:${r.note.id}`,
          description: `${fmt(r.note.title || r.note.pageTitle || 'Untitled')} ${fmt(`· ${S.kg.hostOf(r.note.url)}`, 'url')}`,
        }));
        suggest([...entities, ...notes]);
      })().catch(quietly('omnibox'));
    });
    ext.omnibox.onInputEntered.addListener((text, disposition) => {
      const m = String(text).match(/^soroagent:(topic|snippet):(.+)$/);
      const path = m ? (m[1] === 'topic' ? `pages/topic.html?e=${encodeURIComponent(m[2])}` : `pages/snippets.html#${encodeURIComponent(m[2])}`) : `pages/snippets.html#q=${encodeURIComponent(String(text).trim())}`;
      const url = ext.runtime.getURL(path);
      if (disposition === 'currentTab') ext.tabs.update({ url }).catch(quietly('omnibox'));
      else ext.tabs.create({ url, active: disposition !== 'newBackgroundTab' }).catch(quietly('omnibox'));
    });
  }

  // A deleted snippet takes what was extracted from it along.
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const gone = Object.keys(changes).filter((k) => k.startsWith('snippet:') && !changes[k].newValue).map((k) => k.slice(8));
    if (gone.length) ext.storage.local.remove(gone.flatMap((id) => [`kgx:${id}`, `kgcmp:${id}`])).catch(() => {});
    if (Object.keys(changes).some((k) => k.startsWith('snippet:') || (k.startsWith('kg') && k !== 'kgState'))) kgCache = null;
  });

  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // "Switch to the side panel" from the floating panel: open it right away, inside the click's
    // message (browsers only open a side panel in response to a user action), then save the mode.
    if (msg && msg.type === 'appearance:set' && msg.mode === 'sidepanel' && sender.tab && hasSidePanel) {
      Promise.resolve(openSidePanel(sender.tab)).catch(quietly('open side panel'));
    }
    const handler = msg && handlers[msg.type];
    if (!handler) return false;
    Promise.resolve()
      .then(() => handler(msg, sender))
      .then((result) => sendResponse(result === undefined ? { ok: true } : result))
      .catch((err) => {
        if (msg.type.startsWith('llm:') || msg.type.startsWith('ai:')) recordLlmError(err, null, msg.type);
        else if (!/^Not allowed/.test(err.message)) diag.record({ area: 'error', code: err.code || 'handler', message: err.message, detail: { where: msg.type } });
        sendResponse(errorPayload(err));
      });
    return true; // respond asynchronously
  });

  // ---------------------------------------------------------------------------
  // Talking to the assistant in a tab
  // ---------------------------------------------------------------------------

  async function sendToTab(tabId, message) {
    try {
      return await ext.tabs.sendMessage(tabId, message);
    } catch {
      // Tab was open before the extension was installed or reloaded: inject and retry.
      const files = ext.runtime.getManifest().content_scripts.flatMap((script) => script.js);
      await ext.scripting.executeScript({ target: { tabId }, files });
      return ext.tabs.sendMessage(tabId, message);
    }
  }

  async function sendToActiveTab(message) {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id !== undefined) return sendToTab(tab.id, message);
  }


  const MENU_ITEMS = [
    { id: 'soroagent-summarize', title: 'Summarize this page', contexts: ['page'], action: 'summarize' },
  ];
  // PDFs open in the browser's viewer, where content scripts can't run: read them in the side panel.
  const PDF_PATTERNS = ['*://*/*.pdf', '*://*/*.PDF', '*://*/*.pdf?*', '*://arxiv.org/pdf/*', '*://*.arxiv.org/pdf/*'];
  const PDF_MENU_ITEMS = [
    { id: 'soroagent-pdf-link', title: 'Summarize this PDF with soroagent', contexts: ['link'], targetUrlPatterns: PDF_PATTERNS },
    { id: 'soroagent-pdf-page', title: 'Summarize this PDF with soroagent', contexts: ['page', 'frame'], documentUrlPatterns: PDF_PATTERNS },
  ];
  const pdfLocal = ext.offscreen ? null : S.createPdfReader(ext); // Firefox: pdf.js runs right here

  // Right-click on the toolbar owl.
  const ACTION_MENU_ITEMS = [
    { id: 'soroagent-open-snippets', title: 'Snippets', open: () => handlers['open:snippets']({}) },
    { id: 'soroagent-feedback', title: 'Send feedback', open: () => ext.tabs.create({ url: S.feedbackUrl('toolbar') }) },
    { id: 'soroagent-open-settings', title: 'Settings', open: () => ext.runtime.openOptionsPage() },
  ];

  async function createMenus() {
    await ext.contextMenus.removeAll();
    for (const item of MENU_ITEMS) {
      ext.contextMenus.create({ id: item.id, title: item.title, contexts: item.contexts });
    }
    for (const item of ACTION_MENU_ITEMS) ext.contextMenus.create({ id: item.id, title: item.title, contexts: ['action'] });
    if (hasSidePanel) for (const { id, title, contexts, targetUrlPatterns, documentUrlPatterns } of PDF_MENU_ITEMS) ext.contextMenus.create({ id, title, contexts, ...(targetUrlPatterns ? { targetUrlPatterns } : {}), ...(documentUrlPatterns ? { documentUrlPatterns } : {}) });
  }

  ext.contextMenus.onClicked.addListener((info, tab) => {
    if (PDF_MENU_ITEMS.some((m) => m.id === info.menuItemId)) {
      // Open the side panel inside the click (browsers require it), then hand it the PDF.
      if (tab) openSidePanel(tab).catch(quietly('open side panel'));
      ext.storage.session.set({ pdfRequest: { url: info.linkUrl || info.pageUrl || (tab && tab.url) || '', tabId: tab && tab.id, at: Date.now() } }).catch(() => {});
      return;
    }
    const actionItem = ACTION_MENU_ITEMS.find((m) => m.id === info.menuItemId);
    if (actionItem) {
      actionItem.open();
      return;
    }
    const item = MENU_ITEMS.find((m) => m.id === info.menuItemId);
    if (!item || !tab || tab.id === undefined) return;
    sendToTab(tab.id, { type: 'assistant:run', action: item.action, selectionText: info.selectionText || '' }).catch(
      quietly('context menu')
    );
  });

  // Clicking the toolbar owl opens (or closes) the panel on the current page. Pages extensions
  // can't run on (browser pages, web stores) get the settings page instead.
  // Where soroagent opens: the side panel (Chrome's side panel, Firefox's sidebar; no site CSS, and
  // it stays open across tabs and pages) or the floating panel on the page. Kept in memory because
  // the browser only lets a side panel open during the click or key press itself.
  const hasSidePanel = Boolean(ext.sidePanel || ext.sidebarAction);
  let openIn = 'sidepanel';
  const applyOpenIn = (settings) => {
    openIn = hasSidePanel && settings.openIn !== 'page' ? 'sidepanel' : 'page';
    // Chrome opens the side panel from the toolbar button by itself; Firefox calls onClicked.
    if (ext.sidePanel && ext.sidePanel.setPanelBehavior) ext.sidePanel.setPanelBehavior({ openPanelOnActionClick: openIn === 'sidepanel' }).catch(() => {});
  };
  getSettings().then(applyOpenIn).catch(() => {});
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) applyOpenIn({ ...S.DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) });
  });

  function openSidePanel(tab) {
    if (ext.sidebarAction) return ext.sidebarAction.toggle(); // Firefox
    return ext.sidePanel.open({ windowId: tab.windowId });
  }
  function togglePagePanel(tab) {
    if (!tab || tab.id === undefined || !/^https?:/.test(tab.url || '')) {
      ext.runtime.openOptionsPage();
      return;
    }
    sendToTab(tab.id, { type: 'assistant:toggle' }).catch(() => ext.runtime.openOptionsPage());
  }

  ext.action.onClicked.addListener((tab) => {
    if (openIn === 'sidepanel') openSidePanel(tab).catch(quietly('toolbar button'));
    else togglePagePanel(tab);
  });

  ext.commands.onCommand.addListener((command, tab) => {
    if (command === 'open-soroagent') {
      if (openIn === 'sidepanel') {
        const open = tab ? openSidePanel(tab) : ext.windows.getLastFocused().then((w) => ext.sidePanel.open({ windowId: w.id }));
        Promise.resolve(open).catch(quietly('shortcut'));
      } else if (tab) togglePagePanel(tab);
      else sendToActiveTab({ type: 'assistant:toggle' }).catch(quietly('shortcut'));
    } else if (command === 'toggle-assistant') {
      sendToActiveTab({ type: 'assistant:toggle' }).catch(quietly('shortcut'));
    }
  });

  // Upgrade stored data in place whenever a new version is installed (and on first start).
  ext.storage.local.get('meta').then(({ meta }) => {
    const from = Number((meta && meta.schemaVersion) || 1);
    return globalThis.soroagent.migrate(ext.storage.local).then(
      (changed) => from !== globalThis.soroagent.SCHEMA_VERSION && diag.record({ area: 'migration', code: 'upgraded', message: 'Stored data upgraded', detail: { from, to: globalThis.soroagent.SCHEMA_VERSION, changed } }),
      (err) => {
        console.warn('[soroagent] Storage upgrade failed:', err);
        diag.record({ area: 'migration', code: 'failed', message: err.message, detail: { from, to: globalThis.soroagent.SCHEMA_VERSION } });
      }
    );
  }).catch(() => {});

  ext.runtime.onInstalled.addListener(async (details) => {
    createMenus();
    if (details.reason === 'update') {
      // People updating from before the first-run setup existed are already set up.
      const { settings } = await ext.storage.local.get('settings');
      if (settings && settings.onboarded === undefined) await ext.storage.local.set({ settings: { ...settings, onboarded: true } });
      return;
    }
    if (details.reason !== 'install') return;
    // A fresh install: if an automatic backup from an earlier install is still in Downloads,
    // the welcome (settings) page offers to restore it.
    try {
      const file = await S.findBackupFile();
      if (file) {
        await ext.storage.local.set({ restoreOffer: file });
        ext.runtime.openOptionsPage(); // the welcome-back restore lives there
        return;
      }
    } catch (err) {
      console.warn('[soroagent] Could not look for an earlier backup:', err);
    }
    // Brand new: a friendly first-run setup (not the full settings page).
    ext.tabs.create({ url: ext.runtime.getURL('pages/onboard.html') });
  });
  ext.runtime.onStartup.addListener(createMenus);

  // Keep the Firefox rewrite target current even before the first request after a restart.
  getConnection().catch(() => {});
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.settings || changes.keysVersion)) {
      apiCache.clear();
      getConnection().catch(() => {});
    }
  });
})();

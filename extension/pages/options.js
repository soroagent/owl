(function () {
  'use strict';

  const S = globalThis.soroagent;
  S.watchPageErrors('settings');
  const { ext, DEFAULT_SETTINGS, PROVIDER_PRESETS, CLOUD_PROVIDERS } = S;
  const $ = (id) => document.getElementById(id);
  const TEXT_FIELDS = ['baseUrl', 'browserEngine', 'provider', 'apiKey', 'launcherPosition', 'cloudProvider', 'customBaseUrl', 'researchEngine', 'searxUrl', 'autoCapture'];
  const NUMBER_FIELDS = ['temperature', 'contextWindow', 'maxPageChars', 'captureMinSeconds'];
  const CHECK_FIELDS = ['hovercards', 'resurface', 'allowThinking', 'webFallback', 'followUps', 'pkgDwell', 'xBookmarksOffer', 'autoBackup', 'captureLabel', 'semanticSearch'];
  // 'auto' | true | false: 'auto' follows the AI (on unless it's a cloud API; see S.autoOn).
  const AUTO_FIELDS = ['preparePages', 'pageQuestions', 'knowledgeGraph'];
  const autoTouched = new Set();

  let saved = { ...DEFAULT_SETTINGS }; // last saved settings, for fields this page doesn't show
  let hiddenSites = [];
  let pendingKeys = {}; // keys typed on this page, not yet saved
  let savedKeys = {}; // provider -> last 4 characters of the saved key (the page never gets the key itself)
  let modelChoice = { local: '', cloud: {} }; // model picked per connection while editing
  let testRun = 0;

  const source = () => document.querySelector('input[name="source"]:checked')?.value || 'local';
  const currentModelKey = () => (source() === 'cloud' ? $('cloudProvider').value : 'local');

  function rememberModel() {
    const value = $('model').value;
    if (currentModelKey() === 'local') modelChoice.local = value;
    else modelChoice.cloud[currentModelKey()] = value;
  }

  function chosenModel() {
    return currentModelKey() === 'local' ? modelChoice.local : modelChoice.cloud[currentModelKey()] || '';
  }

  // ---------------------------------------------------------------------------
  // Prompts: the system prompt per prompt set, edited here and optimized by the model.
  // ---------------------------------------------------------------------------

  const promptSets = S.listPromptSets().sort((a, b) => (a.id === 'default' ? -1 : b.id === 'default' ? 1 : a.label.localeCompare(b.label)));
  let customPrompts = {};
  let promptSiteId = 'default';
  let undoText = null;
  const builtInPrompt = (id) => (promptSets.find((p) => p.id === id) || promptSets[0]).persona;

  // Keeps the text being edited in customPrompts (or drops it when it's the built-in one).
  function keepPromptEdit() {
    const text = $('promptText').value.trim();
    if (!text || text === builtInPrompt(promptSiteId).trim()) delete customPrompts[promptSiteId];
    else customPrompts[promptSiteId] = text;
  }

  function showPrompt(id) {
    promptSiteId = id;
    const set = promptSets.find((p) => p.id === id) || promptSets[0];
    $('promptSite').value = set.id;
    $('promptText').value = customPrompts[id] || builtInPrompt(id);
    $('promptHosts').textContent = set.id === 'default' ? 'Used on every website without its own prompt below.' : `Used on ${set.hosts.join(', ')}.`;
    $('promptBadge').hidden = !customPrompts[id];
    $('undoPrompt').hidden = true;
    undoText = null;
    $('promptStatus').textContent = '';
  }

  function fillPrompts(settings) {
    customPrompts = { ...(settings.customPrompts || {}) };
    $('promptSite').replaceChildren(...promptSets.map((p) => Object.assign(document.createElement('option'), {
      value: p.id,
      textContent: p.id === 'default' ? 'All websites (default)' : `${p.label} · ${p.hosts.slice(0, 2).join(', ')}${p.hosts.length > 2 ? '…' : ''}`,
    })));
    showPrompt(promptSiteId);
  }

  $('promptSite').addEventListener('change', () => {
    keepPromptEdit();
    showPrompt($('promptSite').value);
  });
  $('promptText').addEventListener('input', () => {
    keepPromptEdit();
    $('promptBadge').hidden = !customPrompts[promptSiteId];
  });
  $('resetPrompt').addEventListener('click', () => {
    undoText = $('promptText').value;
    delete customPrompts[promptSiteId];
    $('promptText').value = builtInPrompt(promptSiteId);
    $('promptBadge').hidden = true;
    $('undoPrompt').hidden = false;
    $('promptStatus').textContent = 'Back to the built-in prompt. Save to keep it.';
  });
  $('undoPrompt').addEventListener('click', () => {
    if (undoText === null) return;
    $('promptText').value = undoText;
    keepPromptEdit();
    $('promptBadge').hidden = !customPrompts[promptSiteId];
    $('undoPrompt').hidden = true;
    $('promptStatus').textContent = '';
  });

  $('optimizePrompt').addEventListener('click', async () => {
    const set = promptSets.find((p) => p.id === promptSiteId);
    const current = $('promptText').value.trim() || builtInPrompt(promptSiteId);
    const button = $('optimizePrompt');
    button.disabled = true;
    $('promptStatus').className = 'muted working';
    $('promptStatus').textContent = 'Your model is rewriting the prompt…';
    try {
      const reply = await S.askModel([
        {
          role: 'system',
          content: 'You are an expert prompt engineer. You improve system prompts for soroagent, a browser assistant that summarizes web pages and answers questions about them. Reply with the improved system prompt only: plain text, no preamble, no quotes, no headings.',
        },
        {
          role: 'user',
          content: `Website: ${set.id === 'default' ? 'any website' : `${set.label} (${set.hosts.join(', ')})`}

Current system prompt:
<prompt>
${current}
</prompt>

Rewrite it to get better results on this website. Keep the intent and every rule it states. Make it specific to how content on this site works, and clear about accuracy, what to prioritize, tone and format (Markdown). Keep it under 120 words, in the second person, starting with "You are soroagent".`,
        },
      ]);
      const improved = S.stripThinking(reply).replace(/^```\w*\n?|```$/g, '').replace(/^<prompt>|<\/prompt>$/g, '').replace(/^["“]|["”]$/g, '').trim();
      if (!improved) throw new Error('The model returned an empty prompt.');
      undoText = $('promptText').value;
      $('promptText').value = improved;
      keepPromptEdit();
      $('promptBadge').hidden = !customPrompts[promptSiteId];
      $('undoPrompt').hidden = false;
      $('promptStatus').className = 'muted';
      $('promptStatus').textContent = 'Optimized. Review it, then Save.';
    } catch (err) {
      $('promptStatus').className = 'muted';
      $('promptStatus').textContent = `Couldn't optimize: ${err.message}${err.hint ? ` ${err.hint}` : ''}`;
    } finally {
      button.disabled = false;
    }
  });

  function readForm() {
    rememberModel();
    keepPromptEdit();
    const appearance = document.querySelector('input[name="appearance"]:checked')?.value || 'owl';
    const values = { ...saved, source: source(), ...S.APPEARANCES[appearance], hiddenSites, model: modelChoice.local, cloudModels: { ...modelChoice.cloud } };
    for (const id of TEXT_FIELDS) values[id] = $(id).value.trim();
    for (const id of NUMBER_FIELDS) {
      const n = Number($(id).value);
      values[id] = Number.isFinite(n) && $(id).value !== '' ? n : DEFAULT_SETTINGS[id];
    }
    for (const id of CHECK_FIELDS) values[id] = $(id).checked;
    // Keep 'auto' unless the box was changed by hand.
    for (const id of AUTO_FIELDS) values[id] = !autoTouched.has(id) && (saved[id] === 'auto' || saved[id] === undefined) ? 'auto' : $(id).checked;
    values.baseUrl = values.baseUrl || DEFAULT_SETTINGS.baseUrl;
    values.customPrompts = { ...customPrompts };
    values.captureExclude = $('captureExclude').value.split(/[\n,]+/).map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean).slice(0, 200);
    return values;
  }

  // PKG reading time: how much is counted, and a way to clear it.
  async function showDwell() {
    const { pkgDwell = {} } = await ext.storage.local.get('pkgDwell');
    const pages = Object.keys(pkgDwell).length;
    $('dwellMsg').textContent = pages ? `${S.readingTime(Object.values(pkgDwell).reduce((a, b) => a + b, 0))} on ${pages} saved page${pages === 1 ? '' : 's'}` : 'None counted yet';
  }
  $('clearDwell').addEventListener('click', async () => {
    if (!confirm('Clear the reading time counted on your saved pages? Your PKG keeps its snippets and topics.')) return;
    await ext.storage.local.remove('pkgDwell');
    showDwell();

  // What's new (seenLists) and Hide clutter (declutterSites): what's remembered, and a way to forget it.
  async function showBrowse() {
    const { seenLists = {} } = await ext.storage.local.get('seenLists');
    const pages = Object.keys(seenLists).length;
    const sites = ((await S.getSettings()).declutterSites || []).length;
    $('browseMsg').textContent = pages || sites ? `What's new on ${pages} page${pages === 1 ? '' : 's'}; clutter hidden on ${sites} site${sites === 1 ? '' : 's'}` : 'Nothing remembered';
  }
  // The knowledge graph: what was extracted, compared and written, and your corrections.
  const graphKeys = (all) => Object.keys(all).filter((k) => /^kg(x|cmp|page):/.test(k) || ['kgEdits', 'kgState', 'kgWeekly', 'kgReview'].includes(k));
  async function showGraph() {
    const all = await ext.storage.local.get(null);
    const n = Object.keys(all).filter((k) => k.startsWith('kgx:')).length;
    $('graphMsg').textContent = n ? `${n} snippet${n === 1 ? '' : 's'} read into the graph` : 'Nothing in the graph yet';
  }
  $('clearGraph').addEventListener('click', async () => {
    if (!confirm('Clear the knowledge graph? Your snippets stay; the graph is built again from them, and your merges and renames are lost.')) return;
    await ext.storage.local.remove(graphKeys(await ext.storage.local.get(null)));
    showGraph();
  });
  showGraph();
  $('clearBrowse').addEventListener('click', async () => {
    await ext.storage.local.remove('seenLists');
    await S.saveSettings({ declutterSites: [] });
    showBrowse();
  });
  showBrowse();
  });
  showDwell();

  function fillForm(settings) {
    saved = settings;
    for (const id of [...TEXT_FIELDS, ...NUMBER_FIELDS]) $(id).value = settings[id];
    for (const id of CHECK_FIELDS) $(id).checked = Boolean(settings[id]);
    autoTouched.clear();
    for (const id of AUTO_FIELDS) $(id).checked = S.autoOn(settings, id);
    document.querySelector(`input[name="source"][value="${['cloud', 'browser'].includes(settings.source) ? settings.source : 'local'}"]`).checked = true;
    const mode = S.appearanceOf(settings);
    document.querySelector(`input[name="appearance"][value="${mode === 'sidepanel' && !(ext.sidePanel || ext.sidebarAction) ? 'owl' : mode}"]`).checked = true;
    modelChoice = { local: settings.model || '', cloud: { ...(settings.cloudModels || {}) } };
    hiddenSites = [...(settings.hiddenSites || [])];
    renderSites();
    renderPlacements();
    fillPrompts(settings);
    $('captureExclude').value = (settings.captureExclude || []).join('\n');
    showSource();
    showLibraryStatus();
  }

  async function showLibraryStatus() {
    try {
      const st = await ext.runtime.sendMessage({ type: 'library:status' });
      $('libraryStatus').textContent = st.mode === 'meaning'
        ? `Searching by meaning with ${st.model}${st.via === 'ollama' ? ' (on this computer)' : ''}: ${st.indexed} of ${st.total} notes indexed.${st.error ? ` Last error: ${st.error}` : ''}`
        : `Searching by words (${st.total} notes). For search by meaning: ollama pull nomic-embed-text, or use an OpenAI or Gemini key.`;
    } catch {
      $('libraryStatus').textContent = '';
    }
  }
  // ---------------------------------------------------------------------------
  // Markdown folder (Obsidian, Logseq): Chrome-family browsers write to a folder you pick;
  // Firefox writes to Downloads/soroagent/notes/.
  // ---------------------------------------------------------------------------

  const canPickFolder = typeof window.showDirectoryPicker === 'function';
  if (!canPickFolder) $('mdChoose').textContent = 'Write to Downloads/soroagent/notes';
  async function showMarkdown() {
    const st = await ext.runtime.sendMessage({ type: 'md:status' }).catch(() => null);
    const cfg = st && st.config;
    $('mdOff').hidden = Boolean(cfg);
    $('mdOn').hidden = !cfg;
    if (!cfg) return;
    const where = cfg.mode === 'downloads' ? `Downloads/${S.MARKDOWN_DOWNLOADS_FOLDER}` : `the “${cfg.folderName || 'chosen'}” folder`;
    $('mdAllow').hidden = st.code !== 'permission';
    $('mdInfo').textContent = st.error
      ? `Writing to ${where}: ${st.error}`
      : `Writing to ${where} · ${st.files || 0} notes${st.lastExport ? ` · updated ${ago(st.lastExport)}` : ''}${st.skipped ? ` · ${st.skipped} edited in the folder, left as they are` : ''}`;
  }
  $('mdChoose').addEventListener('click', async () => {
    try {
      if (canPickFolder) {
        const dir = await window.showDirectoryPicker({ id: 'soroagent-notes', mode: 'readwrite' });
        if ((await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Permission to write to the folder was not given.');
        await S.markdownHandleStore().set(dir);
        $('mdMsg').textContent = 'Writing your notes…';
        const res = await ext.runtime.sendMessage({ type: 'md:enable', mode: 'folder', folderName: dir.name });
        if (res && res.ok === false) throw new Error(res.error);
      } else {
        $('mdMsg').textContent = 'Writing your notes…';
        const res = await ext.runtime.sendMessage({ type: 'md:enable', mode: 'downloads' });
        if (res && res.ok === false) throw new Error(res.error);
      }
      $('mdMsg').textContent = '';
    } catch (err) {
      if (err.name !== 'AbortError') $('mdMsg').textContent = `Couldn't set up the folder: ${err.message}`;
    }
    showMarkdown();
  });
  $('mdAllow').addEventListener('click', async () => {
    const dir = await S.markdownHandleStore().get();
    if (dir && (await dir.requestPermission({ mode: 'readwrite' })) === 'granted') await ext.runtime.sendMessage({ type: 'md:now' }).catch(() => {});
    showMarkdown();
  });
  $('mdNow').addEventListener('click', async () => {
    $('mdInfo').textContent = 'Writing…';
    await ext.runtime.sendMessage({ type: 'md:now' }).catch(() => {});
    showMarkdown();
  });
  $('mdStop').addEventListener('click', async () => {
    await ext.runtime.sendMessage({ type: 'md:disable' });
    showMarkdown();
  });

  // ---------------------------------------------------------------------------
  // Sync across browsers
  // ---------------------------------------------------------------------------

  const ago = (iso) => {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleString();
  };
  const google = S.createGoogleAuth(ext);
  function showSyncFields() {
    const provider = $('syncProvider').value;
    const gist = provider === 'gist';
    $('webdavFields').hidden = provider !== 'webdav';
    $('syncSecretField').hidden = provider === 'gdrive';
    $('syncConnect').textContent = provider === 'gdrive' ? 'Connect Google Drive' : 'Turn on sync';
    $('syncSecretLabel').textContent = gist ? 'GitHub token (with the "gist" permission)' : 'Password (an app password is best)';
  }
  async function showSync() {
    const st = await ext.runtime.sendMessage({ type: 'sync:status' }).catch(() => null);
    const on = Boolean(st && st.on);
    $('syncOff').hidden = on;
    $('syncOn').hidden = !on;
    if (!on) return;
    $('syncWhere').textContent = `Syncing with ${st.provider === 'gdrive' ? 'your Google Drive' : st.provider === 'gist' ? 'a private GitHub Gist' : st.url}`;
    $('syncReconnect').hidden = !(st.provider === 'gdrive' && st.code === 'auth');
    const others = Object.entries(st.devices || {}).filter(([id]) => id !== st.deviceId).map(([, d]) => d.name);
    $('syncInfo').textContent = [
      st.lastSync ? `Last synced ${ago(st.lastSync)}` : 'Not synced yet',
      `this browser: ${st.deviceName}`,
      others.length ? `also: ${others.join(', ')}` : 'no other browsers yet: set up sync there with the same passphrase',
      st.error ? `Problem: ${st.error}` : '',
    ].filter(Boolean).join(' · ');
  }
  $('syncProvider').addEventListener('change', showSyncFields);
  $('syncConnect').addEventListener('click', async () => {
    const provider = $('syncProvider').value;
    if (provider === 'gdrive' && $('syncPassphrase').value.length < 8) {
      $('syncMsg').textContent = 'Choose a passphrase of at least 8 characters, and use the same one in every browser.';
      return;
    }
    $('syncConnect').disabled = true;
    $('syncMsg').textContent = provider === 'gdrive' ? 'Sign in to Google in the window that opened…' : 'Connecting…';
    if (provider === 'gdrive') {
      try {
        await google.getToken(false, true);
      } catch (err) {
        $('syncConnect').disabled = false;
        $('syncMsg').textContent = /did not approve|cancel|closed/i.test(err.message) ? 'Google sign-in was closed.' : err.message;
        return;
      }
      $('syncMsg').textContent = 'Connecting…';
    }
    const res = await ext.runtime.sendMessage({
      type: 'sync:connect',
      provider,
      url: $('syncUrl').value,
      user: $('syncUser').value,
      secret: $('syncSecret').value,
      passphrase: $('syncPassphrase').value,
    }).catch((err) => ({ ok: false, error: err.message }));
    $('syncConnect').disabled = false;
    if (!res || res.ok === false) {
      $('syncMsg').textContent = (res && res.error) || 'Could not connect.';
      return;
    }
    $('syncSecret').value = '';
    $('syncPassphrase').value = '';
    $('syncMsg').textContent = '';
    showSync();
  });
  $('syncReconnect').addEventListener('click', async () => {
    try {
      await google.getToken(false, true);
    } catch (err) {
      $('syncInfo').textContent = err.message;
      return;
    }
    $('syncInfo').textContent = 'Syncing…';
    await ext.runtime.sendMessage({ type: 'sync:now' }).catch(() => {});
    showSync();
  });
  $('syncNow').addEventListener('click', async () => {
    $('syncInfo').textContent = 'Syncing…';
    await ext.runtime.sendMessage({ type: 'sync:now' }).catch(() => {});
    showSync();
  });
  $('syncStop').addEventListener('click', async () => {
    if (!confirm('Stop syncing in this browser? Your library stays here; other browsers keep syncing.')) return;
    await ext.runtime.sendMessage({ type: 'sync:disconnect' });
    showSync();
  });
  // Automatic AI work follows the AI choice while it's on 'auto'.
  for (const id of AUTO_FIELDS) $(id).addEventListener('change', () => autoTouched.add(id));
  for (const radio of document.querySelectorAll('input[name="source"]')) {
    radio.addEventListener('change', () => {
      for (const id of AUTO_FIELDS) if (!autoTouched.has(id) && (saved[id] === 'auto' || saved[id] === undefined)) $(id).checked = S.autoOn({ [id]: 'auto', source: source() }, id);
    });
  }

  // In-browser AI: Chrome only (Gemini Nano is Chrome's; the Firefox build ships no WebLLM).
  if (S.isFirefox) document.querySelector('input[name="source"][value="browser"]').closest('label').hidden = true;

  // Where soroagent opens; browsers without a side panel only have the floating panel.
  if (!(ext.sidePanel || ext.sidebarAction)) $('appearanceSidepanel').hidden = true;
  $('shortcuts').addEventListener('click', () => ext.tabs.create({ url: /Firefox\//.test(navigator.userAgent) ? 'about:addons' : 'chrome://extensions/shortcuts' }));

  // Report a problem: the flight recorder as Markdown, copied and opened as a pre-filled GitHub issue.
  async function loadReport() {
    const res = await ext.runtime.sendMessage({ type: 'diag:report' }).catch((err) => ({ ok: false, error: err.message }));
    if (res && res.ok) $('diagText').textContent = res.markdown;
    return res;
  }
  $('diagPreview').addEventListener('toggle', () => $('diagPreview').open && loadReport());
  $('diagCopy').addEventListener('click', async () => {
    const res = await loadReport();
    if (!res || !res.ok) {
      $('diagMsg').textContent = `Couldn't build the report: ${(res && res.error) || 'unknown error'}`;
      return;
    }
    let copied = true;
    await navigator.clipboard.writeText(res.markdown).catch(() => (copied = false));
    ext.tabs.create({ url: res.issueUrl });
    $('diagMsg').textContent = `${copied ? 'Copied' : 'Opened'}: ${res.count} event${res.count === 1 ? '' : 's'}. Check the issue before you submit it.`;
  });
  $('diagClear').addEventListener('click', async () => {
    await ext.runtime.sendMessage({ type: 'diag:clear' });
    $('diagMsg').textContent = 'Log cleared.';
    if ($('diagPreview').open) loadReport();
  });

  showSyncFields();
  showSync();
  showMarkdown();

  $('reindex').addEventListener('click', async () => {
    $('libraryStatus').textContent = 'Indexing…';
    await ext.runtime.sendMessage({ type: 'library:reindex' }).catch(() => {});
    showLibraryStatus();
  });

  // Shows the fields for the selected source/provider and resets the model list.
  function showSource() {
    const cloud = source() === 'cloud';
    const browser = source() === 'browser';
    $('localFields').hidden = cloud || browser;
    $('cloudFields').hidden = !cloud;
    $('browserFields').hidden = !browser;
    $('model').closest('.field').hidden = browser; // one model each
    $('browserMsg').textContent = '';
    const provider = S.cloudProvider($('cloudProvider').value);
    $('customBaseUrlField').hidden = provider.id !== 'custom';
    showKeyField();
    $('keyLink').hidden = !provider.keyUrl;
    if (provider.keyUrl) $('keyLink').href = provider.keyUrl;
    $('cloudName').textContent = provider.id === 'custom' ? 'that API' : provider.label;
    $('modelHint').textContent = cloud
      ? 'Larger models give better summaries and filtering; smaller ones are faster and cheaper.'
      : 'Smaller models (3–8B) answer faster; larger ones summarize and filter better.';
    setModelOptions([], chosenModel());
    $('result').hidden = true;
    $('recs').hidden = true;
  }

  function showKeyField() {
    const id = $('cloudProvider').value;
    const provider = S.cloudProvider(id);
    $('cloudKey').value = pendingKeys[id] || '';
    $('cloudKey').placeholder = savedKeys[id]
      ? `Saved key ending in …${savedKeys[id]} — paste a new key to replace it`
      : provider.keyPlaceholder || 'API key';
    $('removeKey').hidden = !savedKeys[id];
  }

  const hasKey = (id) => Boolean(pendingKeys[id] || savedKeys[id]);

  function setModelOptions(models, selected, suggested = '') {
    const select = $('model');
    const ids = models.map((m) => m.id);
    if (selected && !ids.includes(selected)) ids.unshift(selected);
    select.replaceChildren(new Option(suggested ? `Recommended (${suggested})` : 'Recommended', ''));
    for (const id of ids) {
      const info = models.find((m) => m.id === id);
      const label = info && info.name && info.name !== id ? `${info.name} (${id})` : id;
      select.append(new Option(info && info.size ? `${label} · ${info.size}` : label, id));
    }
    select.value = selected || '';
  }

  function renderSites() {
    const box = $('sites');
    box.replaceChildren();
    if (!hiddenSites.length) {
      box.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: 'None' }));
      return;
    }
    for (const site of hiddenSites) {
      const chip = document.createElement('span');
      chip.className = 'site';
      chip.textContent = site;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Show the button on ${site} again`);
      remove.addEventListener('click', () => {
        hiddenSites = hiddenSites.filter((s) => s !== site);
        renderSites();
      });
      chip.append(remove);
      box.append(chip);
    }
  }

  function renderPlacements() {
    const count = Object.keys(saved.launcherPlacements || {}).length;
    $('placementsRow').hidden = !count;
    $('placementsText').textContent = `You've moved the button on ${count} site${count === 1 ? '' : 's'}.`;
  }

  // Local models only: the background ranks installed models for soroagent's tasks.
  function renderRecommendations(res) {
    const box = $('recs');
    box.replaceChildren();
    const recs = (res && !res.cloud && res.recommended) || [];
    box.hidden = !recs.length && !(res && res.pullSuggestion);
    if (box.hidden) return;
    const make = (tag, props) => Object.assign(document.createElement(tag), props);
    box.append(make('div', { className: 'recs-title', textContent: 'Best installed models for soroagent' }));
    for (const rec of recs) {
      const text = make('div', {});
      text.append(make('b', { textContent: `${rec.label}: ${rec.id}` }), make('small', { textContent: rec.reason }));
      const use = make('button', { type: 'button', className: 'btn small', textContent: $('model').value === rec.id ? 'Selected' : 'Use' });
      use.addEventListener('click', () => {
        $('model').value = rec.id;
        rememberModel();
        renderRecommendations(res);
      });
      const row = make('div', { className: 'rec' });
      row.append(text, use);
      box.append(row);
    }
    if (res.pullSuggestion) {
      box.append(make('small', {
        className: 'muted',
        textContent: `${recs.length ? 'For better results' : "None of your models fit well"}, try ${res.pullSuggestion.reason}: ${res.pullSuggestion.command}`,
      }));
    }
    box.append(make('small', { className: 'muted', textContent: 'Ranked by model family, size and speed. Larger models need more memory.' }));
  }

  function showResult(kind, title, detail) {
    $('result').hidden = false;
    $('resultDot').className = `dot ${kind}`;
    const text = $('resultText');
    text.replaceChildren(Object.assign(document.createElement('div'), { textContent: title }));
    if (detail) text.append(Object.assign(document.createElement('pre'), { textContent: detail }));
  }

  async function testConnection() {
    const form = readForm();
    const run = ++testRun;
    const connection = S.resolveConnection(form);
    showResult('connecting', `Connecting to ${connection.cloud || connection.api === 'browser' ? connection.label : form.baseUrl}…`);
    $('test').disabled = true;
    try {
      // Typed keys are tested before saving; otherwise the background uses the saved, encrypted key.
      const res = await ext.runtime.sendMessage({ type: 'llm:status', overrides: { settings: form, apiKeys: { ...pendingKeys } } });
      if (run !== testRun) return; // a newer test started (source or provider changed)
      if (!res || res.ok === false) {
        const forbidden = res && res.code === 'forbidden' && form.source === 'local';
        const fix = forbidden ? S.ollamaOriginsFix(navigator.platform || navigator.userAgent) : null;
        showResult('offline', forbidden ? 'Ollama is blocking browser extensions.' : (res && res.error) || 'Connection failed.', fix ? `Run this once in ${fix.os === 'Windows' ? 'Command Prompt' : 'Terminal'}:\n${fix.command}\n${fix.then}` : res && res.hint);
        if (fix) addCopy(fix.command);
        return;
      }
      if (res.browser) {
        showResult('ready', `Ready: ${res.providerLabel} (${res.model}), running inside this browser.`);
        return;
      }
      const where = res.cloud ? res.providerLabel : `${res.api === 'ollama' ? 'Ollama' : 'OpenAI-compatible API'} at ${res.baseUrl}`;
      const count = res.models.length;
      showResult(
        'ready',
        `Connected to ${where} — ${count} chat model${count === 1 ? '' : 's'} available.`,
        count ? '' : res.cloud ? 'This key has no chat models available.' : 'Download a model first, for example: ollama pull llama3.2'
      );
      setModelOptions(res.models, chosenModel(), res.model);
      renderRecommendations(res);
    } finally {
      if (run === testRun) $('test').disabled = false;
    }
  }

  // A copy button under the result, for the Ollama fix command.
  function addCopy(command) {
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: 'Copy command' });
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(command).then(() => (button.textContent = 'Copied'), () => (button.textContent = 'Select and copy it above'));
      setTimeout(() => (button.textContent = 'Copy command'), 2500);
    });
    $('resultText').append(button);
  }

  // In-browser AI: Chrome's model must be downloaded after a click; WebLLM's weights load once.
  $('browserEngine').addEventListener('change', () => {
    $('browserMsg').textContent = '';
    testConnection();
  });
  $('browserSetup').addEventListener('click', async () => {
    const button = $('browserSetup');
    button.disabled = true;
    try {
      if ($('browserEngine').value === 'nano') {
        $('browserMsg').textContent = 'Chrome is downloading its built-in AI…';
        await S.downloadNano((f) => ($('browserMsg').textContent = `Downloading Chrome's built-in AI… ${Math.round(f * 100)}%`));
      } else {
        $('browserMsg').textContent = 'Starting…';
        await ext.runtime.sendMessage({ type: 'ai:host' });
        await S.webllmClient(ext).load((st) => {
          if (st.phase === 'loading') $('browserMsg').textContent = `${Math.round((st.progress || 0) * 100)}% · ${(st.text || 'Downloading…').replace(/\[[^\]]*\]\s*/, '').slice(0, 80)}`;
        });
        await ext.runtime.sendMessage({ type: 'ai:webllm-ready' });
      }
      $('browserMsg').textContent = 'Ready. Save to use it.';
      testConnection();
    } catch (err) {
      $('browserMsg').textContent = `Couldn't set it up: ${err.message}`;
    } finally {
      button.disabled = false;
    }
  });

  for (const preset of PROVIDER_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn small';
    button.textContent = preset.label;
    button.addEventListener('click', () => {
      $('baseUrl').value = preset.baseUrl;
      $('provider').value = preset.provider;
      testConnection();
    });
    $('presets').append(button);
  }

  for (const provider of CLOUD_PROVIDERS) $('cloudProvider').append(new Option(provider.label, provider.id));

  // Each source/provider keeps its own model choice; rememberModel records it as it changes.
  $('model').addEventListener('change', rememberModel);
  for (const radio of document.querySelectorAll('input[name="source"]')) {
    radio.addEventListener('change', () => {
      showSource();
      if (source() !== 'cloud' || hasKey($('cloudProvider').value)) testConnection();
    });
  }
  $('cloudProvider').addEventListener('change', () => {
    showSource();
    if (hasKey($('cloudProvider').value)) testConnection();
  });

  $('cloudKey').addEventListener('input', () => {
    const value = $('cloudKey').value.trim();
    if (value) pendingKeys[$('cloudProvider').value] = value;
    else delete pendingKeys[$('cloudProvider').value];
  });
  $('cloudKey').addEventListener('change', () => {
    if ($('cloudKey').value.trim()) testConnection();
  });
  $('toggleKey').addEventListener('click', () => {
    const show = $('cloudKey').type === 'password';
    $('cloudKey').type = show ? 'text' : 'password';
    $('toggleKey').textContent = show ? 'Hide' : 'Show';
  });

  $('removeKey').addEventListener('click', async () => {
    const id = $('cloudProvider').value;
    if (!confirm(`Remove the saved ${S.cloudProvider(id).label} API key from this browser?`)) return;
    const res = await ext.runtime.sendMessage({ type: 'keys:remove', provider: id });
    if (res && res.ok) savedKeys = res.keys;
    delete pendingKeys[id];
    showKeyField();
    $('result').hidden = true;
  });

  $('resetPlacements').addEventListener('click', async () => {
    saved = await S.saveSettings({ launcherPlacements: {} });
    renderPlacements();
  });

  // Backup & restore (snippets, summary history, settings; never API keys).
  $('backup').addEventListener('click', async () => {
    const backup = S.buildBackup(await ext.storage.local.get(null), ext.runtime.getManifest().version);
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: `soroagent-backup-${new Date().toISOString().slice(0, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('backupStatus').textContent = `Backed up ${backup.snippets.length} snippets and ${backup.summaries.length} summaries.`;
  });
  // Restores a backup's text. Never overwrites what's already here.
  async function restoreText(text, { includeSettings }) {
    const backup = JSON.parse(text);
    const { updates, counts } = S.planRestore(backup, await ext.storage.local.get(null), { includeSettings });
    await ext.storage.local.set(updates);
    await S.migrate(ext.storage.local);
    if (counts.settings) fillForm(await S.getSettings());
    const parts = [`${counts.snippets} snippet${counts.snippets === 1 ? '' : 's'}`, `${counts.summaries} summar${counts.summaries === 1 ? 'y' : 'ies'}`];
    return `Restored ${parts.join(', ')}${counts.settings ? ' and your settings' : ''}. Anything you already had was kept.`;
  }

  $('restore').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const includeSettings = confirm('Also restore the settings from this backup? (Cancel keeps your current settings.)');
      $('backupStatus').textContent = await restoreText(await file.text(), { includeSettings });
    } catch (err) {
      $('backupStatus').textContent = `Couldn't restore: ${err.message}`;
    }
  });

  // Automatic backup status.
  const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  async function showBackupState() {
    const res = await ext.runtime.sendMessage({ type: 'backup:status' });
    const state = res && res.state;
    $('backupShow').hidden = !(state && state.id);
    if (!state || !state.at) $('autoBackupStatus').textContent = state && state.error ? `Automatic backup failed: ${state.error}` : 'No automatic backup yet.';
    else $('autoBackupStatus').textContent = `Last saved ${when(state.at)}: ${state.snippets} snippets, ${state.summaries} summaries${state.error ? ` (the latest attempt failed: ${state.error})` : ''}.`;
    return res;
  }
  $('backupNow').addEventListener('click', async () => {
    $('autoBackupStatus').textContent = 'Saving…';
    const res = await ext.runtime.sendMessage({ type: 'backup:now' });
    if (!res || res.ok === false) $('autoBackupStatus').textContent = `Couldn't save the backup: ${(res && res.error) || 'unknown error'}`;
    else showBackupState();
  });
  $('backupShow').addEventListener('click', () => ext.runtime.sendMessage({ type: 'backup:show' }));

  // Fresh install with a backup from before: offer to restore it.
  async function restoreFromOffer(offer) {
    // Chrome can read the file directly when "Allow access to file URLs" is on for soroagent.
    try {
      const res = await fetch(S.fileUrl(offer.path));
      if (res.ok) return await res.text();
    } catch {
      // no file access; ask the user to pick it
    }
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({ startIn: 'downloads', types: [{ description: 'soroagent backup', accept: { 'application/json': ['.json'] } }] });
      return (await handle.getFile()).text();
    }
    return new Promise((resolve, reject) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
      input.addEventListener('change', () => (input.files[0] ? input.files[0].text().then(resolve, reject) : reject(new Error('No file chosen.'))));
      input.click();
    });
  }
  async function showRestoreOffer(offer) {
    if (!offer) return;
    $('restoreOffer').hidden = false;
    const name = offer.path.split(/[\\/]/).slice(-2).join('/');
    $('restoreOfferText').textContent = `A backup from ${when(offer.at)} is in your Downloads folder (${name}). Restore your snippets, history and settings in one click.`;
    $('restoreOfferGo').onclick = async () => {
      $('restoreOfferHint').hidden = false;
      $('restoreOfferHint').textContent = 'Restoring… If a file picker opens, choose soroagent-backup.json in Downloads/soroagent.';
      try {
        const message = await restoreText(await restoreFromOffer(offer), { includeSettings: true });
        await ext.storage.local.remove('restoreOffer');
        $('restoreOffer').querySelector('strong').textContent = 'All set. Your data is back.';
        $('restoreOfferText').textContent = message;
        $('restoreOfferHint').hidden = true;
        $('restoreOfferGo').hidden = true;
        $('restoreOfferDismiss').textContent = 'Close';
        if (Object.keys(pendingKeys).length === 0) setTimeout(testConnection, 300);
      } catch (err) {
        $('restoreOfferHint').textContent = err.name === 'AbortError' ? 'No file chosen. You can restore any time from Backup & restore below.' : `Couldn't restore: ${err.message}`;
      }
    };
    $('restoreOfferDismiss').onclick = async () => {
      await ext.storage.local.remove('restoreOffer');
      $('restoreOffer').hidden = true;
    };
  }

  $('test').addEventListener('click', testConnection);

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (Object.keys(pendingKeys).length) {
      const res = await ext.runtime.sendMessage({ type: 'keys:set', keys: pendingKeys });
      if (!res || !res.ok) {
        $('saved').textContent = `Couldn't save the API key: ${(res && res.error) || 'unknown error'}`;
        return;
      }
      savedKeys = res.keys;
      pendingKeys = {};
      showKeyField();
    }
    const form = readForm();
    // Choosing a model here means the panel never needs to suggest one.
    saved = await S.saveSettings({ ...form, onboarded: true, modelTipSeen: Boolean(saved.modelTipSeen || chosenModel()) });
    $('saved').textContent = 'Saved.';
    setTimeout(() => ($('saved').textContent = ''), 2500);
  });

  Promise.all([S.getSettings(), ext.runtime.sendMessage({ type: 'keys:describe' })]).then(([settings, res]) => {
    savedKeys = (res && res.keys) || {};
    const keys = savedKeys;
    fillForm(settings);
    if (settings.source !== 'cloud' || keys[settings.cloudProvider]) testConnection();
    showBackupState().then((res) => showRestoreOffer(res && res.offer)).catch(() => {});
  });
})();

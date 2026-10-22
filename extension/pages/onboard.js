// First-run setup: find an AI without asking anything. Runs as its own tab after install and
// embedded (an iframe) in the panel, where it keeps the key away from the web page: keystrokes in
// this frame belong to soroagent, not to the site.
//
// 1. Ollama on this computer with a model → use it, silently. Chrome's built-in AI already
//    downloaded, or the in-browser AI already downloaded → use it, silently.
// 2. Ollama answers but blocks extensions (403) → the one command that fixes it, ready to copy.
// 3. Otherwise: one click for Chrome's built-in AI or the in-browser AI (with a progress bar), or a
//    cloud key, or Ollama/LM Studio.
//
// With ?sync it shows only the sync setup (offered once the library has a few things in it).
(function () {
  'use strict';

  const S = globalThis.soroagent;
  const { ext, CLOUD_PROVIDERS } = S;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const embedded = params.has('embed');
  const syncOnly = params.has('sync');
  document.body.classList.add(embedded ? 'embed' : 'tab');
  if (embedded) $('hello').hidden = true; // the panel shows its own greeting

  const SECTIONS = ['detect', 'fix', 'choices', 'cloud', 'local', 'sync'];
  function show(...ids) {
    for (const id of SECTIONS) $(id).hidden = !ids.includes(id);
    $('keyNote').hidden = !ids.includes('cloud');
    reportHeight();
  }

  function status(text, kind = '') {
    $('status').className = `status ${kind}`;
    $('status').textContent = text;
    reportHeight();
  }

  async function finish(res, { auto = false } = {}) {
    await S.saveSettings({ onboarded: true, modelTipSeen: true });
    const what = res.providerLabel || 'your model';
    const model = res.model ? ` (${res.model})` : '';
    const where = res.local ? ' Nothing you read leaves this computer.' : '';
    status(`${auto ? `You're all set: I found ${what} on this computer and I'll use it${model}.` : `You're all set: connected to ${what}${model}.`}${where} ${embedded ? 'Ask me anything about this page!' : 'Click the owl on any website to start.'}`, 'ok');
    show();
    $('doneRow').hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Detection
  // ---------------------------------------------------------------------------

  let detected = null;

  async function detect() {
    show('detect');
    status('');
    $('doneRow').hidden = true;
    detected = await ext.runtime.sendMessage({ type: 'ai:detect' }).catch(() => null);
    const d = detected || { ollama: { state: 'offline' }, nano: 'unavailable', webgpu: false };
    if (d.ollama.state === 'ok') {
      await S.saveSettings({ source: 'local', baseUrl: S.DEFAULT_SETTINGS.baseUrl, provider: 'auto', model: d.ollama.model || '' });
      return finish({ providerLabel: 'Ollama', model: d.ollama.model, local: true }, { auto: true });
    }
    if (d.nano === 'available') {
      await S.saveSettings({ source: 'browser', browserEngine: 'nano' });
      return finish({ providerLabel: "Chrome's built-in AI", model: 'Gemini Nano', local: true }, { auto: true });
    }
    if (d.webllmReady) {
      await S.saveSettings({ source: 'browser', browserEngine: 'webllm' });
      return finish({ providerLabel: 'the in-browser AI', model: 'Qwen2.5-1.5B', local: true }, { auto: true });
    }
    showChoices();
  }

  function showChoices() {
    const d = detected || {};
    $('useNano').hidden = !['downloadable', 'downloading'].includes(d.nano);
    $('useWebllm').hidden = !d.webgpu;
    $('progress').hidden = true;
    if (d.ollama && d.ollama.state === 'forbidden') {
      showFix('forbidden');
      $('choices').hidden = false; // the other options stay available below
      return;
    }
    if (d.ollama && d.ollama.state === 'no-models') {
      showFix('no-models');
      $('choices').hidden = false;
      return;
    }
    show('choices');
  }

  // Ollama answered but refused (403): the fix, the moment we know. Or it has no model yet.
  function showFix(kind) {
    if (kind === 'forbidden') {
      const fix = S.ollamaOriginsFix(navigator.platform || navigator.userAgent);
      $('fixTitle').textContent = "Ollama is running, but it's blocking browser extensions";
      $('fixWhy').textContent = `Ollama only answers apps it trusts. Run this once in ${fix.os === 'Windows' ? 'Command Prompt' : 'Terminal'} to let browser extensions (and no websites) use it:`;
      $('fixCmd').textContent = fix.command;
      $('fixThen').textContent = `${fix.then} Then click Check again.`;
    } else {
      $('fixTitle').textContent = "Ollama is running, but it has no AI model yet";
      $('fixWhy').textContent = 'Download one (about 4.7 GB, once) by running this in Terminal:';
      $('fixCmd').textContent = S.PULL_SUGGESTION ? S.PULL_SUGGESTION.command : 'ollama pull qwen2.5:7b';
      $('fixThen').textContent = 'When it finishes, click Check again.';
    }
    show('fix');
  }

  $('fixCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('fixCmd').textContent);
      $('fixCopy').textContent = 'Copied';
    } catch {
      // Select it so ⌘C / Ctrl+C works.
      const range = document.createRange();
      range.selectNodeContents($('fixCmd'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      $('fixCopy').textContent = 'Press ⌘C';
    }
    setTimeout(() => ($('fixCopy').textContent = 'Copy'), 2500);
  });
  $('fixCheck').addEventListener('click', () => {
    $('fixCopy').textContent = 'Copy';
    detect();
  });

  // ---------------------------------------------------------------------------
  // One-click in-browser AI
  // ---------------------------------------------------------------------------

  function progress(fraction, text) {
    $('progress').hidden = false;
    $('progressBar').style.width = `${Math.round(Math.max(0.02, Math.min(1, fraction)) * 100)}%`;
    $('progressText').textContent = text;
    reportHeight();
  }
  const busy = (on) => ['useNano', 'useWebllm', 'useCloud', 'useLocal'].forEach((id) => ($(id).disabled = on));

  $('useNano').addEventListener('click', async () => {
    busy(true);
    status('');
    progress(0, 'Chrome is downloading its built-in AI. You can keep browsing; this tab can stay in the background.');
    try {
      // Must start inside the click: Chrome only downloads the model after a user action.
      await S.downloadNano((f) => progress(f, `Downloading Chrome's built-in AI… ${Math.round(f * 100)}%`));
      await S.saveSettings({ source: 'browser', browserEngine: 'nano' });
      await finish({ providerLabel: "Chrome's built-in AI", model: 'Gemini Nano', local: true });
    } catch (err) {
      $('progress').hidden = true;
      status(`Chrome couldn't set up its built-in AI (${err.message}). Try another option.`, 'err');
    } finally {
      busy(false);
    }
  });

  $('useWebllm').addEventListener('click', async () => {
    busy(true);
    status('');
    progress(0, 'Starting… (one-time 880 MB download; you can keep browsing)');
    try {
      await ext.runtime.sendMessage({ type: 'ai:host' }); // Chrome: the engine runs in the offscreen document
      await S.webllmClient(ext).load((st) => {
        if (st.phase === 'loading') progress(st.progress, st.text ? st.text.replace(/\[[^\]]*\]\s*/, '') : 'Downloading…');
      });
      await ext.runtime.sendMessage({ type: 'ai:webllm-ready' });
      await S.saveSettings({ source: 'browser', browserEngine: 'webllm' });
      await finish({ providerLabel: 'the in-browser AI', model: 'Qwen2.5-1.5B', local: true });
    } catch (err) {
      $('progress').hidden = true;
      const offline = /fetch|network/i.test(err.message);
      status(offline ? "Couldn't download the in-browser AI. Check your internet connection and try again, or pick another option." : `The in-browser AI couldn't start (${err.message}). Try another option.`, 'err');
    } finally {
      busy(false);
    }
  });

  $('useCloud').addEventListener('click', () => {
    status('');
    show('cloud');
    $('key').focus();
  });
  $('useLocal').addEventListener('click', () => {
    status('');
    show('local');
  });
  for (const back of document.querySelectorAll('.back')) {
    back.addEventListener('click', () => {
      status('');
      showChoices();
    });
  }
  $('changeAi').addEventListener('click', () => {
    $('doneRow').hidden = true;
    status('');
    showChoices();
  });

  // ---------------------------------------------------------------------------
  // Cloud key
  // ---------------------------------------------------------------------------

  // Providers a beginner is most likely to have (or get for free), in this order.
  const PICKS = [
    { id: 'anthropic', name: 'Claude', note: 'Recommended' },
    { id: 'openai', name: 'ChatGPT', note: 'OpenAI' },
    { id: 'gemini', name: 'Gemini', note: 'Free tier' },
    { id: 'groq', name: 'Groq', note: 'Free tier, fast' },
    { id: 'openrouter', name: 'OpenRouter', note: 'Many models' },
  ].filter((p) => CLOUD_PROVIDERS.some((c) => c.id === p.id));
  const providerOf = (id) => CLOUD_PROVIDERS.find((c) => c.id === id);
  let picked = PICKS[0].id;

  function renderProviders() {
    $('providers').replaceChildren(...PICKS.map((p) => {
      const button = Object.assign(document.createElement('button'), { type: 'button', className: 'provider' });
      button.append(p.name, Object.assign(document.createElement('small'), { textContent: p.note }));
      button.setAttribute('aria-pressed', String(p.id === picked));
      button.addEventListener('click', () => {
        picked = p.id;
        renderProviders();
        renderGuide();
        $('key').focus();
      });
      return button;
    }));
    $('key').placeholder = providerOf(picked).keyPlaceholder || 'Paste your key';
  }

  // Step-by-step help for the picked provider, right here (no trip to Settings).
  function renderGuide() {
    const p = providerOf(picked);
    const name = PICKS.find((x) => x.id === picked).name;
    const guide = $('guide');
    guide.replaceChildren();
    const h = Object.assign(document.createElement('h2'), { textContent: `Getting a ${name} key takes about a minute` });
    const steps = document.createElement('ol');
    const li = (...parts) => {
      const item = document.createElement('li');
      item.append(...parts);
      steps.append(item);
    };
    li('Open ', Object.assign(document.createElement('a'), { href: p.keyUrl, target: '_blank', rel: 'noopener', textContent: new URL(p.keyUrl).hostname }), ' (opens a new tab) and sign in or create a free account.');
    li('Click ', Object.assign(document.createElement('b'), { textContent: picked === 'gemini' ? 'Create API key' : 'Create key' }), ', give it any name (like "soroagent"), and copy it.');
    li('Come back, paste it into the box above, and click ', Object.assign(document.createElement('b'), { textContent: 'Connect' }), '.');
    const extra = {
      anthropic: 'Claude needs a little prepaid credit on your Anthropic account (Billing). A few dollars lasts a long time.',
      openai: 'OpenAI needs billing set up on your account before keys work.',
      gemini: 'Gemini has a free tier, so you can start without a card.',
      groq: 'Groq has a free tier and is very fast.',
      openrouter: 'One OpenRouter key gives you Claude, GPT, Gemini and many more.',
    }[picked];
    const tip = Object.assign(document.createElement('p'), { textContent: `${extra} Tip: set a monthly spending limit in your account for peace of mind.` });
    guide.append(h, steps, tip);
  }

  $('connect').addEventListener('click', async () => {
    const key = $('key').value.trim();
    if (!key) {
      status('Paste your API key first. Click "How do I get a key?" if you need one.', 'err');
      $('key').focus();
      return;
    }
    $('connect').disabled = true;
    status('Checking your key…');
    try {
      const saved = await ext.runtime.sendMessage({ type: 'keys:set', keys: { [picked]: key } });
      if (!saved || saved.ok === false) throw new Error((saved && saved.error) || 'Could not save the key.');
      await S.saveSettings({ source: 'cloud', cloudProvider: picked });
      const res = await ext.runtime.sendMessage({ type: 'llm:status' });
      if (!res || res.ok === false || !(res.models || []).length) {
        throw Object.assign(new Error((res && res.error) || 'That key didn\'t work.'), { hint: res && res.hint });
      }
      $('key').value = '';
      await finish(res);
    } catch (err) {
      status(`${err.message}${err.hint ? ` ${err.hint}` : ''} Check the key and try again, or click "How do I get a key?".`, 'err');
    } finally {
      $('connect').disabled = false;
    }
  });
  $('key').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('connect').click();
  });
  $('helpBtn').addEventListener('click', () => {
    const open = $('guide').hidden;
    $('guide').hidden = !open;
    $('helpBtn').setAttribute('aria-expanded', String(open));
    reportHeight();
  });

  // Ollama or LM Studio, after installing: check again (and show the fix if it refuses).
  $('checkLocal').addEventListener('click', async () => {
    $('checkLocal').disabled = true;
    status('Looking for your local model…');
    try {
      await S.saveSettings({ source: 'local' });
      const res = await ext.runtime.sendMessage({ type: 'llm:status' });
      if (!res || res.ok === false) throw Object.assign(new Error((res && res.error) || 'No local model found.'), { code: res && res.code, hint: res && res.hint });
      if (!(res.models || []).length) throw Object.assign(new Error('Ollama is running, but it has no models yet.'), { code: 'no-models' });
      await finish({ ...res, providerLabel: 'your local model', local: true });
    } catch (err) {
      if (err.code === 'forbidden' || err.code === 'no-models') {
        status('');
        showFix(err.code === 'forbidden' ? 'forbidden' : 'no-models');
      } else status(`${err.message}${err.hint ? ` ${err.hint}` : ''}`, 'err');
    } finally {
      $('checkLocal').disabled = false;
    }
  });

  // ---------------------------------------------------------------------------
  // Sync (only with ?sync: offered once the library holds a few things)
  // ---------------------------------------------------------------------------

  async function closeTab() {
    try {
      const tab = await ext.tabs.getCurrent();
      if (tab) await ext.tabs.remove(tab.id);
    } catch {
      window.close();
    }
  }
  $('syncSkip').addEventListener('click', async () => {
    await ext.runtime.sendMessage({ type: 'sync:offer-later' }).catch(() => {});
    closeTab();
  });
  $('syncConnect').addEventListener('click', async () => {
    const passphrase = $('syncPass').value;
    if (passphrase.length < 8) {
      status('Choose a passphrase of at least 8 characters (or the one you already use in your other browser).', 'err');
      $('syncPass').focus();
      return;
    }
    $('syncConnect').disabled = true;
    status('Sign in to Google in the window that opened…');
    try {
      await S.createGoogleAuth(ext).getToken(false, true);
      status('Connecting…');
      const res = await ext.runtime.sendMessage({ type: 'sync:connect', provider: 'gdrive', passphrase });
      if (!res || res.ok === false) throw new Error((res && res.error) || 'Could not connect.');
      $('syncPass').value = '';
      const others = Object.keys(res.devices || {}).length - 1;
      status(others > 0 ? `Sync is on. Your library from ${others === 1 ? 'your other browser' : `${others} other browsers`} is here now${res.received ? ` (${res.received} notes)` : ''}. You can close this tab.` : 'Sync is on. Install soroagent in your other browsers and connect with the same passphrase. You can close this tab.', 'ok');
      show();
    } catch (err) {
      status(/did not approve|cancel|closed/i.test(err.message) ? 'Google sign-in was closed. Try again, or choose Not now.' : err.message, 'err');
    } finally {
      $('syncConnect').disabled = false;
    }
  });
  $('syncPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('syncConnect').click();
  });

  // In the panel, tell the frame's parent (soroagent's content script) how tall to be.
  function reportHeight() {
    if (!embedded) return;
    requestAnimationFrame(() => parent.postMessage({ soroagentOnboardHeight: Math.ceil(document.documentElement.scrollHeight) }, '*'));
  }
  new ResizeObserver(reportHeight).observe(document.body);

  renderProviders();
  renderGuide();
  if (syncOnly) {
    $('greeting').textContent = 'You have a library worth keeping.';
    show('sync');
  } else detect();
})();

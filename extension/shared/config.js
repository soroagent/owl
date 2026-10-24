// Settings shared by the background worker, content scripts and extension pages.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  // Firefox exposes promise-based APIs on `browser`; Chrome MV3 returns promises on `chrome`.
  // Check `runtime.id` because a page element with id="browser" also shows up as window.browser.
  const ext =
    root.browser && root.browser.runtime && root.browser.runtime.id ? root.browser : root.chrome;
  // Firefox (runtime.getBrowserInfo is Firefox-only). Its build has no in-browser model (WebLLM).
  const isFirefox = Boolean(root.browser && root.browser.runtime && root.browser.runtime.getBrowserInfo);

  const DEFAULT_SETTINGS = Object.freeze({
    source: 'local', // 'local' (a model server such as Ollama) | 'cloud' (your API key) | 'browser' (runs inside the browser)
    browserEngine: 'nano', // with source 'browser': 'nano' (Chrome's built-in Gemini Nano) | 'webllm' (Qwen2.5-1.5B on WebGPU)

    // Local model server
    baseUrl: 'http://127.0.0.1:11434',
    provider: 'auto', // 'auto' | 'ollama' | 'openai'
    model: '',
    apiKey: '',

    // Cloud provider (API keys are stored encrypted by the background worker, see background/secrets.js)
    cloudProvider: 'anthropic',
    cloudModels: {}, // provider id -> chosen model
    customBaseUrl: '',

    temperature: 0.3,
    contextWindow: 8192, // Ollama num_ctx; its default is too small for whole pages
    maxPageChars: 12000,
    researchEngine: 'auto', // 'auto' | 'duckduckgo' | 'brave' | 'searxng'
    searxUrl: '', // e.g. http://127.0.0.1:8888 for a self-hosted SearXNG
    customPrompts: {}, // system prompts written in settings: { default?: string, x?: string, … }
    autoCapture: 'off', // 'on': save pages you actually read (passive capture)
    captureMinSeconds: 45, // active reading time before a page counts as read
    captureLabel: true, // let the AI add a title, summary and tags to captured pages
    captureExclude: [], // sites never captured (on top of mail, chat, banking…)
    semanticSearch: true, // search the library by meaning when an embedding model is available
    autoBackup: false, // opt-in: save a backup file to Downloads/soroagent/ after the library changes
    onboarded: false, // set once the first-run setup connects (or for installs from before it existed)
    panelWidth: 400, // panel size in px, set by dragging its edges
    panelHeight: 600,
    allowThinking: false,
    // How soroagent appears (see APPEARANCES): the floating owl by default.
    showLauncher: true, // the owl button in the corner of every page
    openIn: 'page', // where the toolbar button and Alt+Shift+O open it: 'page' (floating panel) | 'sidepanel'
    // Automatic AI work, 'auto' | true | false. 'auto' = on with an AI on this computer or in the
    // browser, off with a cloud key (every page would be sent to it and billed). See autoOn().
    preparePages: 'auto', // summary + questions when the side panel is open on a page, or after 15 s of reading
    pageQuestions: 'auto', // questions written for the page when a panel opens (if preparing is off)
    techFilter: [], // feeds where "Hide non-tech" is on: 'x' | 'reddit' | 'youtube' (posts are sent to the AI to sort)
    followUps: true, // two follow-up questions under each answer, written by your AI from that answer
    webFallback: true, // a question the page can't answer is looked up on the web (else: a button to)
    syncOffer: {}, // { snoozedAt: library size when "Not now" was clicked, times } for the sync offer // suggested questions written for each page by the model when the panel opens
    launcherPosition: 'auto', // 'auto' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
    launcherPlacements: {}, // hostname -> { side: 'left' | 'right', y: 0..1 } after the user drags the button
    hiddenSites: [],
    siteOptions: {}, // site profile id -> { optionId: value }, e.g. { x: { verifiedOnly: true } }
  });

  const PROVIDER_PRESETS = Object.freeze([
    { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434', provider: 'ollama' },
    { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', provider: 'openai' },
    { id: 'llamacpp', label: 'llama.cpp server', baseUrl: 'http://127.0.0.1:8080/v1', provider: 'openai' },
    { id: 'jan', label: 'Jan', baseUrl: 'http://127.0.0.1:1337/v1', provider: 'openai' },
  ]);

  // Hosted APIs. `api` is the wire format; most providers speak the OpenAI chat-completions dialect.
  // `include`/`exclude` trim each provider's model list down to chat models; `prefer` picks the
  // default when the user hasn't chosen one.
  const NON_CHAT = /embed|whisper|tts|audio|realtime|transcribe|image|dall-e|moderation|search|guard|vision-preview|imagen|veo|aqa|computer-use/i;
  const CLOUD_PROVIDERS = Object.freeze([
    {
      id: 'anthropic',
      label: 'Anthropic (Claude)',
      api: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      keyUrl: 'https://console.anthropic.com/settings/keys',
      keyPlaceholder: 'sk-ant-…',
      include: /^claude-/,
      prefer: [/^claude-opus-5-5$/, /^claude-opus/, /^claude-sonnet/],
    },
    {
      id: 'openai',
      label: 'OpenAI',
      api: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      keyUrl: 'https://platform.openai.com/api-keys',
      keyPlaceholder: 'sk-…',
      include: /^(gpt-|o\d|chatgpt-)/,
      prefer: [/^gpt-5(\.\d+)?$/, /^gpt-5/, /^gpt-4\.1$/, /^gpt-4o$/],
    },
    {
      id: 'gemini',
      label: 'Google Gemini',
      api: 'openai',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      keyUrl: 'https://aistudio.google.com/apikey',
      keyPlaceholder: 'AIza…',
      include: /^gemini-/,
      prefer: [/^gemini-[\d.]+-pro$/, /^gemini-[\d.]+-flash$/, /pro/, /flash/],
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      api: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      keyUrl: 'https://openrouter.ai/keys',
      keyPlaceholder: 'sk-or-…',
      prefer: [/^anthropic\/claude-opus/, /^openai\/gpt-5/, /^google\/gemini/],
    },
    {
      id: 'groq',
      label: 'Groq',
      api: 'openai',
      baseUrl: 'https://api.groq.com/openai/v1',
      keyUrl: 'https://console.groq.com/keys',
      keyPlaceholder: 'gsk_…',
      prefer: [/llama.*70b/, /llama/],
    },
    {
      id: 'mistral',
      label: 'Mistral',
      api: 'openai',
      baseUrl: 'https://api.mistral.ai/v1',
      keyUrl: 'https://console.mistral.ai/api-keys',
      keyPlaceholder: '',
      prefer: [/^mistral-large-latest$/, /^mistral-medium-latest$/, /large/],
    },
    {
      id: 'deepseek',
      label: 'DeepSeek',
      api: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      keyUrl: 'https://platform.deepseek.com/api_keys',
      keyPlaceholder: 'sk-…',
      prefer: [/^deepseek-chat$/],
    },
    {
      id: 'xai',
      label: 'xAI (Grok)',
      api: 'openai',
      baseUrl: 'https://api.x.ai/v1',
      keyUrl: 'https://console.x.ai',
      keyPlaceholder: 'xai-…',
      include: /^grok-/,
      prefer: [/^grok-\d+$/, /^grok/],
    },
    {
      id: 'custom',
      label: 'Other (OpenAI-compatible URL)',
      api: 'openai',
      baseUrl: '', // from settings.customBaseUrl
      keyUrl: '',
      keyPlaceholder: '',
    },
  ]);

  function cloudProvider(id) {
    return CLOUD_PROVIDERS.find((p) => p.id === id) || CLOUD_PROVIDERS[0];
  }

  /**
   * Describes where requests go for the current settings. Everything that talks to a model
   * works from this object, so local and cloud share one code path.
   */
  function resolveConnection(settings, apiKeys = {}) {
    const generation = {
      temperature: Number(settings.temperature),
      contextWindow: Number(settings.contextWindow) || 8192,
      allowThinking: Boolean(settings.allowThinking),
    };
    if (settings.source === 'browser') {
      const engine = BROWSER_ENGINES[settings.browserEngine] ? settings.browserEngine : 'nano';
      const e = BROWSER_ENGINES[engine];
      return { id: 'browser', label: e.label, cloud: false, api: 'browser', engine, baseUrl: '', apiKey: '', model: e.model, catalog: null, ...generation };
    }
    if (settings.source === 'cloud') {
      const p = cloudProvider(settings.cloudProvider);
      return {
        id: p.id,
        label: p.id === 'custom' ? 'Custom API' : p.label.replace(/ \(.*\)$/, ''),
        cloud: true,
        api: p.api,
        baseUrl: p.id === 'custom' ? String(settings.customBaseUrl || '').trim().replace(/\/+$/, '') : p.baseUrl,
        apiKey: apiKeys[p.id] || '',
        model: (settings.cloudModels || {})[p.id] || '',
        catalog: p,
        ...generation,
      };
    }
    return {
      id: 'local',
      label: 'Local',
      cloud: false,
      api: settings.provider || 'auto',
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey || '',
      model: settings.model || '',
      catalog: null,
      ...generation,
    };
  }

  // AI that runs inside the browser, with no server and no key. Small models: they get less page text.
  const BROWSER_ENGINES = Object.freeze({
    nano: { label: "Chrome's built-in AI", model: 'Gemini Nano', maxPageChars: 6000 },
    webllm: { label: 'In-browser AI', model: 'Qwen2.5-1.5B', maxPageChars: 6000, downloadMB: 880 },
  });

  /** Page text to send the model: less for the small in-browser models. */
  const pageCharLimit = (settings) =>
    Math.min(Number(settings.maxPageChars) || 12000, settings.source === 'browser' ? (BROWSER_ENGINES[settings.browserEngine] || BROWSER_ENGINES.nano).maxPageChars : Infinity);

  /**
   * How soroagent appears, as three modes over two settings:
   * owl (default): the owl button on every page; the panel opens on the page.
   * sidepanel: opens in the browser's side panel (Firefox: sidebar), beside the page; no owl on pages.
   * quiet: no owl on pages; the toolbar button or Alt+Shift+O opens the floating panel.
   */
  const APPEARANCES = Object.freeze({
    owl: { openIn: 'page', showLauncher: true },
    sidepanel: { openIn: 'sidepanel', showLauncher: false },
    quiet: { openIn: 'page', showLauncher: false },
  });
  /** Pure: the mode a settings object is in. */
  const appearanceOf = (settings) => (settings.openIn === 'sidepanel' ? 'sidepanel' : settings.showLauncher === false ? 'quiet' : 'owl');

  /** Pure: whether an 'auto' | true | false setting is on: 'auto' means on unless the AI is a cloud API. */
  const autoOn = (settings, key) => settings[key] === true || ((settings[key] === 'auto' || settings[key] === undefined) && settings.source !== 'cloud');

  /**
   * Pure: the one command that lets Ollama accept requests from browser extensions, for this
   * computer. Only extension origins are allowed ("*" would let every website use your Ollama).
   */
  function ollamaOriginsFix(platform = '') {
    const origins = 'chrome-extension://*,moz-extension://*';
    if (/win/i.test(platform) && !/darwin/i.test(platform)) {
      return { os: 'Windows', command: `setx OLLAMA_ORIGINS "${origins}"`, then: 'Then quit Ollama from the system tray and start it again.' };
    }
    if (/linux|x11|cros/i.test(platform)) {
      return {
        os: 'Linux',
        command: `sudo mkdir -p /etc/systemd/system/ollama.service.d && printf '[Service]\\nEnvironment="OLLAMA_ORIGINS=${origins}"\\n' | sudo tee /etc/systemd/system/ollama.service.d/origins.conf && sudo systemctl daemon-reload && sudo systemctl restart ollama`,
        then: 'Ollama restarts by itself.',
      };
    }
    return { os: 'macOS', command: `launchctl setenv OLLAMA_ORIGINS "${origins}"`, then: 'Then quit Ollama (menu bar icon → Quit Ollama) and open it again. Run it again after restarting your Mac.' };
  }

  /**
   * Pure: whether to offer sync now. Offered once the library holds 5 items (something worth
   * keeping), never while sync is on; "Not now" waits for 15 more items, and after two it stops.
   */
  function syncOfferDue({ count, syncOn, offer = {} }) {
    if (syncOn || count < 5 || (offer.times || 0) >= 2) return false;
    return offer.snoozedAt === undefined || count >= offer.snoozedAt + 15;
  }

  // Settings patch that stores `model` as the choice for whichever connection is active.
  function modelPatch(settings, model) {
    if (settings.source === 'browser') return {};
    if (settings.source !== 'cloud') return { model };
    return { cloudModels: { ...(settings.cloudModels || {}), [settings.cloudProvider]: model } };
  }

  async function getSettings() {
    const stored = await ext.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  }

  async function saveSettings(patch) {
    // updatedAt lets sync tell which browser changed preferences last.
    const next = { ...(await getSettings()), ...patch, updatedAt: Date.now() };
    await ext.storage.local.set({ settings: next });
    return next;
  }

  // Extension pages report the browser theme so the toolbar icon can match it.
  if (root.document && root.location && /^(chrome|moz)-extension:$/.test(root.location.protocol) && root.matchMedia) {
    const query = root.matchMedia('(prefers-color-scheme: dark)');
    const report = () => ext.runtime.sendMessage({ type: 'theme', dark: query.matches }).catch(() => {});
    query.addEventListener('change', report);
    report();
    // Feedback links in page footers carry the version, like the panel's.
    const page = root.location.pathname.split('/').pop().replace(/\.html$/, '');
    for (const link of root.document.querySelectorAll('a.feedback-link')) link.href = feedbackUrl(page);
  }

  // Feedback page on soroagent.com. Only the version, browser and where it was opened from are
  // passed along; nothing about the user or the page they're on.
  function feedbackUrl(from) {
    const version = ext && ext.runtime && ext.runtime.getManifest ? ext.runtime.getManifest().version : '';
    const browser = /Firefox\//.test((root.navigator && root.navigator.userAgent) || '') ? 'firefox' : 'chrome';
    const params = new URLSearchParams({ v: version, browser, from: String(from || 'extension') });
    return `${feedbackBase()}?${params}`;
  }
  // A function, not a const: page footers use feedbackUrl() before this point in the file runs.
  function feedbackBase() {
    return 'https://soroagent.com/feedback';
  }

  /** Only http(s) links are made clickable; anything else (javascript:, data:…) becomes "#". */
  const safeUrl = (url) => (/^https?:\/\//i.test(String(url || '')) ? String(url) : '#');

  /**
   * Extension pages (Settings, snippets, first run…): send their own uncaught errors to the flight
   * recorder. Not for content scripts, where window errors belong to the website.
   */
  function watchPageErrors(where) {
    const send = (code, message) => ext.runtime.sendMessage({ type: 'diag:record', event: { area: 'error', code, message, detail: { where } } }).catch(() => {});
    root.addEventListener('error', (e) => send('uncaught', e.message));
    root.addEventListener('unhandledrejection', (e) => send('unhandled', (e.reason && e.reason.message) || String(e.reason)));
  }

  Object.assign(soroagent, {
    watchPageErrors,
    isFirefox,
    safeUrl,
    ext,
    feedbackUrl,
    DEFAULT_SETTINGS,
    PROVIDER_PRESETS,
    CLOUD_PROVIDERS,
    NON_CHAT,
    cloudProvider,
    resolveConnection,
    BROWSER_ENGINES,
    pageCharLimit,
    autoOn,
    APPEARANCES,
    appearanceOf,
    ollamaOriginsFix,
    syncOfferDue,
    modelPatch,
    getSettings,
    saveSettings,
  });
})(globalThis);

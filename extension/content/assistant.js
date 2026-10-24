// The on-page assistant: a floating owl button that opens a panel connected to the model.
// Loaded last; depends on shared/*.js, sites/*.js, content/extract.js, styles.js and launcher.js.
(function () {
  'use strict';

  if (!(document.documentElement instanceof HTMLElement) || !document.body) return; // XML, SVG, PDF viewers

  const S = globalThis.soroagent;
  const { ext } = S;

  // ---------------------------------------------------------------------------
  // Icons
  // ---------------------------------------------------------------------------

  const svg = (body, fill = 'none') =>
    `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  // The soroagent owl (shared/brand.js).
  // The soroagent owl (extension/shared/brand.js). No baked-in background: the button's
  // background follows the browser's light or dark theme.
  const OWL = S.BRAND.owlSvg({ frame: 'circle', background: false });
  const OWL_MARK = S.BRAND.owlSvg({ frame: 'tile', background: false, className: 'owl mark' });
  const ICONS = {
    close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
    summarize: svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
    save: svg('<path d="M6 3h12v18l-6-4-6 4z"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
    chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
    home: svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>'),
    research: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M8 11h6M11 8v6"/>'),
    send: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
    stop: svg('<rect x="7" y="7" width="10" height="10" rx="1.5"/>', 'currentColor'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    alert: svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>'),
    refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
    tech: svg('<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>'),
    star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  };

  // All markup is either static or already escaped by renderMarkdown; parsing it with
  // DOMParser keeps it inert (no script execution) and in one auditable place.
  function setHtml(node, html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    node.replaceChildren(...doc.body.childNodes);
  }

  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  // ---------------------------------------------------------------------------
  // DOM setup
  // ---------------------------------------------------------------------------

  // A reloaded extension re-injects into open tabs; drop the stale copy first.
  document.querySelectorAll('soroagent-assistant').forEach((node) => node.remove());

  const host = document.createElement('soroagent-assistant');
  const shadow = host.attachShadow({ mode: 'closed' });
  adoptStyles(shadow, S.ASSISTANT_CSS);

  const ui = document.createElement('div');
  setHtml(ui, `
    <button class="launcher" type="button" hidden aria-label="Open soroagent" title="soroagent (Alt+Shift+K) · drag to move">${OWL}</button>
    <section class="panel" role="dialog" aria-label="soroagent" hidden>
      <header>
        <div class="brand"><span class="brand-mark">${OWL_MARK}</span><span class="wordmark">soro<span>agent</span></span></div>
        <div class="status" role="status">
          <span class="dot" title="Not connected"></span>
          <span class="status-text">Not connected</span>
          <span class="where" hidden></span>
          <select class="model" aria-label="Model" hidden></select>
        </div>
        <button class="icon-btn home-btn" type="button" aria-label="Home" title="Home">${ICONS.home}</button>
        <button class="icon-btn" type="button" data-action="page-history" aria-label="History of this page" title="History: what you saved from this page before">${ICONS.history}</button>
        <button class="icon-btn refresh-btn" type="button" data-action="refresh" aria-label="Refresh the summary with new posts" hidden>${ICONS.refresh}<span class="new-count" hidden></span></button>
        <button class="icon-btn menu-btn" type="button" aria-label="More options" aria-haspopup="menu">${ICONS.more}</button>
        <button class="icon-btn close-btn" type="button" aria-label="Close soroagent">${ICONS.close}</button>
        <div class="menu" role="menu" hidden>
          <button type="button" role="menuitem" data-cmd="snippets">Snippets</button>
          <button type="button" role="menuitem" data-cmd="to-sidepanel">Switch to the side panel</button>
          <button type="button" role="menuitem" data-cmd="clear">Clear conversation</button>
          <button type="button" role="menuitem" data-cmd="reset-position" hidden>Reset button position</button>
          <button type="button" role="menuitem" data-cmd="hide-site">Hide button on this site</button>
          <button type="button" role="menuitem" data-cmd="feedback">Send feedback</button>
          <button type="button" role="menuitem" data-cmd="settings" data-model-item hidden>Change model</button>
          <button type="button" role="menuitem" data-cmd="settings">Settings</button>
        </div>
      </header>
      <div class="actions">
        <button class="chip" type="button" data-action="summarize" title="A short summary of this page">${ICONS.summarize}<span>Summarize</span></button>
        <button class="chip" type="button" data-action="save" title="Save this page to your PKG">${ICONS.save}<span>Save</span></button>
        <button class="chip" type="button" data-action="tech" title="Only the tech: the posts, videos or parts of this page about technology">${ICONS.tech}<span>Tech only</span></button>
      </div>
      <div class="site-bar" hidden><span class="site-label"></span></div>
      <div class="related" hidden></div>
      <div class="thread" aria-live="polite">
        <div class="empty">
          <span class="empty-mark">${OWL_MARK}</span>
          <strong>How can I help with this page?</strong>
          <span class="empty-note">Runs on the model served at your local URL. Nothing leaves your machine.</span>
          <div class="suggest-head" hidden><span class="suggest-label"></span><button type="button" class="suggest-more">New questions</button></div>
          <div class="suggest" role="group" aria-label="Suggested questions">
            <button type="button" data-ask="What are the key points of this page?">What are the key points?</button>
            <button type="button" data-ask="Explain this page simply, as if I'm new to the topic.">Explain it simply</button>
            <button type="button" data-ask="What claims here need checking, and what might be missing?">What should I double-check?</button>
          </div>
          <p class="empty-hint">Summaries are saved to your snippets automatically.</p>
        </div>
      </div>
      <form class="composer">
        <textarea rows="1" placeholder="Ask about this page…" aria-label="Ask about this page"></textarea>
        <button class="send" type="submit" aria-label="Send">${ICONS.send}</button>
      </form>
    </section>`);
  shadow.append(...ui.childNodes);
  document.documentElement.append(host);

  const $ = (selector) => shadow.querySelector(selector);
  const els = {
    launcher: $('.launcher'),
    panel: $('.panel'),
    dot: $('.dot'),
    statusText: $('.status-text'),
    where: $('.where'),
    emptyNote: $('.empty-note'),
    suggest: $('.suggest'),
    refresh: $('.refresh-btn'),
    suggestHead: $('.suggest-head'),
    model: $('.model'),
    menuBtn: $('.menu-btn'),
    menu: $('.menu'),
    resetPosition: $('[data-cmd="reset-position"]'),
    close: $('.close-btn'),
    actions: $('.actions'),
    siteBar: $('.site-bar'),
    siteLabel: $('.site-label'),
    thread: $('.thread'),
    empty: $('.empty'),
    form: $('.composer'),
    input: $('.composer textarea'),
    send: $('.send'),
  };

  // Keep the page's own keyboard shortcuts (j/k, /, space…) from firing while typing here.
  for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (e) => e.stopPropagation());

  function adoptStyles(target, css) {
    // Constructable sheets are not subject to the page's style-src CSP; fall back to <style>.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = css;
      (target === document ? document.documentElement : target).append(style);
    }
  }
  adoptStyles(document, S.PAGE_CSS);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const state = {
    settings: { ...S.DEFAULT_SETTINGS },
    site: S.siteFor(location),
    url: location.href,
    status: 'idle', // idle | connecting | ready | offline
    cloud: false,
    recommended: [],
    tipShown: false,
    busy: null, // AbortController of the running task
    history: [], // chat turns (without the page context)
    pageContext: null, // { url, page } used for questions
    summaries: new Map(), // content fingerprint -> earlier summary, for repeat Summarize on unchanged content
    feed: null, // batches gathered by scrolling: { url, optionsKey, seen, endY, done, exhausted }
  };
  // Hide non-tech's state (see "Hide non-tech" below); here because the site bar and snapshot read it early.
  const tech = { feed: '', verdicts: new Map(), busy: false, timer: 0, observer: null, pausedUntil: 0 };
  const techFeed = () => (S.feedFilter ? S.feedFilter.feedFor(location) : '');

  const launcherCtl = S.createLauncherController({
    host,
    launcher: els.launcher,
    panel: els.panel,
    settings: () => state.settings,
    save: (patch) => S.saveSettings(patch),
    panelHeight: () => panelDims().height,
  });

  // Panel size: drag its free edges (or corner) to resize; remembered for every site.
  // Double-click a handle to go back to the default size.
  const PANEL_DEFAULT = { width: 400, height: 600 };
  const PANEL_MIN = { width: 320, height: 320 };
  const panelDims = () => ({
    width: Math.max(PANEL_MIN.width, Number(state.settings.panelWidth) || PANEL_DEFAULT.width),
    height: Math.max(PANEL_MIN.height, Number(state.settings.panelHeight) || PANEL_DEFAULT.height),
  });
  function applyPanelSize() {
    els.panel.style.setProperty('--panel-w', `${panelDims().width}px`);
    launcherCtl.placePanel();
  }

  for (const axis of ['x', 'y', 'xy']) {
    const handle = el('div', { className: `resize resize-${axis}`, tabIndex: 0, title: 'Drag to resize · double-click to reset' });
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-label', axis === 'x' ? 'Resize width' : axis === 'y' ? 'Resize height' : 'Resize');
    els.panel.append(handle);

    let drag = null;
    const resize = (dx, dy) => {
      const rect = els.panel.getBoundingClientRect();
      const { edgeX, edgeY } = els.panel.dataset;
      // How far the panel can grow before it would leave the window.
      const maxW = edgeX === 'left' ? rect.right - 8 : window.innerWidth - rect.left - 8;
      const maxH = edgeY === 'top' ? rect.bottom - 8 : window.innerHeight - rect.top - 8;
      const start = drag || { width: rect.width, height: rect.height };
      const width = axis === 'y' || !edgeX ? start.width : Math.round(Math.min(maxW, Math.max(PANEL_MIN.width, start.width + (edgeX === 'left' ? -dx : dx))));
      const height = axis === 'x' ? start.height : Math.round(Math.min(maxH, Math.max(PANEL_MIN.height, start.height + (edgeY === 'top' ? -dy : dy))));
      els.panel.style.setProperty('--panel-w', `${width}px`);
      els.panel.style.height = `${height}px`;
      return { width, height };
    };
    const save = (size) => {
      state.settings = { ...state.settings, panelWidth: size.width, panelHeight: size.height };
      S.saveSettings({ panelWidth: size.width, panelHeight: size.height });
    };

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = els.panel.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height, size: null };
      handle.setPointerCapture(e.pointerId);
      els.panel.classList.add('resizing');
    });
    handle.addEventListener('pointermove', (e) => {
      if (drag) drag.size = resize(e.clientX - drag.x, e.clientY - drag.y);
    });
    const end = () => {
      if (!drag) return;
      const size = drag.size;
      drag = null;
      els.panel.classList.remove('resizing');
      if (size) save(size);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('dblclick', () => {
      state.settings = { ...state.settings, panelWidth: PANEL_DEFAULT.width, panelHeight: PANEL_DEFAULT.height };
      S.saveSettings({ panelWidth: PANEL_DEFAULT.width, panelHeight: PANEL_DEFAULT.height });
      applyPanelSize();
    });
    // Keyboard: arrow keys resize in 24px steps.
    handle.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[e.key];
      if (!step) return;
      e.preventDefault();
      // Same as dragging the handle by one step in that direction.
      save(resize(step[0], step[1]));
    });
  }

  const siteOptions = () => S.siteOptionValues(state.site, state.settings);
  // A long-form article on a site that's otherwise read as posts (an X Article): read it as a page.
  const longform = () => Boolean(state.site.longform && state.site.longform(document, location));
  const pageInfo = () => {
    if (longform()) return { type: 'article', label: `${state.site.name} · Article`, context: `This is a long-form article published on ${state.site.name}.` };
    return state.site.pageInfo ? state.site.pageInfo(location) : { type: 'page', label: '', context: '' };
  };
  const items = () => (longform() ? null : state.site.items || null); // articles are read as pages
  // Prompt texts: prompts/default.js, then prompts/<site id>.js and its page-type overrides.
  // Site profile prompts (X, Reddit), else a prompt set for this host (YouTube, GitHub…), with the
  // system prompt from settings when the user wrote one.
  const promptSetId = () => (state.site.id && state.site.id !== 'default' ? state.site.id : S.promptSetForHost(location.hostname));
  const sitePrompts = () => {
    const id = longform() ? 'default' : promptSetId(); // the site's prompts are about posts, not articles
    const persona = S.customPersona(state.settings, id);
    return S.promptsFor(id, { ...(state.site.prompts || {}), ...(persona ? { persona } : {}) }, pageInfo().type);
  };

  // FNV-1a: a fast fingerprint to tell whether content changed.
  function fingerprint(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  }

  // ---------------------------------------------------------------------------
  // Talking to the background worker
  // ---------------------------------------------------------------------------

  function toError(payload) {
    const err = new Error(payload.error || 'Something went wrong.');
    err.code = payload.code;
    err.hint = payload.hint || '';
    return err;
  }

  async function sendMessage(message) {
    const res = await ext.runtime.sendMessage(message);
    if (res && res.ok === false) throw toError(res);
    return res;
  }

  /** Streams a completion from the model. Resolves with the full text. */
  function runChat({ messages, json = false, quick = false, onToken, onThinking, signal }) {
    return new Promise((resolve, reject) => {
      const port = ext.runtime.connect({ name: 'llm' });
      let settled = false;
      const ping = setInterval(() => {
        try {
          port.postMessage({ type: 'ping' });
        } catch {
          // port already closed
        }
      }, 15000);
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearInterval(ping);
        try {
          port.disconnect();
        } catch {
          // already disconnected
        }
        fn(value);
      };
      port.onMessage.addListener((msg) => {
        if (msg.type === 'token' && onToken) onToken(msg.text);
        else if (msg.type === 'thinking' && onThinking) onThinking();
        else if (msg.type === 'done') finish(resolve, msg.text);
        else if (msg.type === 'error') finish(reject, toError(msg));
      });
      port.onDisconnect.addListener(() =>
        finish(reject, toError({ error: 'Lost the connection to the extension.', hint: 'Reload the page and try again.' }))
      );
      if (signal) {
        signal.addEventListener('abort', () => finish(reject, Object.assign(new Error('Stopped.'), { name: 'AbortError' })), { once: true });
      }
      port.postMessage({ type: 'chat', messages, json, quick, model: els.model.value || '' });
    });
  }

  // ---------------------------------------------------------------------------
  // Connection status and model suggestions
  // ---------------------------------------------------------------------------

  function setStatus(status, text) {
    state.status = status;
    els.dot.className = `dot ${status}`;
    els.statusText.textContent = text;
    // Connected: just the green dot (hover it for the model). Otherwise say what's wrong.
    els.statusText.hidden = status === 'ready';
    els.model.hidden = true;
    els.where.hidden = true;
    els.dot.title = status === 'ready' ? `Connected: ${els.model.title || text}` : text;
    els.dot.setAttribute('aria-label', els.dot.title);
    const modelItem = els.menu.querySelector('[data-model-item]');
    modelItem.hidden = status !== 'ready';
    modelItem.textContent = status === 'ready' ? `Change model (${text})` : 'Change model';
    updateControls();
  }

  function fillModelSelect(models, selected, recommended) {
    const option = (id, label) => el('option', { value: id, textContent: label });
    const rest = models.filter((m) => !recommended.some((r) => r.id === m.id)).map((m) => option(m.id, m.size ? `${m.id} · ${m.size}` : m.id));
    if (recommended.length) {
      els.model.replaceChildren(
        el('optgroup', { label: 'Recommended for soroagent' }, recommended.map((r) => option(r.id, `★ ${r.id} — ${r.label}`))),
        el('optgroup', { label: 'All models' }, rest)
      );
    } else {
      els.model.replaceChildren(...rest);
    }
    els.model.value = selected;
  }

  async function connect() {
    setStatus('connecting', 'Connecting…');
    try {
      const status = await sendMessage({ type: 'llm:status' });
      state.cloud = status.cloud;
      state.recommended = status.recommended || [];
      els.where.textContent = status.providerLabel;
      els.emptyNote.textContent = status.cloud
        ? `Runs on ${status.providerLabel} with your API key. Page text you act on is sent to ${status.providerLabel}.`
        : status.browser
          ? `Runs on ${status.providerLabel}, inside this browser. Nothing leaves your machine.`
          : 'Runs on the model served at your local URL. Nothing leaves your machine.';
      if (!status.models.length) {
        setStatus('offline', 'No models');
        const pull = status.pullSuggestion ? `Download one first, for example: ${status.pullSuggestion.command}` : 'Choose a model in settings.';
        showError(new Error(`Connected to ${status.cloud ? status.providerLabel : status.baseUrl}, but it has no chat models.`), pull, true);
        return;
      }
      fillModelSelect(status.models, status.model, state.recommended);
      finishOnboarding();
      const via = status.cloud ? status.providerLabel : status.api === 'ollama' ? 'Ollama' : 'OpenAI-compatible API';
      els.model.title = `${status.model} via ${via} at ${status.baseUrl}`;
      setStatus('ready', status.model);
      maybeSuggestModels(status);
      if (isOpen()) suggestQuestions();
    } catch (err) {
      setStatus('offline', 'Offline');
      // First run: a friendly setup right in the chat instead of an error.
      if (!state.settings.onboarded) showOnboarding();
      else showError(err, err.hint, true);
    }
  }

  // First-run setup in the chat. The key box is soroagent's own page in a frame, so the website
  // can't read what's typed into it (it could see keystrokes typed straight into the panel).
  const WELCOMES = [
    'Hoo\'s there? I\'m soroagent. I read the internet so you don\'t have to.',
    'Hi! I\'m an owl with a reading habit. Give me an AI key and I\'ll summarize anything.',
    'Welcome! I turn walls of text into three bullet points. Your brain says thanks in advance.',
    'Hello, human. I come in peace, and I come with summaries.',
  ];
  function showOnboarding() {
    if (els.thread.querySelector('.onboarding')) return;
    const frame = el('iframe', { className: 'onboard-frame', src: `${ext.runtime.getURL('pages/onboard.html')}?embed`, title: 'Connect soroagent to an AI' });
    frame.setAttribute('allow', '');
    const node = el('div', { className: 'card onboarding' }, [
      el('div', { className: 'card-title' }, [el('span', { className: 'card-title-text', textContent: WELCOMES[Math.floor(Math.random() * WELCOMES.length)] })]),
      el('p', { textContent: 'To get started, connect me to an AI. Paste a key from Claude, ChatGPT, Gemini and others, or use a free model on your computer. Stuck? Click "How do I get a key?".' }),
      frame,
    ]);
    // The frame reports its height so it never needs its own scrollbar.
    const onMessage = (e) => {
      if (e.source !== frame.contentWindow || !e.data || typeof e.data.soroagentOnboardHeight !== 'number') return;
      frame.style.height = `${Math.min(900, Math.max(120, e.data.soroagentOnboardHeight))}px`;
    };
    window.addEventListener('message', onMessage);
    node.addEventListener('soroagent-remove', () => window.removeEventListener('message', onMessage));
    append(node);
  }
  function finishOnboarding() {
    const node = els.thread.querySelector('.onboarding');
    if (!node) return;
    node.dispatchEvent(new Event('soroagent-remove'));
    node.replaceWith(card({ kind: 'ok', icon: 'check', title: 'Connected! I\'m ready.', body: 'Try Summarize, or ask me anything about this page.' }));
  }

  // The model suggestion appears at most once, ever: the first time a better-suited local model is
  // installed than the one in use. Choosing a model (here or in settings) also turns it off for good.
  function maybeSuggestModels(status) {
    if (state.tipShown || status.cloud || state.settings.modelTipSeen) return;
    const best = state.recommended[0];
    const inUse = status.model;
    const needsPull = status.pullSuggestion && (!best || best.id === inUse);
    if (!needsPull && (!best || best.id === inUse)) return;
    state.tipShown = true;
    S.saveSettings({ modelTipSeen: true });
    if (needsPull) {
      append(card({ icon: 'star', title: 'Tip: a better model for soroagent', body: `Your installed models aren't a great fit. Try ${status.pullSuggestion.reason}:`, pre: status.pullSuggestion.command }));
      return;
    }
    const node = card({
      icon: 'star',
      title: 'A better model for soroagent is installed',
      body: `You're using ${inUse}. Based on size and model family, these fit best. You can change this any time in the model menu or settings.`,
      actions: [{ label: 'Keep current model', onClick: () => node.remove() }],
    });
    const list = el('div', { className: 'recs' });
    for (const rec of state.recommended) {
      const use = el('button', { type: 'button', textContent: rec.id === inUse ? 'In use' : 'Use' });
      use.disabled = rec.id === inUse;
      use.addEventListener('click', () => {
        els.model.value = rec.id;
        els.model.dispatchEvent(new Event('change'));
        node.remove();
      });
      list.append(el('div', { className: 'rec' }, [el('div', {}, [el('b', { textContent: `${rec.label}: ${rec.id}` }), el('small', { textContent: rec.reason })]), use]));
    }
    node.insertBefore(list, node.querySelector('.card-actions'));
    append(node);
  }

  // ---------------------------------------------------------------------------
  // Thread rendering
  // ---------------------------------------------------------------------------

  function scrollToEnd(force) {
    const t = els.thread;
    if (force || t.scrollHeight - t.scrollTop - t.clientHeight < 80) t.scrollTop = t.scrollHeight;
  }

  // The opening screen (suggested questions) stays at the top of the conversation, so the reader
  // can scroll back up and pick another one.
  function append(node) {
    leaveHome();
    els.thread.classList.add('chatting');
    els.thread.append(node);
    scrollToEnd(true);
    return node;
  }

  const addUserMessage = (text) => {
    clearNextSteps();
    stopFollowUps();
    return append(el('div', { className: 'msg user', textContent: text }));
  };

  // Assistant message that renders streamed Markdown at most once per frame.
  function addAssistantMessage(placeholder = 'Reading the page…') {
    const node = append(el('div', { className: 'msg assistant' }));
    setHtml(node, `<span class="typing">${S.escapeHtml(placeholder)}</span>`);
    let raw = '';
    let frame = 0;
    const render = () => {
      frame = 0;
      const visible = S.stripThinking(raw);
      if (visible) setHtml(node, S.renderMarkdown(S.linkHandles(visible, location.hostname)));
      scrollToEnd(false);
    };
    return {
      node,
      status(text) {
        if (!raw) setHtml(node, `<span class="typing">${S.escapeHtml(text)}</span>`);
      },
      thinking() {
        if (!S.stripThinking(raw)) setHtml(node, '<span class="typing">Thinking…</span>');
      },
      push(token) {
        raw += token;
        if (!frame) frame = requestAnimationFrame(render);
      },
      finish(text) {
        if (frame) cancelAnimationFrame(frame);
        raw = text !== undefined ? text : raw;
        setHtml(node, S.renderMarkdown(S.linkHandles(S.stripThinking(raw), location.hostname)) || '<p><em>(no response)</em></p>');
        scrollToEnd(false);
      },
    };
  }

  function card({ kind = '', icon, title, body = '', pre = '', actions = [] }) {
    const node = el('div', { className: `card ${kind}` });
    const heading = el('div', { className: 'card-title' });
    setHtml(heading, icon ? ICONS[icon] : '');
    heading.append(el('span', { className: 'card-title-text', textContent: title }));
    node.append(heading);
    if (body) node.append(el('p', { textContent: body }));
    if (pre) node.append(el('pre', { textContent: pre }));
    if (actions.length) {
      const row = el('div', { className: 'card-actions' });
      for (const action of actions) {
        const button = el('button', { type: 'button', textContent: action.label });
        button.addEventListener('click', action.onClick);
        row.append(button);
      }
      node.append(row);
    }
    return node;
  }

  function progressCard(icon, title) {
    const node = card({ icon, title });
    const bar = el('div', { className: 'progress' }, [el('div')]);
    node.append(bar);
    append(node);
    return {
      node,
      update(text, fraction) {
        node.querySelector('.card-title-text').textContent = text;
        if (fraction !== undefined) bar.firstChild.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
      },
    };
  }

  function showError(err, hint, offerRetry) {
    if (err && err.code === 'forbidden' && state.settings.source === 'local') return showOllamaFix();
    const actions = [];
    if (offerRetry) actions.push({ label: 'Retry', onClick: () => connect() });
    actions.push({ label: 'Open settings', onClick: () => sendMessage({ type: 'open:options' }) });
    return append(card({ kind: 'error', icon: 'alert', title: err.message, pre: hint || '', actions }));
  }

  // The local server answered 403: Ollama blocks browser extensions by default. The one command
  // that fixes it on this computer, ready to copy, and a Retry for after restarting Ollama.
  function showOllamaFix() {
    const fix = S.ollamaOriginsFix(navigator.platform || navigator.userAgent);
    const copy = { label: 'Copy command' };
    copy.onClick = async (e) => {
      const button = e.currentTarget;
      try {
        await navigator.clipboard.writeText(fix.command);
        button.textContent = 'Copied';
      } catch {
        button.textContent = 'Select the command and copy it';
      }
      setTimeout(() => (button.textContent = 'Copy command'), 2500);
    };
    return append(card({
      kind: 'error',
      icon: 'alert',
      title: "Ollama is blocking browser extensions",
      body: `Run this once in ${fix.os === 'Windows' ? 'Command Prompt' : 'Terminal'}. It lets browser extensions (and no websites) use Ollama. ${fix.then}`,
      pre: fix.command,
      actions: [copy, { label: 'Retry', onClick: () => connect() }],
    }));
  }

  // Once the library holds 5 things worth keeping, offer sync (once; "Not now" waits for more).
  async function maybeOfferSync() {
    if (els.thread.querySelector('.sync-offer')) return;
    const res = await sendMessage({ type: 'sync:offer' }).catch(() => null);
    if (!res || !res.offer) return;
    const node = card({
      kind: 'sync-offer',
      icon: 'save',
      title: `You've saved ${res.count} things. Keep them safe?`,
      body: 'Sync your PKG to every browser where you use soroagent, through your own Google Drive, encrypted with your passphrase. soroagent only sees its own hidden folder there.',
      actions: [
        { label: 'Set up sync', onClick: () => (node.remove(), sendMessage({ type: 'open:sync-setup' })) },
        { label: 'Not now', onClick: () => (node.remove(), sendMessage({ type: 'sync:offer-later' })) },
      ],
    });
    append(node);
  }

  // ---------------------------------------------------------------------------
  // Running tasks
  // ---------------------------------------------------------------------------

  const maxChars = () => S.pageCharLimit(state.settings);

  // Problems worth a diagnostic report go to the flight recorder (scrubbed there: no addresses or
  // page text). Each kind is reported once per page.
  const reported = new Set();
  function report(area, code, message, detail = {}) {
    const key = `${location.href}|${area}|${code}`;
    if (reported.has(key)) return;
    reported.add(key);
    sendMessage({ type: 'diag:record', event: { area, code, message, detail: { site: state.site.id, pageType: pageInfo().type, ...detail } } }).catch(() => {});
  }
  const getPage = (limit = maxChars()) => S.extractPage(document, { maxChars: limit });
  // Site profiles with extract() read the page's structure (Stack Overflow answers with the
  // accepted one marked, Hacker News comment trees, GitHub issue state…); others get its text.
  // When a site profile's selectors find nothing (sites change their markup), Readability reads the
  // page instead (S.readFallback), and the flight recorder notes it. Long pages are condensed to the
  // limit so the text still covers the whole document (S.condenseText), not just its start.
  function sitePage(limit = maxChars()) {
    let full = null;
    if (state.site.extract) {
      try {
        const page = state.site.extract(document, location);
        if (page && page.text && page.text.length > 120) full = { title: page.title || document.title, text: page.text };
      } catch (err) {
        report('extractor', 'threw', err.message, { where: 'extract' }); // then the fallback parser reads it
      }
      // Profiles return null on pages they don't cover (a channel page, a search): that's not a failure.
      const type = pageInfo().type;
      const covered = state.site.extractTypes ? state.site.extractTypes.includes(type) : type !== 'page' && type !== 'other';
      if (!full && covered) {
        const fallback = S.readFallback(document);
        full = { title: document.title, text: fallback.text };
        report('extractor', 'empty', `The site profile found no content; read the page with ${fallback.parser} instead`, { phase: fallback.parser });
      }
    }
    if (!full) full = { title: document.title, text: S.readPage(document) };
    const condensed = S.condenseText(full.text, limit, { title: full.title });
    return { title: full.title, url: location.href, text: condensed.text, condensed: condensed.condensed };
  }

  function updateControls() {
    const busy = Boolean(state.busy);
    const ready = state.status === 'ready';
    // Only Summarize and Tech only need the model; the other buttons always work.
    for (const chip of els.actions.querySelectorAll('.chip')) chip.disabled = ['summarize', 'tech'].includes(chip.dataset.action) && (busy || !ready);
    els.input.disabled = !ready;
    els.send.disabled = !busy && !ready;
    els.send.classList.toggle('stop', busy);
    setHtml(els.send, busy ? ICONS.stop : ICONS.send);
    els.send.setAttribute('aria-label', busy ? 'Stop' : 'Send');
    els.launcher.classList.toggle('busy', busy);
  }

  async function runTask(task) {
    if (state.busy) return;
    if (state.status !== 'ready') await connect();
    if (state.status !== 'ready') return;
    state.busy = new AbortController();
    updateControls();
    try {
      await task(state.busy.signal);
    } catch (err) {
      if (err.name === 'AbortError') append(card({ title: 'Stopped.' }));
      else showError(err, err.hint, false);
    } finally {
      state.busy = null;
      updateControls();
    }
  }

  // Streams a reply into an assistant message; records the turn for follow-up questions.
  async function streamReply(messages, userTurn, signal, reply = addAssistantMessage()) {
    try {
      const text = await runChat({ messages, signal, onToken: reply.push, onThinking: reply.thinking });
      reply.finish(text);
      state.history.push({ role: 'user', content: userTurn }, { role: 'assistant', content: text });
      state.history = state.history.slice(-12);
      return text;
    } catch (err) {
      reply.finish();
      if (!reply.node.textContent.trim() || reply.node.textContent === '(no response)') reply.node.remove();
      throw err;
    }
  }

  // Shows a summary produced earlier for the same content instead of asking the model again.
  function showCachedSummary(label, cached, regenerate) {
    addUserMessage(label);
    addAssistantMessage().finish(cached.text);
    const minutes = Math.max(1, Math.round((Date.now() - cached.at) / 60000));
    const again = el('button', { type: 'button', textContent: 'Regenerate' });
    again.addEventListener('click', regenerate);
    append(el('div', { className: 'cached' }, [el('span', { textContent: `Nothing changed since the summary ${minutes} min ago, so here it is again.` }), again]));
  }

  // ---------------------------------------------------------------------------
  // Summarize
  // ---------------------------------------------------------------------------

  // Site profiles with ensure() load extra content first (YouTube's transcript). interactive: the
  // reader asked for something, so the profile may open the site's own panels to read them.
  async function ensureSite(interactive) {
    if (!state.site.ensure) return;
    try {
      const found = await state.site.ensure(document, location, { interactive });
      if (interactive && !found && pageInfo().type === 'video') report('extractor', 'no-transcript', 'No transcript could be read for this video', { where: 'ensure' });
    } catch (err) {
      report('extractor', 'threw', err.message, { where: 'ensure' });
    }
  }

  async function summarize({ fresh = false } = {}) {
    await ensureSite(true);
    // Prepared on visit: shown at once. On X, new posts since then → prepare again with all of them.
    if (!fresh && isX() && prep.url === location.href && prep.status === 'done' && newPostCount() > 0) return refreshPrepared();
    if (!fresh && preparedReady()) return usePrepared();
    const site = items();
    if (site && site.isFeed && site.isFeed(pageInfo())) {
      if (site.visible(document, siteOptions()).length) return summarizeFeed({ fresh });
      // The feed's selectors found nothing: summarize the page as text rather than give up.
      report('extractor', 'no-items', `No ${site.noun || 'items'} found by the site profile; summarized the page as text`, { where: 'summarize' });
      return summarizePage({ fresh });
    }
    if (site) {
      const posts = site.visible(document, siteOptions());
      if (posts.length) return summarizeVisibleItems(posts, { fresh });
    }
    return summarizePage({ fresh });
  }

  // ---------------------------------------------------------------------------
  // Summary jobs: the background worker runs each summary, so it finishes even if the reader
  // leaves the page. Results are kept in the summary history.
  // ---------------------------------------------------------------------------

  const NOTES_PLACEHOLDER = '@@SOROAGENT_NOTES@@';

  /** Connects a reply bubble to a job (new or running). Resolves with the finished record. */
  function followJob(port, reply, { signal, onStarted, onSources } = {}) {
    return new Promise((resolve, reject) => {
      let id = '';
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        try {
          port.disconnect();
        } catch {
          // already closed
        }
        fn(value);
      };
      port.onMessage.addListener((msg) => {
        if (msg.type === 'started') {
          id = msg.id;
          if (onStarted) onStarted(id);
        } else if (msg.type === 'snapshot') {
          id = msg.record.id;
          if (msg.record.text) reply.push(msg.record.text);
          else if (msg.record.statusText) reply.status(msg.record.statusText);
        } else if (msg.type === 'status') reply.status(msg.text);
        else if (msg.type === 'sources' && onSources) onSources(msg);
        else if (msg.type === 'thinking') reply.thinking();
        else if (msg.type === 'token') reply.push(msg.text);
        else if (msg.type === 'done') {
          reply.finish(msg.record.text);
          finish(resolve, msg.record);
        } else if (msg.type === 'error' || msg.type === 'gone') {
          const record = msg.record || {};
          finish(reject, record.status === 'stopped' ? Object.assign(new Error('Stopped.'), { name: 'AbortError' }) : toError(record));
        }
      });
      port.onDisconnect.addListener(() => finish(reject, toError({ error: 'Lost the connection to the extension.', hint: 'Reload the page; the summary is in your summary history.' })));
      if (signal) {
        signal.addEventListener('abort', () => {
          if (id) port.postMessage({ type: 'stop', id });
          finish(reject, Object.assign(new Error('Stopped.'), { name: 'AbortError' }));
        }, { once: true });
      }
    });
  }

  /**
   * Runs a summary as a background job and streams it into a reply bubble.
   * job: { label, kind, fingerprint, final (messages), notes (list of messages; optional) }
   */
  async function runSummaryJob(job, { signal, reply, onSources }) {
    const port = ext.runtime.connect({ name: 'summary' });
    const done = followJob(port, reply, { signal, onSources });
    // Every summary is saved as a snippet; the background labels it with this prompt.
    const saveMessages =
      job.kind === 'research'
        ? undefined
        : S.buildMessages('save', S.pageVars({ title: document.title, url: location.href, text: S.JOB_PLACEHOLDERS.summary }), sitePrompts());
    port.postMessage({
      type: 'start',
      job: {
        saveMessages,
        ...job,
        placeholder: NOTES_PLACEHOLDER,
        url: location.href,
        pageTitle: document.title,
        site: state.site.id === 'default' ? location.hostname : state.site.name,
        model: els.model.value || '',
      },
    });
    try {
      const record = await done;
      state.history.push({ role: 'user', content: job.label }, { role: 'assistant', content: record.text });
      state.history = state.history.slice(-12);
      afterJob(record);
      return record;
    } catch (err) {
      if (!reply.node.textContent.trim() || /Reading|Writing|Thinking/.test(reply.node.textContent)) reply.node.remove();
      throw err;
    }
  }

  // An earlier summary of exactly this content (from the summary history), if any.
  async function findSummary(print) {
    try {
      const res = await sendMessage({ type: 'summary:find', url: location.href, fingerprint: print });
      return res.record ? { text: res.record.text, at: Date.parse(res.record.finishedAt || res.record.createdAt) } : null;
    } catch {
      return null;
    }
  }

  function summarizePage({ fresh }) {
    return runTask(async (signal) => {
      const page = sitePage();
      if (!page.text) throw new Error('This page has no readable text to summarize.');
      state.pageContext = { url: location.href, page };
      const print = fingerprint(`${location.href}\n${page.text}`);
      const cached = !fresh && (await findSummary(print));
      if (cached) return showCachedSummary('Summarize this page', cached, () => summarize({ fresh: true }));
      addUserMessage('Summarize this page');
      const vars = S.pageVars(page, { context: pageInfo().context || '' });
      await runSummaryJob(
        { label: 'Summarize this page', kind: 'page', fingerprint: print, final: S.buildMessages('summarize', vars, sitePrompts()) },
        { signal, reply: addAssistantMessage() }
      );
    });
  }

  // Items already on screen (e.g. a thread on X or Reddit): no scrolling.
  function summarizeVisibleItems(posts, { fresh }) {
    return runTask(async (signal) => {
      const print = fingerprint(location.href + JSON.stringify(siteOptions()) + posts.map((p) => p.id).join(','));
      const label = `Summarize ${posts.length} ${items().noun || 'items'}`;
      const cached = !fresh && (await findSummary(print));
      if (cached) return showCachedSummary(label, cached, () => summarize({ fresh: true }));
      addUserMessage(label);
      await summarizeItems(posts, { start: 1, context: pageInfo().context || '', signal, label, print });
    });
  }

  // Formats items and summarizes them as a background job. Batches longer than the page-text
  // limit are summarized in parts (notes per part), then the notes are merged into one summary.
  async function summarizeItems(list, { start, context, signal, label, print = '' }) {
    const site = items();
    const prompts = sitePrompts();
    const budget = maxChars();
    const groups = [];
    let group = [];
    let size = 0;
    for (const item of list) {
      const length = site.format([item], { start: 1 }).length + 2;
      if (group.length && size + length > budget) {
        groups.push(group);
        group = [];
        size = 0;
      }
      group.push(item);
      size += length;
    }
    if (group.length) groups.push(group);

    const base = { title: document.title, url: location.href, text: '' };
    const noun = site.noun || 'items';
    const notes = [];
    let content = site.format(list, { start });
    let fullContext = context;
    if (groups.length > 1) {
      let offset = start;
      for (let i = 0; i < groups.length; i++) {
        const vars = S.pageVars({ ...base, text: site.format(groups[i], { start: offset }) }, { context: `${context} (Part ${i + 1} of ${groups.length}.)`, count: groups[i].length });
        notes.push(S.buildMessages('notes', vars, prompts));
        offset += groups[i].length;
      }
      content = NOTES_PLACEHOLDER;
      fullContext = `${context} The content below is notes taken on ${list.length} ${noun} in ${groups.length} parts.`;
    }
    const vars = S.pageVars({ ...base, text: content }, { context: fullContext, count: list.length });
    const { text } = await runSummaryJob(
      { label, kind: 'items', fingerprint: print, notes, final: S.buildMessages('summarize', vars, prompts) },
      { signal, reply: addAssistantMessage(`Reading ${list.length} ${noun}…`) }
    );
    // Follow-up questions are answered from these items.
    const asText = site.format(list, { start });
    state.pageContext = { url: location.href, page: { ...base, text: asText.slice(0, budget), truncated: asText.length > budget } };
    return text;
  }

  // Under each finished summary: it's saved, and it can be researched further.
  function afterJob(record) {
    if (record.snippetId) maybeOfferSync();
    if (record.kind === 'research') {
      if (record.sources && record.sources.length) append(sourcesCard(record.query, record.sources, 'Sources'));
      return;
    }
    state.next = { ...(state.next || {}), record };
    renderNextSteps();
    if (record.kind === 'page' || record.kind === 'items') suggestFollowUps(record.label || 'Summarize this page', record.text);
  }

  // One small "next steps" card under the latest answer: saved status, Research, and on feeds,
  // Read more. It's redrawn in place (never stacked), and cleared when a new request starts.
  function clearNextSteps() {
    els.thread.querySelectorAll('.next-steps').forEach((n) => n.remove());
    state.next = null;
  }

  function renderNextSteps() {
    els.thread.querySelectorAll('.next-steps').forEach((n) => n.remove());
    const { record, more } = state.next || {};
    if (!record && !more) return;
    const status = el('div', { className: 'next-status' });
    const actions = el('div', { className: 'next-actions' });
    const node = el('div', { className: 'next-steps', role: 'group' });
    node.setAttribute('aria-label', 'Next steps');

    if (record) {
      status.append(el('span', { className: 'next-check', textContent: '✓' }), el('span', { textContent: record.snippetId ? 'Saved to snippets' : 'Kept in history' }));
      const open = el('button', { type: 'button', className: 'link', textContent: 'Open' });
      open.addEventListener('click', () => sendMessage({ type: 'open:snippets', id: record.snippetId || `job:${record.id}` }));
      status.append(open);
    }
    if (more && more.note) status.append(el('span', { className: 'next-note', textContent: more.note }));

    if (more && more.count) {
      const read = el('button', { type: 'button', className: 'primary', textContent: `Read ${more.count} more`, title: more.hint });
      read.addEventListener('click', () => {
        clearNextSteps();
        readMore();
      });
      actions.append(read);
    }
    if (record) {
      const research = el('button', { type: 'button', textContent: 'Research', title: 'Look this up on the web and get a brief with sources' });
      research.addEventListener('click', () => {
        clearNextSteps();
        chooseResearch(record);
      });
      actions.append(research);
    }
    const dismiss = el('button', { type: 'button', className: 'dismiss', textContent: '×', title: 'Dismiss' });
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.addEventListener('click', clearNextSteps);
    actions.append(dismiss);

    node.append(status, actions);
    append(node);
  }

  function sourcesCard(query, sources, title) {
    const list = el('ol', { className: 'sources' }, sources.map((src) => {
      let host = '';
      try {
        host = new URL(src.url).hostname.replace(/^www\./, '');
      } catch {
        // keep empty
      }
      return el('li', {}, [el('a', { href: S.safeUrl(src.url), target: '_blank', rel: 'noopener noreferrer', textContent: src.title || host }), el('small', { textContent: ` ${host}` })]);
    }));
    return el('div', { className: 'card' }, [
      el('div', { className: 'card-title' }, [el('span', { className: 'card-title-text', textContent: `${title}${query ? ` · searched “${query}”` : ''}` })]),
      list,
    ]);
  }

  // Before researching, ask what to focus on: topics the model finds in the summary, the whole
  // summary, or the reader's own words.
  function chooseResearch(record) {
    const title = record.pageTitle || document.title;
    els.thread.querySelectorAll('.topic-card').forEach((n) => n.remove());
    const node = card({ kind: 'topic-card', icon: 'research', title: 'What should the research focus on?' });
    const status = el('p', { className: 'topics-status', textContent: 'Finding topics in this summary…' });
    const topics = el('div', { className: 'topics' });
    const input = el('input', { type: 'text', placeholder: 'Or type your own topic…', maxLength: 120 });
    input.setAttribute('aria-label', 'Research topic');
    const go = el('button', { type: 'button', className: 'primary', textContent: 'Research' });
    const pick = (query) => {
      node.remove();
      runResearch(record, query);
    };
    const everything = el('button', { type: 'button', className: 'topic all', textContent: 'Everything in this summary' });
    everything.addEventListener('click', () => pick(''));
    go.addEventListener('click', () => input.value.trim() && pick(input.value.trim()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && input.value.trim()) pick(input.value.trim());
    });
    node.append(status, topics, el('div', { className: 'topic-own' }, [input, go]));
    topics.append(everything);
    append(node);
    runChat({
      messages: S.buildMessages('researchTopics', S.pageVars({ title, url: record.url || location.href, text: S.stripThinking(record.text).slice(0, 4000) }), sitePrompts()),
      json: true,
    })
      .then((reply) => {
        const found = S.parseTopics(S.stripThinking(reply));
        status.textContent = found.length ? 'Pick a topic, or research everything:' : 'No clear topics found. Research everything, or type your own:';
        for (const topic of found) {
          const button = el('button', { type: 'button', className: 'topic', textContent: topic });
          button.addEventListener('click', () => pick(topic));
          topics.insertBefore(button, everything);
        }
      })
      .catch((err) => {
        status.textContent = `Couldn't suggest topics (${err.message}). Research everything, or type your own:`;
      });
  }

  // Research: search the web (for `query`, or a query the model picks), read the top sources,
  // write a cited brief.
  function runResearch(record, query = '') {
    return runTask(async (signal) => {
      const title = record.pageTitle || document.title;
      addUserMessage(`Research: ${query || title}`);
      const seed = S.pageVars({ title, url: record.url || location.href, text: record.text.slice(0, 4000) });
      let shown = false;
      await runSummaryJob(
        {
          label: `Research: ${title}`,
          kind: 'research',
          snippetId: record.snippetId || '',
          fallbackQuery: title,
          query,
          queryMessages: query ? null : S.buildMessages('researchQuery', seed, sitePrompts()),
          final: S.buildMessages('research', S.pageVars(
            { title, url: record.url || location.href, text: S.JOB_PLACEHOLDERS.sources },
            { context: record.text.slice(0, 3000), question: S.JOB_PLACEHOLDERS.query }
          ), sitePrompts()),
        },
        {
          signal,
          reply: addAssistantMessage(query ? `Searching the web for “${query}”…` : 'Choosing what to search for…'),
          onSources: (msg) => {
            if (shown) return;
            shown = true;
            els.thread.insertBefore(sourcesCard(msg.query, msg.sources, 'Reading'), els.thread.lastElementChild);
          },
        }
      );
    });
  }


  // Home: the opening screen ("How can I help with this page?") at the top of the thread; with a
  // conversation under it, the home button scrolls back up to its questions.
  function showHome() {
    els.empty.hidden = false;
    suggestQuestions();
    els.thread.scrollTop = 0;
  }
  function leaveHome() {
    els.thread.classList.remove('home');
  }



  // Suggested questions on the opening screen, written for this page by the model in quick mode (no
  // long thinking) from the page's text and what kind of page it is: how a product works, the
  // background of a news story, the solution in a thread… Shimmering placeholders show while they're
  // written; the standard questions stay if the model is offline, the page has little text, or the
  // reader turned this off. Kept per URL, so reopening the panel doesn't ask again.
  // The site's question template (shared/templates.js): four slots, Gist · Understand · Check · Next.
  // Its plain questions are the standard ones, shown when the model doesn't write them.
  const questionTemplate = () => S.questionTemplate(location.href, { kind: S.pageKind(pageMeta()).kind, article: pageInfo().type === 'article' });
  const standardQuestions = () => S.plainQuestions(questionTemplate());
  const suggested = { url: '', cache: new Map(), runs: 0 };

  // The page's own description of itself: schema.org JSON-LD types and og:type.
  function pageMeta() {
    const ldTypes = [];
    const collect = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(collect);
      [].concat(node['@type'] || []).forEach((t) => ldTypes.push(String(t)));
      if (node['@graph']) collect(node['@graph']);
      if (node.mainEntity) collect(node.mainEntity);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        collect(JSON.parse(script.textContent));
      } catch {
        // malformed JSON-LD is common; ignore it
      }
    }
    const og = document.querySelector('meta[property="og:type"]');
    return { ldTypes, ogType: (og && og.content) || '', siteId: state.site.id || '', pageType: pageInfo().type, url: location.href };
  }

  function showQuestionPlaceholders(label) {
    els.suggest.replaceChildren(...[0, 1, 2, 3].map(() => el('div', { className: 'ghost' })));
    els.suggestHead.hidden = false;
    els.suggestHead.querySelector('.suggest-label').textContent = label;
    els.suggestHead.querySelector('.suggest-more').hidden = true;
  }

  // offer: automatic questions are off (cloud AI): show a link that writes them on request.
  function renderQuestions(list, label = '', { offer = false } = {}) {
    // Each question shows its slot (Gist, Understand, Check, Next) above it.
    els.suggest.replaceChildren(...list.map((q) => {
      const b = el('button', { type: 'button', className: q.slot ? 'slotted' : '' }, [q.slot ? el('span', { className: 'slot', textContent: q.slot }) : '', el('span', { className: 'q', textContent: q.label || q })]);
      b.dataset.ask = q.ask || q;
      b.classList.toggle('asked', wasAsked(b.dataset.ask));
      return b;
    }));
    els.suggestHead.hidden = !label && !offer;
    els.suggestHead.querySelector('.suggest-label').textContent = label;
    const more = els.suggestHead.querySelector('.suggest-more');
    more.hidden = label !== 'Suggested for this page' && !offer;
    more.textContent = offer ? 'Suggest questions for this page' : 'New questions';
  }

  async function suggestQuestions(force = false) {
    const url = location.href;
    // Sites soroagent never reads (adult, betting…): no suggested questions at all.
    if (S.capture && S.capture.neverRead(url, { adult: S.capture.isAdultPage(document) })) return renderQuestions([], '');
    const prepareOn = S.autoOn(state.settings, 'preparePages');
    if (!force && !prepareOn && !S.autoOn(state.settings, 'pageQuestions')) return renderQuestions(standardQuestions(), '', { offer: state.status === 'ready' });
    // Prepared on visit (from the page's summary): ready, being written, or started now.
    if (!force && prepareOn && preparable()) {
      if (prep.url === url && prep.status === 'done' && prep.questions.length >= 2) return renderQuestions(prep.questions, 'Suggested for this page');
      if (prep.url === url && prep.status === 'working') return showQuestionPlaceholders(isX() ? 'Reading the posts for questions…' : 'Reading the page for questions…');
      if (prep.url !== url || prep.status === 'idle') {
        renderQuestions(standardQuestions());
        preparePage(); // the panel was opened before preparing started
        return;
      }
      // Preparing failed or found no questions: ask for them directly below.
    }
    if (!force && suggested.cache.has(url)) return renderQuestions(suggested.cache.get(url), 'Suggested for this page');
    if (state.status !== 'ready' || els.empty.hidden || state.busy) return;
    if (!force && suggested.url === url) return; // already writing them
    const page = sitePage(4000);
    if (!page.text || page.text.length < 200) return renderQuestions(standardQuestions());
    suggested.url = url;
    const run = ++suggested.runs;
    showQuestionPlaceholders('Reading the page for questions…');
    try {
      const kind = S.pageKind(pageMeta());
      const template = questionTemplate();
      const reply = await runChat({ messages: S.buildMessages('questions', S.pageVars(page, { context: kind.describe, slots: S.slotsText(template) }), sitePrompts()), json: true, quick: true });
      if (run !== suggested.runs) return; // the page changed meanwhile
      if (!S.parseQuestions(S.stripThinking(reply)).length) throw new Error('No questions');
      const questions = S.parseSlotQuestions(S.stripThinking(reply), template);
      suggested.cache.set(url, questions);
      if (suggested.cache.size > 30) suggested.cache.delete(suggested.cache.keys().next().value);
      if (location.href === url) renderQuestions(questions, 'Suggested for this page');
    } catch (err) {
      if (run === suggested.runs) {
        suggested.url = '';
        renderQuestions(standardQuestions());
      }
    }
  }
  els.suggestHead.querySelector('.suggest-more').addEventListener('click', () => {
    suggested.cache.delete(location.href);
    suggested.url = '';
    suggestQuestions(true);
  });

  // ---------------------------------------------------------------------------
  // Prepared on visit: a summary of the page and the questions that follow from it
  // ---------------------------------------------------------------------------
  // When the side panel is open on a page, or after 15 seconds of active reading, the model
  // summarizes the page in the background and, from that summary, writes the questions the reader
  // is likely to have. Opening soroagent shows the questions at once, and Summarize shows the summary
  // at once (then saves it like any other). Nothing is saved unless the reader acts. On by default
  // with an AI on this computer or in the browser, off with a cloud key (S.autoOn). Never on
  // sensitive pages (mail, banking, sign-in, checkout…, the same rules as passive capture) or pages
  // with little text.
  // X keeps loading posts as you scroll: a watcher collects every post that appears on the URL,
  // and the refresh button (showing how many are new) prepares again with all of them.
  const prep = { url: '', status: 'idle', summary: '', questions: [], ids: new Set(), label: '', print: '', kind: 'page', run: 0 };
  const xPosts = new Map(); // X: posts seen on this URL (id -> post), in the order they appeared
  let xPostsUrl = '';

  const isX = () => state.site.id === 'x' && Boolean(items());

  function preparable() {
    if (isPdfDocument()) return false; // the browser's PDF viewer: the side panel reads the file itself
    if (!S.capture || !S.capture.captureAllowed) return true;
    const hasPassword = Boolean(document.querySelector('input[type="password"]'));
    return S.capture.captureAllowed({ url: location.href, hasPassword, textLength: Infinity, adult: S.capture.isAdultPage(document) }, state.settings.captureExclude || []).ok;
  }

  function collectXPosts() {
    if (xPostsUrl !== location.href) {
      xPosts.clear();
      xPostsUrl = location.href;
    }
    for (const post of items().visible(document, siteOptions())) {
      if (xPosts.has(post.id)) continue;
      const { el: _node, ...data } = post; // keep the data, not the DOM node (X recycles them)
      xPosts.set(post.id, data);
    }
  }

  // What to prepare from: the page's text, or on X every post loaded so far (the most recent ones
  // that fit the page-text limit).
  function preparedContent() {
    if (isX()) {
      collectXPosts();
      const site = items();
      const all = [...xPosts.values()];
      const budget = maxChars();
      const list = [];
      let size = 0;
      for (let i = all.length - 1; i >= 0; i--) {
        const length = site.format([all[i]]).length + 2;
        if (list.length && size + length > budget) break;
        list.unshift(all[i]);
        size += length;
      }
      if (!list.length) {
        // No posts matched (X may have changed its markup): read the page as text instead.
        if (!document.querySelector('main [data-testid="primaryColumn"], main section')) return null;
        const fallback = S.readFallback(document);
        if (fallback.text.length < 300) return null;
        report('extractor', 'no-items', `No posts matched on X; read the page with ${fallback.parser} instead`, { where: 'prepare', selector: 'article[data-testid="tweet"]', phase: fallback.parser });
        const condensed = S.condenseText(fallback.text, maxChars(), { title: document.title });
        return { page: { title: document.title, url: location.href, text: condensed.text, condensed: condensed.condensed }, context: 'The posts on this page could not be read one by one, so this is the page text.', count: '', ids: new Set(), label: 'Summarize this page', kind: 'page' };
      }
      const noun = site.noun || 'posts';
      return {
        page: { title: document.title, url: location.href, text: site.format(list) },
        context: `${pageInfo().context || ''} These are the ${list.length} ${noun} loaded on the page so far.`.trim(),
        count: list.length,
        ids: new Set(all.map((p) => p.id)),
        urls: list.map((p) => p.url || ''),
        label: `Summarize ${list.length} loaded ${noun}`,
        kind: 'items',
      };
    }
    const page = sitePage();
    if (!page.text || page.text.length < 500) return null;
    return { page, context: pageInfo().context || '', count: '', ids: new Set(), label: 'Summarize this page', kind: 'page' };
  }

  // Failures that mean the AI isn't reachable or set up (not a problem with this page).
  const PREPARE_BACKOFF_CODES = new Set(['unreachable', 'forbidden', 'unauthorized', 'no_key', 'no_model', 'bad_url', 'browser_not_ready', 'browser_unavailable', 'rate_limited']);
  let prepareBackoffUntil = 0;

  /** Summarizes the page, then writes questions from the summary. explicit: the reader asked (refresh). */
  async function preparePage({ explicit = false } = {}) {
    const url = location.href;
    if (!state.settings.onboarded) return; // no AI set up yet
    if (!explicit && Date.now() < prepareBackoffUntil) return; // the AI wasn't reachable a moment ago
    if (!explicit && (!S.autoOn(state.settings, 'preparePages') || (prep.url === url && prep.status !== 'idle'))) return;
    if (!preparable()) return;
    await ensureSite(Boolean(explicit));
    const content = preparedContent();
    if (!content) {
      // X: the timeline loaded but none of its posts matched (X may have changed its markup).
      if (isX() && document.querySelector('main [data-testid="primaryColumn"], main section')) report('extractor', 'no-items', 'No posts matched on X', { where: 'prepare', selector: 'article[data-testid="tweet"]' });
      return;
    }
    const run = ++prep.run;
    Object.assign(prep, { url, status: 'working', summary: '', questions: [], ids: content.ids, label: content.label, kind: content.kind, print: fingerprint(`${url}\n${content.page.text}`) });
    updateRefresh();
    if (isOpen()) suggestQuestions();
    try {
      const prompts = sitePrompts();
      const summary = S.stripThinking(await runChat({ messages: S.buildMessages('summarize', S.pageVars(content.page, { context: content.context, count: content.count }), prompts) })).trim();
      if (run !== prep.run) return;
      if (!summary) throw new Error('Empty summary');
      prep.summary = summary;
      const kind = S.pageKind(pageMeta());
      const template = questionTemplate();
      const fromSummary = { ...content.page, text: `Summary of the page:\n${summary}` };
      const reply = await runChat({ messages: S.buildMessages('questions', S.pageVars(fromSummary, { context: kind.describe, slots: S.slotsText(template) }), prompts), json: true, quick: true });
      if (run !== prep.run) return;
      prep.questions = S.parseQuestions(S.stripThinking(reply)).length ? S.parseSlotQuestions(S.stripThinking(reply), template) : [];
      prep.status = 'done';
    } catch (err) {
      if (run !== prep.run) return;
      prep.status = prep.summary ? 'done' : 'error';
      // Background work: no console noise (Chrome lists every warning on the extension's Errors
      // page). It goes to the diagnostic log, and when the AI can't be reached at all this tab
      // stops trying for a while instead of failing on every page.
      if (!explicit && PREPARE_BACKOFF_CODES.has(err.code)) prepareBackoffUntil = Date.now() + 10 * 60 * 1000;
      report('llm', 'prepare-failed', err.message || String(err), { where: 'prepare', status: err.code || '' });
    }
    if (location.href !== url) return;
    updateRefresh();
    notifySidePanel();
    if (isOpen()) suggestQuestions();
  }

  // Forgets what was prepared for the previous URL (single-page sites change it without reloading).
  function schedulePrepare() {
    if (prep.url && prep.url !== location.href) {
      prep.run++; // a reply for the old URL is ignored
      Object.assign(prep, { url: '', status: 'idle', summary: '', questions: [], ids: new Set() });
      updateRefresh();
    }
  }

  // Preparing starts when the side panel is open on this page (it asks for a snapshot), or after
  // 15 seconds of active reading: the tab in front and the window focused. Skimming past a page,
  // or tabs opened in the background, cost nothing.
  const DWELL_MS = 15000;
  const dwell = { url: '', ms: 0 };
  setInterval(() => {
    if (dwell.url !== location.href) Object.assign(dwell, { url: location.href, ms: 0 });
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    dwell.ms += 1000;
    if (dwell.ms >= DWELL_MS && prep.url !== location.href && S.autoOn(state.settings, 'preparePages')) preparePage();
  }, 1000);

  function preparedReady() {
    if (prep.url !== location.href || prep.status !== 'done' || !prep.summary) return false;
    if (isX()) return newPostCount() === 0;
    return fingerprint(`${location.href}\n${sitePage().text}`) === prep.print; // the page hasn't changed
  }

  // The prepared summary as the reply to Summarize, saved to the history and snippets like any other.
  function usePrepared() {
    return runTask(async (signal) => {
      addUserMessage(prep.label);
      await runSummaryJob({ label: prep.label, kind: prep.kind, fingerprint: prep.print, final: [], preset: prep.summary }, { signal, reply: addAssistantMessage() });
    });
  }

  // X: prepare again with every post loaded so far, then show the new summary.
  async function refreshPrepared() {
    if (prep.status === 'working' && prep.url === location.href) return;
    if (!isOpen()) openPanel({ focus: false });
    await preparePage({ explicit: true });
    if (prep.url === location.href && prep.status === 'done' && prep.summary) usePrepared();
    else append(card({ title: 'Couldn\'t refresh the summary.', body: 'No posts found yet, or the model is busy. Try again in a moment.' }));
  }

  function newPostCount() {
    if (!isX() || prep.url !== location.href || prep.status === 'idle') return 0;
    let n = 0;
    for (const id of xPosts.keys()) if (!prep.ids.has(id)) n++;
    return n;
  }

  // ---------------------------------------------------------------------------
  // The side panel (pages/sidepanel.html) works from here: it asks this page for a snapshot and for
  // ready-built messages, and runs the model itself. Reading the page and building prompts stays in
  // one place (this file), whichever UI is used.
  // ---------------------------------------------------------------------------

  const isPdfDocument = () => document.contentType === 'application/pdf';

  function snapshot() {
    if (isPdfDocument()) return { ok: true, pdf: true, url: location.href, title: document.title };
    const page = isX() ? null : sitePage(2000);
    const info = pageInfo();
    return {
      ok: true,
      url: location.href,
      title: document.title,
      site: { id: state.site.id, name: state.site.name || '', label: info.label || '', noun: items() ? items().noun || 'items' : '' },
      readable: isX() ? xPosts.size > 0 || Boolean(document.querySelector('article')) : Boolean(page && page.text && page.text.length > 200),
      prepare: { on: S.autoOn(state.settings, 'preparePages'), allowed: preparable() },
      prepared: prep.url === location.href ? { status: prep.status, summary: prep.status === 'done' ? prep.summary : '', questions: prep.questions, label: prep.label } : { status: 'idle', summary: '', questions: [], label: '' },
      newPosts: newPostCount(),
      techFilter: techFeed() ? { on: (state.settings.techFilter || []).includes(techFeed()), label: S.feedFilter.FEEDS[techFeed()].label, hidden: tech.feed ? document.querySelectorAll(`[${S.feedFilter.ATTR}]`).length : 0 } : null,
      standard: S.capture && S.capture.neverRead(location.href, { adult: S.capture.isAdultPage(document) }) ? [] : standardQuestions(),
    };
  }
  let lastNotice = '';
  function notifySidePanel() {
    const notice = `${location.href}|${prep.status}|${prep.questions.length}|${newPostCount()}|${tech.feed ? document.querySelectorAll(`[${S.feedFilter.ATTR}]`).length : -1}`;
    if (notice === lastNotice) return; // only when something the side panel shows changed
    lastNotice = notice;
    sendMessage({ type: 'sidepanel:changed', url: location.href }).catch(() => {});
  }

  // A summary job spec for the side panel: the prepared summary when it's current, else the page.
  function summarySpec({ fresh = false } = {}) {
    const base = { url: location.href, pageTitle: document.title, site: state.site.id === 'default' ? location.hostname : state.site.name, model: '', placeholder: NOTES_PLACEHOLDER };
    const saveMessages = S.buildMessages('save', S.pageVars({ title: document.title, url: location.href, text: S.JOB_PLACEHOLDERS.summary }), sitePrompts());
    if (!fresh && preparedReady()) return { ...base, saveMessages, label: prep.label, kind: prep.kind, fingerprint: prep.print, final: [], preset: prep.summary };
    const content = preparedContent();
    if (!content) throw new Error(isX() ? 'No posts found on this page yet. Wait for it to load, then try again.' : 'This page has no readable text to summarize.');
    const print = fingerprint(`${location.href}\n${content.page.text}`);
    return { ...base, saveMessages, label: content.label, kind: content.kind, fingerprint: print, final: S.buildMessages('summarize', S.pageVars(content.page, { context: content.context, count: content.count }), sitePrompts()) };
  }

  // Messages for a question about this page, for the side panel (it keeps its own history).
  // "Tech only": the page filtered down to tech (the focus prompt). On X, every post loaded so far;
  // on feeds with items (Reddit…), the loaded items; elsewhere the page (a YouTube video with its
  // transcript). The reply's [n] and [m:ss] references become links (S.linkFocusRefs).
  function focusRequest(topic = 'tech') {
    const site = items();
    let page;
    let context;
    let urls = [];
    const content = isX() ? preparedContent() : null;
    if (content) {
      ({ page, context } = content);
      urls = content.urls || [];
    } else if (site && site.visible(document, siteOptions()).length) {
      const posts = site.visible(document, siteOptions());
      const text = site.format(posts, { start: 1 });
      page = { title: document.title, url: location.href, text: text.slice(0, maxChars()), truncated: text.length > maxChars() };
      context = `${pageInfo().context || ''} These are the ${posts.length} ${site.noun || 'items'} loaded on the page.`.trim();
      urls = posts.map((p) => p.url || p.link || '');
    } else {
      page = sitePage();
      context = pageInfo().context || '';
    }
    if (!page || !page.text || page.text.length < 80) return null;
    const messages = S.buildMessages('focus', S.pageVars(page, { context, question: S.FOCUS_TOPICS[topic] }), sitePrompts());
    const videoUrl = /youtube\.com$/.test(location.hostname.replace(/^www\.|^m\./, '')) && /^\/watch/.test(location.pathname) ? location.href.replace(/[&?]t=\d+s?/, '') : '';
    return { messages, urls, videoUrl };
  }

  function techOnly() {
    return runTask(async (signal) => {
      await ensureSite(true); // YouTube: read the transcript
      const req = focusRequest('tech');
      addUserMessage('Tech only');
      if (!req) return append(card({ icon: 'tech', title: 'Nothing to read here yet.', body: 'Scroll to load posts, or open a page with text, then try again.' }));
      const reply = addAssistantMessage('Picking out the tech…');
      const text = await runChat({ messages: req.messages, signal, onToken: reply.push, onThinking: reply.thinking });
      const linked = S.linkFocusRefs(S.stripThinking(text), req);
      reply.finish(linked);
      state.history.push({ role: 'user', content: 'Show me only the tech-related parts of this page.' }, { role: 'assistant', content: linked });
      state.history = state.history.slice(-12);
    });
  }

  function askMessages(question, history = []) {
    const content = isX() ? preparedContent() : null;
    const page = content ? content.page : currentContext();
    const vars = S.pageVars(page, { context: (content && content.context) || pageInfo().context || '', question });
    const [system] = S.buildMessages('ask', vars, sitePrompts());
    return [system, ...history.slice(-12), { role: 'user', content: question }];
  }

  function updateRefresh() {
    notifySidePanel();
    const button = els.refresh;
    button.hidden = !isX();
    if (button.hidden) return;
    const working = prep.status === 'working' && prep.url === location.href;
    const n = newPostCount();
    const badge = button.querySelector('.new-count');
    badge.hidden = !n || working;
    badge.textContent = n > 99 ? '99+' : String(n);
    button.classList.toggle('spin', working);
    button.title = working
      ? 'Reading the posts…'
      : n
        ? `${n} new ${n === 1 ? 'post' : 'posts'} loaded since the summary: refresh the summary and questions`
        : 'Refresh the summary and questions with the posts loaded now';
  }
  els.refresh.addEventListener('click', refreshPrepared);

  // X: watch the page for posts as they load (throttled; the timeline changes constantly).
  let xObserver = null;
  let xTick = 0;
  function watchX() {
    if (!isX()) {
      if (xObserver) xObserver.disconnect();
      xObserver = null;
      updateRefresh();
      return;
    }
    if (xObserver) return;
    xObserver = new MutationObserver(() => {
      if (xTick) return;
      xTick = setTimeout(() => {
        xTick = 0;
        if (!isX()) return;
        collectXPosts();
        updateRefresh();

      }, 800);
    });
    xObserver.observe(document.body, { childList: true, subtree: true });
    updateRefresh();
  }

  // Passive capture saved this page: the owl says so on hover.
  S.onCaptured = () => {
    const title = els.launcher.title;
    els.launcher.title = 'Saved to your PKG: you read this page.';
    setTimeout(() => (els.launcher.title = title), 8000);
  };

  // Related notes: saved notes about the same topic as this page (found locally, no model). The
  // reader can bring them into the chat; answers then cite them as [N1]… and keep what the notes
  // say apart from the model's own reading.
  const related = { url: '', notes: [], using: false, open: false, dismissed: '' };

  async function findRelated() {
    if (related.url === location.href) return renderRelated();
    related.url = location.href;
    related.using = false;
    related.open = false;
    const description = document.querySelector('meta[name="description"], meta[property="og:description"]');
    const text = [document.title, document.title, description && description.content, getPage(4000).text].join(' ');
    try {
      // By meaning and by words, in the background library index.
      related.notes = (await sendMessage({ type: 'library:related', text, excludeUrl: location.href })).notes || [];
    } catch {
      try {
        related.notes = S.relatedNotes(S.buildIndex(await S.listSnippets()), text, { excludeUrl: location.href }).map((h) => h.note);
      } catch {
        related.notes = [];
      }
    }
    renderRelated();
  }

  function notesForChat() {
    return `\n\nThe user's own saved notes that relate to this page, numbered [N1], [N2]…:\n<notes>\n${S.formatNotes(related.notes, { prefix: 'N', perNote: 1500, total: 6000 })}\n</notes>\nWhen you use these notes, cite them as [N#] and keep what they say separate from your own interpretation (for example, "Your notes say … [N1]" versus "My read: …"). Don't present the page's content or your reasoning as coming from the notes.`;
  }

  function renderRelated() {
    const bar = shadow.querySelector('.related');
    const count = related.notes.length;
    bar.hidden = !count || related.dismissed === location.href;
    if (bar.hidden) return;
    const n = count === 1 ? '1 of your saved notes' : `${count} of your saved notes`;
    const text = el('span', { className: 'related-text', textContent: related.using ? `Using ${n} in this chat` : `📚 ${n} relate${count === 1 ? 's' : ''} to this page` });
    const toggle = el('button', { type: 'button', className: 'link', textContent: related.open ? 'Hide' : 'Show' });
    toggle.addEventListener('click', () => {
      related.open = !related.open;
      renderRelated();
    });
    const use = el('button', { type: 'button', className: related.using ? 'quiet' : 'primary', textContent: related.using ? 'Stop using' : 'Use in chat' });
    use.title = related.using ? 'Answer from this page only' : 'Answers will draw on these notes too, cited as [N1], [N2]…';
    use.addEventListener('click', () => {
      related.using = !related.using;
      renderRelated();
      if (related.using) els.input.focus({ preventScroll: true });
    });
    const dismiss = el('button', { type: 'button', className: 'dismiss', textContent: '×', title: 'Hide for this page' });
    dismiss.setAttribute('aria-label', 'Hide related notes');
    dismiss.addEventListener('click', () => {
      related.dismissed = location.href;
      related.using = false;
      renderRelated();
    });
    const row = el('div', { className: 'related-row' }, [text, toggle, el('span', { className: 'related-actions' }, [use, dismiss])]);
    const nodes = [row];
    if (related.open) {
      const list = el('ol', { className: 'related-list' }, related.notes.map((note, i) => {
        const open = el('button', { type: 'button', className: 'link', textContent: note.title || note.pageTitle || 'Untitled' });
        open.addEventListener('click', () => sendMessage({ type: 'open:snippets', id: note.id }));
        return el('li', {}, [el('span', { className: 'n', textContent: `N${i + 1}` }), open, el('small', { textContent: new Date(note.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) })]);
      }));
      nodes.push(list);
    }
    bar.replaceChildren(...nodes);
  }

  // Save: the page itself goes into the library as a snippet (once per page), with its text for
  // search and a short excerpt; the AI adds a title, summary and tags when a model is connected.
  // Saves this page to the library (or finds it there). Used by Save here and in the side panel.
  // Resolves with { already, snippet, labelling }.
  async function savePageData({ label = state.status === 'ready' } = {}) {
    const saved = (await S.snippetsForPage(location.href))[0];
    if (saved) return { already: true, snippet: saved, labelling: false };
    {
      // The page's own description, else its first real paragraph, else the start of its text.
      const description = document.querySelector('meta[name="description"], meta[property="og:description"]');
      const scope = document.querySelector('article, main, [role="main"]') || document.body;
      const paragraph = [...scope.querySelectorAll('p')]
        .filter((p) => !p.closest('table, aside, figure, nav, header, footer, [role="note"], [role="complementary"]'))
        .map((p) => p.textContent.trim())
        .find((t) => t.length > 100 && /[.!?]["”’)]?(\s|$)/.test(t));
      const page = sitePage(8000);
      const full = ((description && description.content) || paragraph || page.text.replace(/^#.*$/m, '') || '')
        .replace(/\[\d+\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const snippet = await S.addSnippet({
        kind: 'page',
        source: 'page',
        title: page.title || document.title || location.hostname,
        pageTitle: document.title,
        url: location.href,
        summary: full.length > 280 ? `${full.slice(0, 280).replace(/\s+\S*$/, '')}…` : full,
        text: page.text,
      });
      if (label) {
        const messages = S.buildMessages('save', S.pageVars({ title: document.title, url: location.href, text: page.text.slice(0, 5000) }), sitePrompts());
        sendMessage({ type: 'capture:label', id: snippet.id, messages }).catch(() => {});
      }
      return { already: false, snippet, labelling: label };
    }
  }

  async function savePage() {
    const open = (id) => ({ label: 'Open in snippets', onClick: () => sendMessage({ type: 'open:snippets', id }) });
    try {
      const { already, snippet, labelling } = await savePageData();
      if (already) {
        append(card({ kind: 'ok', icon: 'save', title: 'Already in your PKG.', body: snippet.title, actions: [open(snippet.id)] }));
        return;
      }
      setTimeout(maybeOfferSync, 1500);
      append(card({ kind: 'ok', icon: 'save', title: 'Saved to your PKG.', body: labelling ? 'Your AI is adding a title, summary and tags.' : snippet.title, actions: [open(snippet.id)] }));
    } catch (err) {
      showError(err, '', false);
    }
  }

  // History: everything saved from this exact page before (summaries, selections, pages).
  const KIND_LABEL = { summary: 'Summary', selection: 'Selection', page: 'Page', research: 'Research', read: 'Read' };
  async function showPageHistory() {
    let items = [];
    try {
      items = await S.snippetsForPage(location.href);
    } catch (err) {
      showError(err, '', false);
      return;
    }
    els.thread.querySelectorAll('.history-card').forEach((n) => n.remove());
    if (!items.length) {
      const empty = card({ icon: 'history', title: 'Nothing saved from this page yet.', body: 'Summaries and pages you save here will show up in this list.' });
      empty.classList.add('history-card');
      append(empty);
      return;
    }
    const list = el('div', { className: 'page-snips' });
    for (const s of items) {
      const kind = s.kind || (s.source === 'selection' ? 'selection' : 'page');
      const row = el('button', { type: 'button', className: 'page-snip', title: 'Open in snippets' });
      row.append(el('span', { className: 'snip-kind', textContent: KIND_LABEL[kind] || kind }));
      const when = new Date(s.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      const preview = s.summary || S.stripThinking(s.text || '').replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
      row.append(
        el('span', { className: 'snip-title', textContent: s.title || s.pageTitle || 'Untitled' }),
        el('span', { className: 'snip-meta', textContent: [when, s.research ? 'researched' : '', preview].filter(Boolean).join(' · ') })
      );
      row.addEventListener('click', () => sendMessage({ type: 'open:snippets', id: s.id }));
      list.append(row);
    }
    const node = card({ kind: 'history-card', icon: 'history', title: `${items.length} saved from this page` });
    node.append(list);
    append(node);
  }

  // Coming back to a page: show summaries that finished while the reader was away, and
  // reconnect to ones still running.
  async function showPendingSummaries() {
    let records = [];
    try {
      records = (await sendMessage({ type: 'summary:for-url', url: location.href })).records || [];
    } catch {
      return;
    }
    const relevant = records.filter((r) => r.status !== 'running' || r.live);
    if (!relevant.length) return;
    openPanel({ focus: false });
    const seen = [];
    for (const record of relevant) {
      const when = new Date(record.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      if (record.status === 'running') {
        append(card({ icon: 'summarize', title: `Still working on "${record.label}" (started ${when}).`, body: 'It kept running while you were away.' }));
        const reply = addAssistantMessage(record.statusText || 'Summarizing…');
        const port = ext.runtime.connect({ name: 'summary' });
        followJob(port, reply).then((finished) => {
          state.history.push({ role: 'user', content: record.label }, { role: 'assistant', content: finished.text });
          afterJob(finished);
          sendMessage({ type: 'summary:seen', ids: [record.id] }).catch(() => {});
        }).catch((err) => showError(err, err.hint, false));
        port.postMessage({ type: 'attach', id: record.id });
        continue;
      }
      seen.push(record.id);
      if (record.status === 'done') {
        append(card({ kind: 'ok', icon: 'check', title: `Finished while you were away: ${record.label}`, body: `Started at ${when}.` }));
        addAssistantMessage().finish(record.text);
        state.history.push({ role: 'user', content: record.label }, { role: 'assistant', content: record.text });
        afterJob(record);
      } else if (record.status !== 'stopped') {
        showError(new Error(`"${record.label}" didn't finish: ${record.error || record.status}`), record.hint, false);
      }
    }
    if (seen.length) sendMessage({ type: 'summary:seen', ids: seen }).catch(() => {});
  }

  // Feeds (X, Reddit): Summarize reads only what's already loaded, then offers "Read more", one
  // batch at a time, and only when the reader asks.

  function inViewport(site, item) {
    const target = site.element(item);
    const rect = target && target.getBoundingClientRect();
    return Boolean(rect && rect.bottom > 0 && rect.top < window.innerHeight);
  }

  function summarizeFeed({ fresh }) {
    const site = items();
    const info = pageInfo();
    const options = siteOptions();
    const optionsKey = JSON.stringify(options);
    const noun = site.noun || 'items';

    return runTask(async (signal) => {
      const loaded = site.visible(document, options);
      if (!loaded.length) {
        append(card({ title: `No ${noun} found on this page yet.`, body: 'Wait for the page to load, then try again.' }));
        report('extractor', 'no-items', `No ${noun} found by the site profile`, { where: 'summarize' });
        return;
      }
      // Unchanged since the last summary: every post on screen was part of it.
      const key = `feed:${fingerprint(location.href + optionsKey)}`;
      const cached = state.summaries.get(key);
      const onScreen = loaded.filter((p) => inViewport(site, p)).map((p) => p.id);
      const unchanged = cached && onScreen.length > 0 && onScreen.every((postId) => cached.ids.has(postId));
      const label = `Summarize ${loaded.length} loaded ${noun}${info.label ? ` · ${info.label}` : ''}`;
      if (unchanged && !fresh) {
        showCachedSummary(cached.label, cached.summary, () => summarize({ fresh: true }));
        if (!state.feed || state.feed.url !== location.href) state.feed = { ...cached.feed, seen: new Set(cached.feed.seen) };
        offerReadMore();
        return;
      }

      state.feed = { url: location.href, optionsKey, seen: new Set(loaded.map((p) => p.id)), endY: undefined, done: loaded.length, exhausted: false };
      addUserMessage(label);
      const context = `${info.context || ''} These are the ${noun} currently loaded on the page.`;
      const text = await summarizeItems(loaded, { start: 1, context, signal, label });
      state.summaries.set(key, {
        label,
        summary: { text, at: Date.now() },
        ids: new Set(loaded.map((p) => p.id)),
        feed: { ...state.feed, seen: [...state.feed.seen] },
      });
      offerReadMore();
    });
  }

  function readMore() {
    const site = items();
    const feed = state.feed;
    if (!site || !feed || feed.url !== location.href) return summarize();
    const info = pageInfo();
    const options = siteOptions();
    const noun = site.noun || 'items';
    const target = site.batchSize || 50;

    return runTask(async (signal) => {
      addUserMessage(`Read ${target} more ${noun}`);
      const progress = progressCard('summarize', `Loading more ${noun}… 0 of ${target}`);
      const startY = window.scrollY;
      let result;
      try {
        result = await site.collect({
          target,
          skip: feed.seen,
          options,
          signal,
          fromY: feed.endY ?? window.scrollY,
          onProgress: (count) => progress.update(`Loading more ${noun}… ${count} of ${target}`, count / target),
        });
      } finally {
        progress.node.remove();
        window.scrollTo({ top: startY }); // back to where the reader was
      }
      feed.endY = result.endY;
      feed.exhausted = result.exhausted;
      if (!result.items.length) {
        feed.exhausted = true;
        offerReadMore();
        return;
      }
      for (const item of result.items) feed.seen.add(item.id);
      const start = feed.done + 1;
      feed.done += result.items.length;
      const context = `${info.context || ''} This batch is ${noun} ${start} to ${feed.done}, loaded after the ones already summarized.`;
      await summarizeItems(result.items, { start, context, signal, label: `Read ${target} more ${noun}` });
      offerReadMore();
    });
  }

  function offerReadMore() {
    const site = items();
    const feed = state.feed;
    if (!site || !feed) return;
    const noun = site.noun || 'items';
    const count = site.batchSize || 50;
    const more = feed.exhausted
      ? { note: `All ${feed.done} ${noun} that loaded` }
      : { count, note: `${noun} 1–${feed.done}`, hint: `Scrolls to load up to ${count} more, summarizes only the new ones, then brings you back.` };
    state.next = { ...(state.next || {}), more };
    renderNextSteps();
  }

  // ---------------------------------------------------------------------------
  // Follow-up questions: two under each answer, written by the model from that answer, so the reader
  // can keep exploring. Earlier ones stay in the conversation; clicked questions are ticked.
  // ---------------------------------------------------------------------------

  const asked = new Set(); // questions asked on this page (lowercase), across suggestions and follow-ups
  let askedUrl = '';
  const askedKey = (q) => String(q).toLowerCase().replace(/[?.!\s]+$/, '');
  function wasAsked(q) {
    if (askedUrl !== location.href) {
      askedUrl = location.href;
      asked.clear();
    }
    return asked.has(askedKey(q));
  }
  function markAsked(button) {
    wasAsked(''); // resets on a new URL
    asked.add(askedKey(button.dataset.ask));
    button.classList.add('asked');
  }

  let followUps = null; // { controller, node } while being written
  function stopFollowUps() {
    if (!followUps) return;
    followUps.controller.abort();
    if (!followUps.node.querySelector('button')) followUps.node.remove();
    followUps = null;
  }

  async function suggestFollowUps(question, answer) {
    stopFollowUps();
    const text = S.stripThinking(String(answer || ''));
    if (state.settings.followUps === false || text.trim().length < 80) return;
    const node = el('div', { className: 'follow-ups', role: 'group' });
    node.setAttribute('aria-label', 'Follow-up questions');
    node.append(el('div', { className: 'follow-label', textContent: 'Keep exploring' }), el('div', { className: 'ghost' }), el('div', { className: 'ghost' }));
    append(node);
    const mine = (followUps = { controller: new AbortController(), node });
    try {
      const vars = S.followUpVars({ title: document.title, url: location.href, question, answer: text });
      const reply = await runChat({ messages: S.buildMessages('followUps', vars, sitePrompts()), json: true, quick: true, signal: mine.controller.signal });
      const list = S.pickFollowUps(reply, [question, ...asked]);
      if (followUps !== mine) return;
      if (!list.length) throw new Error('No follow-ups');
      node.querySelectorAll('.ghost').forEach((g) => g.remove());
      for (const q of list) node.append(el('button', { type: 'button', textContent: q }));
      node.querySelectorAll('button').forEach((b) => (b.dataset.ask = b.textContent));
      followUps = null;
    } catch (err) {
      if (followUps === mine) followUps = null;
      node.remove();
      if (err.name !== 'AbortError') report('llm', 'follow-ups-failed', err.message, { code: err.code || '' });
    }
  }
  els.thread.addEventListener('click', (e) => {
    const button = e.target.closest('.follow-ups button[data-ask]');
    if (!button || state.busy) return;
    markAsked(button);
    ask(button.dataset.ask);
  });

  // ---------------------------------------------------------------------------
  // Ask
  // ---------------------------------------------------------------------------

  function currentContext() {
    const site = items();
    if (site) {
      const posts = site.visible(document, siteOptions());
      if (posts.length) {
        const text = site.format(posts, { start: 1 });
        return { title: document.title, url: location.href, text: text.slice(0, maxChars()), truncated: text.length > maxChars() };
      }
    }
    return sitePage();
  }

  // Questions like "where is my data stored?" could be about soroagent or about the website:
  // ask which, then answer about soroagent from facts (no model needed) or about the page as usual.
  function ask(question) {
    const topic = S.ownTopic(question);
    if (!topic) return askPage(question);
    addUserMessage(question);
    const host = location.hostname.replace(/^www\./, '');
    const node = card({
      icon: 'chat',
      title: 'Do you mean soroagent or this website?',
      body: `I can answer about me (the owl in your browser), or about ${host} from what this page says.`,
      actions: [
        {
          label: 'soroagent 🦉',
          onClick: () => {
            node.remove();
            const answer = S.ownAnswer(topic, { cloud: state.cloud, providerLabel: els.where.textContent, autoBackup: state.settings.autoBackup, autoCapture: state.settings.autoCapture });
            addAssistantMessage().finish(answer);
            state.history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
          },
        },
        {
          label: `This website (${host})`,
          onClick: () => {
            node.remove();
            askPage(question, { echo: false });
          },
        },
      ],
    });
    append(node);
  }

  function askPage(question, { echo = true } = {}) {
    return runTask(async (signal) => {
      await ensureSite(true);
      if (!state.pageContext || state.pageContext.url !== location.href) {
        state.pageContext = { url: location.href, page: currentContext() };
        state.history = [];
      }
      if (echo) addUserMessage(question);
      const vars = S.pageVars(state.pageContext.page, { context: pageInfo().context || '', question });
      const [system] = S.buildMessages('ask', vars, sitePrompts());
      if (related.using && related.notes.length) system.content += notesForChat();
      await streamAnswer([system, ...state.history, { role: 'user', content: question }], question, signal);
    });
  }

  // An answer about the page. When the page doesn't have it, the model asks for a web search
  // ([[search: …]], held back while streaming so it never shows) or says so in words; soroagent then
  // looks it up (Settings → "Search the web when the page doesn't have the answer"), or offers to.
  async function streamAnswer(messages, question, signal) {
    const reply = addAssistantMessage('Thinking…');
    let held = '';
    let released = false;
    const onToken = (token) => {
      if (released) return reply.push(token);
      held += token;
      if (!S.mayBeWebRequest(held)) {
        released = true;
        reply.push(held);
      }
    };
    let text;
    try {
      text = await runChat({ messages, signal, onToken, onThinking: reply.thinking });
    } catch (err) {
      reply.finish();
      if (!reply.node.textContent.trim() || reply.node.textContent === '(no response)') reply.node.remove();
      throw err;
    }
    const web = S.parseWebRequest(S.stripThinking(text), question);
    if (web.query && web.explicit) reply.node.remove();
    else reply.finish(web.shown || text);
    if (!web.query) {
      state.history.push({ role: 'user', content: question }, { role: 'assistant', content: text });
      state.history = state.history.slice(-12);
      suggestFollowUps(question, text);
      return text;
    }
    if (state.settings.webFallback === false) {
      const node = card({
        icon: 'research',
        title: 'That isn’t on this page.',
        body: 'Look it up on the web? soroagent searches, reads the top results and answers with sources.',
        actions: [{ label: `Search the web for “${web.query}”`, onClick: () => (node.remove(), runTask((s) => webAnswer(question, web.query, s))) }],
      });
      append(node);
      return text;
    }
    return webAnswer(question, web.query, signal);
  }

  // Searches the web for a question the page couldn't answer and answers from the top results, cited.
  async function webAnswer(question, query, signal) {
    const reply = addAssistantMessage(`Not on this page. Searching the web for “${query}”…`);
    const res = await sendMessage({ type: 'web:sources', query });
    if (!res || res.ok === false) {
      reply.node.remove();
      report('error', 'web-search', (res && res.error) || 'No result', { where: 'webAnswer' });
      throw Object.assign(new Error((res && res.error) || 'Couldn’t search the web.'), { hint: 'Check your connection, or pick another search engine in Settings → Research.' });
    }
    reply.status(`Reading ${res.sources.length} web sources…`);
    const messages = S.buildMessages('webAnswer', S.pageVars({ title: document.title, url: location.href, text: res.formatted }, { question }), sitePrompts());
    const text = await runChat({ messages, signal, onToken: reply.push, onThinking: reply.thinking });
    reply.finish(text);
    append(sourcesCard(query, res.sources, 'From the web'));
    state.history.push({ role: 'user', content: question }, { role: 'assistant', content: `${text}\n\n(Answered from a web search for “${query}”.)` });
    state.history = state.history.slice(-12);
    suggestFollowUps(question, text);
    return text;
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Site bar: page label and the site's toggles
  // ---------------------------------------------------------------------------

  function renderSiteBar() {
    const site = state.site;
    els.siteBar.hidden = site.id === 'default';
    els.input.placeholder = items() ? `Ask about these ${items().noun || 'items'}…` : 'Ask about this page…';
    if (els.siteBar.hidden) return;
    els.siteLabel.textContent = pageInfo().label || site.name;
    els.siteBar.querySelectorAll('.toggle').forEach((t) => t.remove());
    const values = siteOptions();
    for (const option of site.options || []) {
      const toggle = el('button', { type: 'button', className: 'toggle', textContent: option.label, title: option.title || '' });
      toggle.setAttribute('aria-pressed', String(values[option.id]));
      toggle.addEventListener('click', () => {
        const all = { ...(state.settings.siteOptions || {}) };
        all[site.id] = { ...siteOptions(), [option.id]: !values[option.id] };
        S.saveSettings({ siteOptions: all });
      });
      els.siteBar.append(toggle);
    }
    // "Hide non-tech" on feeds (X, Reddit, YouTube lists): the AI sorts the posts, the rest are hidden.
    if (techFeed()) {
      const on = (state.settings.techFilter || []).includes(techFeed());
      const toggle = el('button', { type: 'button', className: 'toggle tech-toggle', title: `Hide the ${S.feedFilter.FEEDS[techFeed()].label} that aren't about tech. Your AI sorts them as they load; turn off to show everything again.` }, ['Hide non-tech', el('span', { className: 'tech-count' })]);
      toggle.setAttribute('aria-pressed', String(on));
      toggle.addEventListener('click', () => setTechFilter(!on));
      els.siteBar.append(toggle);
      renderTechCount();
    }
  }

  // ---------------------------------------------------------------------------
  // Hide non-tech (content/feedfilter.js finds the posts; the techSort prompt sorts them). On while
  // the reader has it on for this feed; posts are sent to the AI in batches of 25 as they load, each
  // verdict is kept (nothing is asked twice), and anything not yet sorted, or that the AI couldn't
  // sort, stays visible. Never on pages soroagent doesn't read.
  // ---------------------------------------------------------------------------


  function setTechFilter(on) {
    const feed = techFeed();
    if (!feed) return;
    const list = new Set(state.settings.techFilter || []);
    if (on) list.add(feed);
    else list.delete(feed);
    S.saveSettings({ techFilter: [...list] });
  }

  function techFilterActive() {
    const feed = techFeed();
    if (!feed || !(state.settings.techFilter || []).includes(feed) || !state.settings.onboarded) return '';
    if (S.capture && S.capture.neverRead(location.href, { adult: S.capture.isAdultPage(document) })) return '';
    return feed;
  }

  // Started, stopped or moved to another feed: on settings changes, navigation and start.
  function syncTechFilter() {
    const feed = techFilterActive();
    if (!feed) {
      if (tech.observer) tech.observer.disconnect();
      tech.observer = null;
      tech.feed = '';
      S.feedFilter && S.feedFilter.showAll();
      renderTechCount();
      return;
    }
    tech.feed = feed;
    if (!tech.observer) {
      tech.observer = new MutationObserver(() => scheduleTechScan());
      tech.observer.observe(document.body, { childList: true, subtree: true });
    }
    scheduleTechScan(0);
  }

  function scheduleTechScan(delay = 700) {
    if (tech.timer) return; // one pending scan at a time (feeds change constantly)
    tech.timer = setTimeout(() => {
      tech.timer = 0;
      scanTech();
    }, delay);
  }

  async function scanTech() {
    if (!tech.feed) return;
    const unknown = [];
    const keys = new Set();
    for (const card of S.feedFilter.feedCards(tech.feed)) {
      const verdict = tech.verdicts.get(card.key);
      if (verdict === undefined) {
        if (!keys.has(card.key)) unknown.push(card);
        keys.add(card.key);
      } else S.feedFilter.setHidden(card.el, !verdict);
    }
    renderTechCount();
    if (!unknown.length || tech.busy || Date.now() < tech.pausedUntil) return;
    tech.busy = true;
    const batch = unknown.slice(0, 25);
    try {
      const content = batch.map((c, i) => `[${i + 1}] ${c.text}`).join('\n');
      const reply = await runChat({ messages: S.buildMessages('techSort', { question: S.FOCUS_TOPICS.tech, content }, {}), json: true, quick: true });
      const ids = S.feedFilter.parseTopicIds(S.stripThinking(reply), batch.length);
      if (!ids) report('llm', 'tech-sort-unreadable', 'The AI\'s reply to sort posts wasn\'t readable', { where: 'techSort' });
      batch.forEach((c, i) => tech.verdicts.set(c.key, ids ? ids.has(i + 1) : true)); // unreadable: keep them visible
    } catch (err) {
      // The AI isn't reachable: keep these visible and try new posts again in two minutes.
      batch.forEach((c) => tech.verdicts.set(c.key, true));
      tech.pausedUntil = Date.now() + 120000;
      report('llm', 'tech-sort-failed', err.message, { code: err.code || '' });
    } finally {
      tech.busy = false;
      if (tech.verdicts.size > 3000) tech.verdicts.delete(tech.verdicts.keys().next().value);
      scheduleTechScan(0);
    }
  }

  function renderTechCount() {
    notifySidePanel();
    const count = els.siteBar.querySelector('.tech-count');
    if (!count) return;
    const hidden = tech.feed ? document.querySelectorAll(`[${S.feedFilter.ATTR}]`).length : 0;
    count.textContent = hidden ? ` · ${hidden} hidden` : '';
  }

  function applySiteOptions() {
    if (!state.site.applyOptions) return;
    try {
      state.site.applyOptions(siteOptions());
    } catch (err) {
      report('extractor', 'options-failed', err.message, { where: 'applyOptions' });
    }
  }

  // Single-page apps (like X) change the URL without reloading.
  setInterval(() => {
    if (location.href === state.url) return;
    state.url = location.href;
    const site = S.siteFor(location);
    if (site !== state.site) {
      state.site = site;
      applySiteOptions();
    }
    state.pageContext = null;
    renderSiteBar();
    syncTechFilter();
    showPendingSummaries();
    watchX();
    schedulePrepare();
    if (isOpen()) suggestQuestions();
  }, 800);

  // ---------------------------------------------------------------------------
  // Panel open / close and events
  // ---------------------------------------------------------------------------

  const isOpen = () => !els.panel.hidden;

  function openPanel({ focus = true } = {}) {
    if (!isOpen()) {
      els.panel.hidden = false;
      els.launcher.classList.add('open');
      renderSiteBar();
      launcherCtl.placePanel();
      findRelated();
      if (state.status !== 'ready') connect();
      else suggestQuestions();
    }
    if (focus) els.input.focus({ preventScroll: true });
  }

  function closePanel() {
    els.panel.hidden = true;
    els.menu.hidden = true;
    els.launcher.classList.remove('open');
  }

  function applySettings() {
    const hiddenHere = (state.settings.hiddenSites || []).includes(location.hostname);
    els.launcher.hidden = !state.settings.showLauncher || hiddenHere;
    els.resetPosition.hidden = !launcherCtl.hasCustomPlacement();
    launcherCtl.place();
    applyPanelSize();
  }

  els.launcher.addEventListener('click', () => (isOpen() ? closePanel() : openPanel()));
  els.close.addEventListener('click', closePanel);
  els.panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });

  els.actions.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const action = chip.dataset.action;
    if (action === 'summarize') summarize();
    else if (action === 'tech') techOnly();
    else if (action === 'page-history') showPageHistory();
    else if (action === 'save') savePage();
  });

  // Suggested questions on the empty screen.
  els.empty.addEventListener('click', (e) => {
    const button = e.target.closest('[data-ask]');
    if (button && !state.busy) {
      markAsked(button);
      ask(button.dataset.ask);
    }
  });
  shadow.querySelector('.home-btn').addEventListener('click', showHome);
  shadow.querySelector('header [data-action="page-history"]').addEventListener('click', showPageHistory);

  // Clicking a chip would otherwise clear the user's text selection on the page.
  els.actions.addEventListener('mousedown', (e) => e.preventDefault());

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.busy) {
      state.busy.abort();
      return;
    }
    const question = els.input.value.trim();
    if (!question) return;
    els.input.value = '';
    els.input.style.height = '';
    ask(question);
  });

  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });
  els.input.addEventListener('input', () => {
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight, 140)}px`;
  });

  els.model.addEventListener('change', () => {
    // Picking a model counts as an answer to the model suggestion.
    S.saveSettings({ ...S.modelPatch(state.settings, els.model.value), modelTipSeen: true });
    els.statusText.textContent = els.model.value;
  });

  els.menuBtn.addEventListener('click', () => {
    els.menu.hidden = !els.menu.hidden;
  });
  els.menu.addEventListener('click', async (e) => {
    const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
    els.menu.hidden = true;
    if (cmd === 'snippets') sendMessage({ type: 'open:snippets' });
    else if (cmd === 'feedback') window.open(S.feedbackUrl('menu'), '_blank', 'noopener');
    else if (cmd === 'settings') sendMessage({ type: 'open:options' });
    else if (cmd === 'to-sidepanel') {
      // The side panel opens beside the page (the background opens it within this click); the owl
      // and this panel step aside. Switch back from the side panel's menu or in Settings.
      const res = await sendMessage({ type: 'appearance:set', mode: 'sidepanel' }).catch((err) => ({ ok: false, error: err.message }));
      if (res && res.ok && res.openFromToolbar) {
        append(card({ kind: 'ok', icon: 'check', title: 'Switched to the sidebar.', body: 'Click soroagent in the toolbar, or press Alt+Shift+O, to open it there. Switch back from its ⋯ menu.' }));
      } else if (res && res.ok) closePanel();
      else append(card({ kind: 'error', icon: 'alert', title: 'Couldn’t switch to the side panel.', body: (res && res.error) || 'Try Settings → On the page.' }));
    }
    else if (cmd === 'clear') {
      state.history = [];
      state.pageContext = null;
      els.thread.querySelectorAll(':scope > .msg, :scope > .card, :scope > .cached, :scope > .follow-ups').forEach((n) => n.remove());
      clearNextSteps();
      stopFollowUps();
      leaveHome();
      els.thread.classList.remove('chatting');
      asked.clear();
      els.suggest.querySelectorAll('.asked').forEach((b) => b.classList.remove('asked'));
      els.empty.hidden = false;
    } else if (cmd === 'reset-position') {
      const placements = { ...(state.settings.launcherPlacements || {}) };
      delete placements[location.hostname];
      await S.saveSettings({ launcherPlacements: placements });
    } else if (cmd === 'hide-site') {
      const sites = new Set(state.settings.hiddenSites || []);
      sites.add(location.hostname);
      await S.saveSettings({ hiddenSites: [...sites] });
      closePanel();
    }
  });
  shadow.addEventListener('click', (e) => {
    if (!els.menu.hidden && !e.target.closest('.menu, .menu-btn')) els.menu.hidden = true;
  });

  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('assistant:')) return false;
    if (msg.type === 'assistant:toggle') {
      if (isOpen()) closePanel();
      else openPanel();
    } else if (msg.type === 'assistant:run') {
      openPanel();
      if (msg.action === 'summarize') summarize();
    } else if (msg.type.startsWith('assistant:sp-')) {
      // Requests from the side panel (an extension page), answered asynchronously.
      if (sender.id !== ext.runtime.id) return false;
      (async () => {
        if (msg.type === 'assistant:sp-snapshot') {
          // The side panel is open on this page: prepare now (when automatic preparing is on).
          if (S.autoOn(state.settings, 'preparePages') && prep.url !== location.href && preparable()) preparePage();
          return snapshot();
        }
        if (msg.type === 'assistant:sp-summary') {
          await ensureSite(true);
          return { ok: true, spec: summarySpec({ fresh: Boolean(msg.fresh) }) };
        }
        if (msg.type === 'assistant:sp-ask') {
          const topic = S.ownTopic(String(msg.question || ''));
          if (topic && !msg.aboutPage) return { ok: true, topic, host: location.hostname.replace(/^www\./, '') };
          await ensureSite(true);
          return { ok: true, messages: askMessages(String(msg.question || ''), msg.history || []) };
        }
        if (msg.type === 'assistant:sp-focus') {
          await ensureSite(true);
          const req = focusRequest(msg.topic || 'tech');
          return req ? { ok: true, ...req } : { ok: false, error: 'Nothing to read here yet. Scroll to load posts, then try again.' };
        }
        if (msg.type === 'assistant:sp-techfilter') {
          setTechFilter(Boolean(msg.on));
          return { ok: true };
        }
        if (msg.type === 'assistant:sp-save') return { ok: true, ...(await savePageData({ label: true })) };
        if (msg.type === 'assistant:sp-refresh') {
          await preparePage({ explicit: true });
          return snapshot();
        }
        if (msg.type === 'assistant:sp-open') {
          openPanel();
          return { ok: true };
        }
        return { ok: false, error: 'Unknown request.' };
      })().then(sendResponse, (err) => sendResponse({ ok: false, error: err.message, code: err.code || '' }));
      return true;
    }
    sendResponse({ ok: true });
    return false;
  });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.keysVersion) {
      if (isOpen()) connect();
      return;
    }
    if (!changes.settings) return;
    const before = state.settings;
    state.settings = { ...S.DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    applySettings();
    if (JSON.stringify(before.siteOptions) !== JSON.stringify(state.settings.siteOptions)) {
      applySiteOptions();
      renderSiteBar();
    }
    if (String(before.techFilter) !== String(state.settings.techFilter) || before.onboarded !== state.settings.onboarded) {
      syncTechFilter();
      renderSiteBar();
    }
    const keys = ['source', 'baseUrl', 'provider', 'apiKey', 'cloudProvider', 'customBaseUrl'];
    if (keys.some((k) => before[k] !== state.settings[k]) && isOpen()) connect();
  });

  // Keep the toolbar icon in step with the browser's light/dark theme.
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const reportTheme = () => ext.runtime.sendMessage({ type: 'theme', dark: darkQuery.matches }).catch(() => {});
  darkQuery.addEventListener('change', reportTheme);
  // Also re-check when the tab comes back into view (the theme may have changed meanwhile).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reportTheme();
  });
  reportTheme();

  S.getSettings().then((settings) => {
    state.settings = settings;
    applySettings();
    applySiteOptions();
    showPendingSummaries();
    watchX();
    schedulePrepare();
    syncTechFilter();
  });
  updateControls();
})();

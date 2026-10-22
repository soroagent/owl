// The side panel (Chrome's side panel, Firefox's sidebar): soroagent beside the page instead of on
// it, so no site's CSS can touch it, and it stays open across tabs and pages. It follows the active
// tab and keeps a conversation per tab. The page's content script reads the page and builds the
// prompts (assistant.js, "assistant:sp-*" requests); this page runs the model and shows the answers.
(function () {
  'use strict';

  const S = globalThis.soroagent;
  S.watchPageErrors('side panel');
  const { ext } = S;
  const $ = (id) => document.getElementById(id);
  const STANDARD = [
    { ask: 'What are the key points of this page?', label: 'What are the key points?' },
    { ask: "Explain this page simply, as if I'm new to the topic.", label: 'Explain it simply' },
    { ask: 'What claims here need checking, and what might be missing?', label: 'What should I double-check?' },
  ];
  const SEND = $('send').innerHTML;
  const STOP = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>';

  const state = { windowId: null, tabId: null, url: '', snap: null, ai: null, busy: null, threads: new Map() };

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  const toTab = (msg) => ext.tabs.sendMessage(state.tabId, msg);
  const thread = () => {
    if (!state.threads.has(state.tabId)) state.threads.set(state.tabId, { node: el('div', { className: 'thread' }), history: [], url: '' });
    return state.threads.get(state.tabId);
  };
  function scrollEnd() {
    $('main').scrollTop = $('main').scrollHeight;
  }
  function append(node) {
    showThread();
    thread().node.append(node);
    scrollEnd();
    return node;
  }
  function card({ kind = '', title, body = '', pre = '', actions = [] }) {
    const node = el('div', { className: `card ${kind}` }, [el('b', { textContent: title })]);
    if (body) node.append(el('p', { textContent: body }));
    if (pre) node.append(el('pre', { textContent: pre }));
    if (actions.length) {
      node.append(el('div', { className: 'card-actions' }, actions.map((a) => {
        const b = el('button', { type: 'button', textContent: a.label });
        b.addEventListener('click', (e) => a.onClick(e, node));
        return b;
      })));
    }
    return node;
  }
  const addUser = (text) => append(el('div', { className: 'msg user', textContent: text }));

  // An assistant message that renders Markdown as it streams in (escaped by renderMarkdown).
  function addAssistant(pending = 'Thinking…') {
    const node = append(el('div', { className: 'msg assistant pending', textContent: pending }));
    let text = '';
    let frame = 0;
    const paint = () => {
      frame = 0;
      node.classList.remove('pending');
      node.innerHTML = S.renderMarkdown(S.stripThinking(text));
      scrollEnd();
    };
    return {
      node,
      push(t) {
        text += t;
        if (!frame) frame = requestAnimationFrame(paint);
      },
      status(t) {
        if (!text) node.textContent = t;
      },
      finish(full) {
        if (typeof full === 'string') text = full;
        cancelAnimationFrame(frame);
        if (text) paint();
        else node.remove();
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  function showHome() {
    $('homeView').hidden = false;
    for (const t of state.threads.values()) t.node.hidden = true;
  }
  function showThread() {
    $('homeView').hidden = true;
    for (const [id, t] of state.threads) t.node.hidden = id !== state.tabId;
    if (!thread().node.isConnected) $('main').append(thread().node);
  }

  function renderQuestions(list, label = '') {
    $('suggest').replaceChildren(...list.map((q) => {
      const b = el('button', { type: 'button', textContent: q.label || q });
      b.addEventListener('click', () => ask(q.ask || q));
      return b;
    }));
    $('suggestHead').hidden = !label;
    $('suggestLabel').textContent = label;
  }

  function renderPage() {
    const snap = state.snap;
    const page = $('page');
    page.replaceChildren();
    if (!snap) {
      page.textContent = 'soroagent can’t read this page';
      return;
    }
    if (snap.site.label || (snap.site.id && snap.site.id !== 'default')) page.append(el('b', { textContent: `${snap.site.label || snap.site.name} · ` }));
    page.append(snap.title || snap.url);
    page.title = snap.title || '';
    $('input').placeholder = snap.site.noun ? `Ask about these ${snap.site.noun}…` : 'Ask about this page…';
    // Questions: prepared from the page's summary, being prepared, or the standard ones.
    const p = snap.prepared;
    if (p.status === 'done' && p.questions.length >= 2) renderQuestions(p.questions, 'Suggested for this page');
    else if (p.status === 'working') {
      $('suggest').replaceChildren(...[0, 1, 2, 3].map(() => el('div', { className: 'ghost' })));
      $('suggestHead').hidden = false;
      $('suggestLabel').textContent = snap.site.id === 'x' ? 'Reading the posts for questions…' : 'Reading the page for questions…';
    } else renderQuestions(STANDARD);
    // X: refresh with the posts that loaded since.
    const x = snap.site.id === 'x';
    $('refresh').hidden = !x;
    $('refresh').classList.toggle('spin', p.status === 'working');
    $('newCount').hidden = !snap.newPosts || p.status === 'working';
    $('newCount').textContent = snap.newPosts > 99 ? '99+' : String(snap.newPosts || '');
    $('refresh').title = snap.newPosts ? `${snap.newPosts} new posts loaded since the summary: refresh` : 'Refresh the summary with the posts loaded now';
  }

  function setEnabled() {
    const readable = Boolean(state.snap && state.snap.readable);
    const ready = Boolean(state.ai && state.ai.ok);
    $('summarize').disabled = !readable || !ready || Boolean(state.busy);
    $('save').disabled = !state.snap;
    $('shot').disabled = !state.tabId;
    $('input').disabled = !ready || !state.snap;
    $('send').disabled = !state.busy && (!ready || !state.snap);
    $('send').innerHTML = state.busy ? STOP : SEND;
    $('send').setAttribute('aria-label', state.busy ? 'Stop' : 'Send');
  }

  // ---------------------------------------------------------------------------
  // The active tab
  // ---------------------------------------------------------------------------

  async function load(tabId) {
    state.tabId = tabId;
    let tab = null;
    try {
      tab = await ext.tabs.get(tabId);
    } catch {
      // closed
    }
    const url = (tab && tab.url) || '';
    const t = thread();
    if (t.url && url && t.url !== url && t.node.childElementCount) t.node.append(el('div', { className: 'divider', textContent: `Now on: ${(tab && tab.title) || 'another page'}` }));
    t.url = url;
    state.url = url;
    state.snap = /^https?:/.test(url) ? await toTab({ type: 'assistant:sp-snapshot' }).catch(() => null) : null;
    renderPage();
    if (!state.snap) {
      $('homeNote').textContent = /^https?:/.test(url)
        ? 'Reload this page to use soroagent here (it was open before soroagent was installed or updated).'
        : 'soroagent works on web pages. Browser pages, extension stores and PDFs can’t be read.';
    } else $('homeNote').textContent = state.ai && state.ai.ok ? noteFor(state.ai) : '';
    if (t.node.childElementCount) showThread();
    else showHome();
    setEnabled();
  }

  const noteFor = (st) => (st.cloud ? `Runs on ${st.providerLabel} with your API key.` : st.browser ? `Runs on ${st.providerLabel}, inside this browser.` : 'Runs on your computer. Nothing leaves your machine.');

  async function connectAI() {
    $('statusText').textContent = 'Connecting…';
    $('dot').className = 'dot';
    const settings = await S.getSettings();
    if (!settings.onboarded) {
      state.ai = { ok: false };
      $('statusText').textContent = 'Set up an AI';
      append(card({ title: 'Connect an AI to get started', body: 'It takes a moment: soroagent finds an AI on your computer by itself, or you can use your own key.', actions: [{ label: 'Set up', onClick: () => ext.tabs.create({ url: ext.runtime.getURL('pages/onboard.html') }) }] }));
      setEnabled();
      return;
    }
    const st = await ext.runtime.sendMessage({ type: 'llm:status' }).catch((err) => ({ ok: false, error: err.message }));
    state.ai = st;
    if (st && st.ok) {
      $('dot').className = 'dot ready';
      $('statusText').textContent = st.model || st.providerLabel;
      $('statusText').title = `${st.model} · ${st.providerLabel}`;
      $('homeNote').textContent = state.snap ? noteFor(st) : $('homeNote').textContent;
    } else {
      $('dot').className = 'dot offline';
      $('statusText').textContent = 'Offline';
      showAiError(st || {}, settings);
    }
    setEnabled();
  }

  function showAiError(res, settings) {
    if (res.code === 'forbidden' && settings.source === 'local') {
      const fix = S.ollamaOriginsFix(navigator.platform || navigator.userAgent);
      append(card({
        kind: 'error',
        title: 'Ollama is blocking browser extensions',
        body: `Run this once in ${fix.os === 'Windows' ? 'Command Prompt' : 'Terminal'}. It lets browser extensions (and no websites) use Ollama. ${fix.then}`,
        pre: fix.command,
        actions: [
          { label: 'Copy command', onClick: (e) => navigator.clipboard.writeText(fix.command).then(() => (e.target.textContent = 'Copied')) },
          { label: 'Retry', onClick: (e, node) => (node.remove(), connectAI()) },
        ],
      }));
      return;
    }
    append(card({ kind: 'error', title: res.error || 'Couldn’t reach your AI.', pre: res.hint || '', actions: [{ label: 'Retry', onClick: (e, node) => (node.remove(), connectAI()) }, { label: 'Settings', onClick: () => ext.runtime.openOptionsPage() }] }));
  }

  // ---------------------------------------------------------------------------
  // Running things
  // ---------------------------------------------------------------------------

  async function run(task) {
    if (state.busy) return;
    const controller = new AbortController();
    state.busy = controller;
    setEnabled();
    try {
      await task(controller.signal);
    } catch (err) {
      if (err.name !== 'AbortError') append(card({ kind: 'error', title: err.message || 'Something went wrong.', pre: err.hint || '' }));
    } finally {
      state.busy = null;
      setEnabled();
    }
  }

  // A chat reply streamed over the background's "llm" port.
  function streamChat(messages, reply, signal) {
    return new Promise((resolve, reject) => {
      const port = ext.runtime.connect({ name: 'llm' });
      let done = false;
      const ping = setInterval(() => port.postMessage({ type: 'ping' }), 15000);
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearInterval(ping);
        try {
          port.disconnect();
        } catch {
          // closed
        }
        fn(v);
      };
      port.onMessage.addListener((m) => {
        if (m.type === 'token') reply.push(m.text);
        else if (m.type === 'thinking') reply.status('Thinking…');
        else if (m.type === 'done') finish(resolve, m.text);
        else if (m.type === 'error') finish(reject, Object.assign(new Error(m.error), { code: m.code, hint: m.hint }));
      });
      port.onDisconnect.addListener(() => finish(reject, new Error('Lost the connection to soroagent.')));
      signal.addEventListener('abort', () => finish(reject, Object.assign(new Error('Stopped.'), { name: 'AbortError' })), { once: true });
      port.postMessage({ type: 'chat', messages, model: '' });
    });
  }

  // A summary as a background job: it finishes even if the panel closes, and lands in the history.
  function runJob(spec, reply, signal) {
    return new Promise((resolve, reject) => {
      const port = ext.runtime.connect({ name: 'summary' });
      let id = '';
      let done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        try {
          port.disconnect();
        } catch {
          // closed
        }
        fn(v);
      };
      port.onMessage.addListener((m) => {
        if (m.type === 'started') id = m.id;
        else if (m.type === 'status') reply.status(m.text);
        else if (m.type === 'thinking') reply.status('Thinking…');
        else if (m.type === 'token') reply.push(m.text);
        else if (m.type === 'done') finish(resolve, m.record);
        else if (m.type === 'error' || m.type === 'gone') finish(reject, Object.assign(new Error((m.record && m.record.error) || 'The summary failed.'), { hint: m.record && m.record.hint }));
      });
      port.onDisconnect.addListener(() => finish(reject, new Error('Lost the connection to soroagent. The summary is in your summary history.')));
      signal.addEventListener('abort', () => {
        if (id) port.postMessage({ type: 'stop', id });
        finish(reject, Object.assign(new Error('Stopped.'), { name: 'AbortError' }));
      }, { once: true });
      port.postMessage({ type: 'start', job: spec });
    });
  }

  function summarize(fresh = false) {
    return run(async (signal) => {
      const res = await toTab({ type: 'assistant:sp-summary', fresh });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Couldn’t read this page.');
      addUser(res.spec.label);
      const reply = addAssistant(res.spec.preset ? 'Here it is…' : 'Reading the page…');
      const record = await runJob(res.spec, reply, signal);
      reply.finish(record.text);
      thread().history.push({ role: 'user', content: res.spec.label }, { role: 'assistant', content: record.text });
      if (record.snippetId) append(card({ kind: 'ok', title: 'Saved to your snippets', actions: [{ label: 'Open', onClick: () => ext.runtime.sendMessage({ type: 'open:snippets', id: record.snippetId }) }] }));
    });
  }

  function ask(question, { aboutPage = false, echo = true } = {}) {
    return run(async (signal) => {
      if (echo) addUser(question);
      const t = thread();
      const res = await toTab({ type: 'assistant:sp-ask', question, history: t.history, aboutPage });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Couldn’t read this page.');
      if (res.topic) {
        // "Where is my data stored?": about soroagent, or about the website?
        const settings = await S.getSettings();
        append(card({
          title: 'Do you mean soroagent or this website?',
          body: `I can answer about me (the owl in your browser), or about ${res.host} from what this page says.`,
          actions: [
            {
              label: 'soroagent 🦉',
              onClick: (e, node) => {
                node.remove();
                const answer = S.ownAnswer(res.topic, { cloud: state.ai && state.ai.cloud, providerLabel: state.ai && state.ai.providerLabel, autoBackup: settings.autoBackup, autoCapture: settings.autoCapture });
                addAssistant().finish(answer);
                t.history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
              },
            },
            { label: `This website (${res.host})`, onClick: (e, node) => (node.remove(), ask(question, { aboutPage: true, echo: false })) },
          ],
        }));
        return;
      }
      const reply = addAssistant();
      try {
        const text = await streamChat(res.messages, reply, signal);
        reply.finish(text);
        t.history.push({ role: 'user', content: question }, { role: 'assistant', content: text });
        t.history = t.history.slice(-12);
      } catch (err) {
        reply.finish();
        throw err;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  $('summarize').addEventListener('click', () => summarize());
  $('save').addEventListener('click', async () => {
    const res = await toTab({ type: 'assistant:sp-save' }).catch((err) => ({ ok: false, error: err.message }));
    if (!res || !res.ok) return append(card({ kind: 'error', title: (res && res.error) || 'Couldn’t save this page.' }));
    const open = { label: 'Open in snippets', onClick: () => ext.runtime.sendMessage({ type: 'open:snippets', id: res.snippet.id }) };
    append(card({ kind: 'ok', title: res.already ? 'Already in your library.' : 'Saved to your library.', body: res.already ? res.snippet.title : 'Your AI is adding a title, summary and tags.', actions: [open] }));
  });
  $('shot').addEventListener('click', async () => {
    const tab = await ext.tabs.get(state.tabId).catch(() => null);
    const res = await ext.runtime.sendMessage({ type: 'screenshot:capture', tabId: state.tabId, title: tab ? tab.title : '' }).catch((err) => ({ ok: false, error: err.message }));
    if (!res || res.ok === false) append(card({ kind: 'error', title: 'Couldn’t take the screenshot.', pre: (res && res.error) || '' }));
    else append(card({ kind: 'ok', title: 'Screenshot saved to your snippets.', actions: [{ label: 'Open', onClick: () => ext.runtime.sendMessage({ type: 'open:snippets', id: res.id }) }] }));
  });
  // X: prepare again with every post loaded so far, then show the new summary.
  $('refresh').addEventListener('click', async () => {
    if (state.busy || $('refresh').classList.contains('spin')) return;
    $('refresh').classList.add('spin');
    const snap = await toTab({ type: 'assistant:sp-refresh' }).catch(() => null);
    if (snap) state.snap = snap;
    renderPage();
    if (snap && snap.prepared.status === 'done' && snap.prepared.summary) summarize();
    else append(card({ kind: 'error', title: 'Couldn’t refresh the summary.', body: 'No posts found yet, or your AI is busy. Try again in a moment.' }));
  });
  $('home').addEventListener('click', showHome);
  $('moreBtn').addEventListener('click', () => ($('menu').hidden = !$('menu').hidden));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#menu, #moreBtn')) $('menu').hidden = true;
  });
  $('menu').addEventListener('click', (e) => {
    const cmd = e.target.closest('[data-cmd]');
    if (!cmd) return;
    $('menu').hidden = true;
    const c = cmd.dataset.cmd;
    if (c === 'page') toTab({ type: 'assistant:sp-open' }).catch(() => {});
    else if (c === 'settings') ext.runtime.openOptionsPage();
    else ext.runtime.sendMessage({ type: `open:${c}` }).catch(() => {});
  });
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.busy) {
      state.busy.abort();
      return;
    }
    const q = $('input').value.trim();
    if (!q) return;
    $('input').value = '';
    $('input').style.height = '';
    ask(q);
  });
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('composer').requestSubmit();
    }
  });
  $('input').addEventListener('input', () => {
    $('input').style.height = 'auto';
    $('input').style.height = `${Math.min($('input').scrollHeight, 140)}px`;
  });

  // Follow the active tab, its navigations, and the page's prepared summary and questions.
  ext.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (windowId === state.windowId) load(tabId);
  });
  ext.tabs.onUpdated.addListener((tabId, change) => {
    if (tabId === state.tabId && (change.url || change.status === 'complete')) load(tabId);
  });
  ext.runtime.onMessage.addListener((msg, sender) => {
    if (msg && msg.type === 'sidepanel:changed' && sender.tab && sender.tab.id === state.tabId) {
      toTab({ type: 'assistant:sp-snapshot' }).then((snap) => {
        state.snap = snap;
        renderPage();
        setEnabled();
      }).catch(() => {});
    }
    return false;
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.settings || changes.keysVersion)) connectAI();
  });

  (async () => {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    state.windowId = tab ? tab.windowId : null;
    if (tab) await load(tab.id);
    await connectAI();
  })();
})();

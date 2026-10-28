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
  // Without the page's own (site-specific) standard questions, the generic template's (shared/templates.js).
  const STANDARD = S.plainQuestions(S.questionTemplate(''));
  const standardFor = () => (state.snap && state.snap.standard) || STANDARD;
  // Markup goes in through DOMParser (inert: no scripts run) and is moved over as nodes.
  function setHtml(node, html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    node.replaceChildren(...doc.body.childNodes);
  }
  const SEND = $('send').innerHTML;
  const STOP = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>';

  const state = { windowId: null, tabId: null, url: '', snap: null, ai: null, busy: null, threads: new Map(), pdfs: new Map() };

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
    if (!state.threads.has(state.tabId)) state.threads.set(state.tabId, { node: el('div', { className: 'thread' }), history: [], url: '', asked: new Set() });
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
  const addUser = (text) => {
    stopFollowUps();
    return append(el('div', { className: 'msg user', textContent: text }));
  };

  // An assistant message that renders Markdown as it streams in (escaped by renderMarkdown).
  function addAssistant(pending = 'Thinking…') {
    const node = append(el('div', { className: 'msg assistant pending', textContent: pending }));
    let text = '';
    let frame = 0;
    const paint = () => {
      frame = 0;
      node.classList.remove('pending');
      setHtml(node, S.renderMarkdown(S.stripThinking(text))); // renderMarkdown escapes the text first
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

  // The opening screen (suggested questions) stays above the conversation, so the reader can scroll
  // back up and pick another; Home scrolls up to it.
  function showHome() {
    const chatting = thread().node.childElementCount > 0;
    if (chatting) return showThread(true);
    $('homeView').hidden = false;
    $('main').classList.remove('chatting');
    for (const t of state.threads.values()) t.node.hidden = true;
  }
  function showThread(top = false) {
    $('homeView').hidden = false;
    $('main').classList.add('chatting');
    for (const [id, t] of state.threads) t.node.hidden = id !== state.tabId;
    if (!thread().node.isConnected) $('main').append(thread().node);
    if (top) $('main').scrollTop = 0;
  }

  function renderQuestions(list, label = '') {
    $('suggestMore').hidden = true;
    // Each question shows its slot (Gist, Understand, Check, Next) above it.
    $('suggest').replaceChildren(...list.map((q) => {
      const b = el('button', { type: 'button', className: q.slot ? 'slotted' : '' }, [q.slot ? el('span', { className: 'slot', textContent: q.slot }) : '', el('span', { textContent: q.label || q })]);
      b.dataset.ask = q.ask || q;
      b.classList.toggle('asked', thread().asked.has(askedKey(b.dataset.ask)));
      b.addEventListener('click', () => askFrom(b));
      return b;
    }));
    $('suggestHead').hidden = !label;
    $('suggestLabel').textContent = label;
  }

  function renderPage() {
    const snap = state.snap;
    const page = $('page');
    page.replaceChildren();
    $('techFilter').hidden = true;
    renderPageActions(snap && snap.page);
    const pdf = currentPdf();
    if (pdf) {
      page.append(el('b', { textContent: 'PDF · ' }), pdf.title || pdf.url);
      $('input').placeholder = 'Ask about this PDF…';
      $('refresh').hidden = true;
      if (pdf.questions.length >= 2) renderQuestions(pdf.questions, 'Suggested for this PDF');
      else if (pdf.status === 'reading' || pdf.status === 'questions') {
        $('suggest').replaceChildren(...[0, 1, 2, 3].map(() => el('div', { className: 'ghost' })));
        $('suggestHead').hidden = false;
        $('suggestLabel').textContent = pdf.status === 'reading' ? 'Reading the PDF…' : 'Writing questions for this PDF…';
      } else {
        renderQuestions(STANDARD);
        const offer = pdf.status === 'ready' && Boolean(state.ai && state.ai.ok);
        $('suggestHead').hidden = !offer;
        $('suggestMore').hidden = !offer;
      }
      return;
    }
    if (!snap) {
      page.textContent = 'soroagent can’t read this page';
      return;
    }
    if (snap.site.label || (snap.site.id && snap.site.id !== 'default')) page.append(el('b', { textContent: `${snap.site.label || snap.site.name} · ` }));
    page.append(snap.title || snap.url);
    // Feeds: "Hide non-tech" hides the posts or videos that aren't about tech, on the page itself.
    const tf = snap.techFilter;
    $('techFilter').hidden = !tf;
    if (tf) {
      $('techFilter').setAttribute('aria-pressed', String(tf.on));
      $('techFilter').textContent = tf.on ? `Hiding non-tech${tf.hidden ? ` · ${tf.hidden}` : ''}` : 'Hide non-tech';
      $('techFilter').title = tf.on ? `Show all ${tf.label} again` : `Hide the ${tf.label} that aren't about tech (your AI sorts them as they load)`;
    }
    page.title = snap.title || '';
    $('input').placeholder = snap.site.noun ? `Ask about these ${snap.site.noun}…` : 'Ask about this page…';
    // Questions: prepared from the page's summary, being prepared, or the standard ones.
    const p = snap.prepared;
    if (p.status === 'done' && p.questions.length >= 2) renderQuestions(p.questions, 'Suggested for this page');
    else if (p.status === 'working') {
      $('suggest').replaceChildren(...[0, 1, 2, 3].map(() => el('div', { className: 'ghost' })));
      $('suggestHead').hidden = false;
      $('suggestLabel').textContent = snap.site.id === 'x' ? 'Reading the posts for questions…' : 'Reading the page for questions…';
    } else {
      renderQuestions(standardFor());
      // Automatic preparing is off (a cloud AI): write questions for this page on request.
      const offer = !snap.prepare.on && snap.prepare.allowed && snap.readable && Boolean(state.ai && state.ai.ok);
      $('suggestHead').hidden = !offer;
      $('suggestMore').hidden = !offer;
    }
    // X: refresh with the posts that loaded since.
    const x = snap.site.id === 'x' && !snap.page;
    $('refresh').hidden = !x;
    $('refresh').classList.toggle('spin', p.status === 'working');
    $('newCount').hidden = !snap.newPosts || p.status === 'working';
    $('newCount').textContent = snap.newPosts > 99 ? '99+' : String(snap.newPosts || '');
    $('refresh').title = snap.newPosts ? `${snap.newPosts} new posts loaded since the summary: refresh` : 'Refresh the summary with the posts loaded now';
  }

  // Page actions (feeds, news, threads, videos): the same buttons as the floating panel. The page
  // builds each request (assistant:sp-page); summaries run here as jobs, the rest as chats.
  function renderPageActions(p) {
    if (!p) return $('feedBox').replaceChildren();
    const busy = Boolean(state.busy) || p.running;
    const nodes = [
      el('div', { className: 'feed-title', textContent: p.title }),
      ...p.buttons.map((a) => {
        const local = a.id === 'clutter' || a.id === 'new';
        const b = el('button', { type: 'button', textContent: a.label, disabled: !local && (busy || !(state.ai && state.ai.ok)) });
        if (a.pressed !== undefined) b.setAttribute('aria-pressed', String(a.pressed));
        b.addEventListener('click', () => runPageAction(a));
        return b;
      }),
    ];
    if (p.note || (p.running && p.progress)) nodes.push(el('p', { className: 'feed-note', textContent: p.running && p.progress ? p.progress : p.note }));
    if (p.running) {
      const stop = el('button', { type: 'button', className: 'link', textContent: 'Stop' });
      stop.addEventListener('click', () => toTab({ type: 'assistant:sp-page', op: 'stop' }).catch(() => {}));
      nodes.push(stop);
    } else if (p.result) nodes.push(card({ kind: 'ok', title: p.result, actions: [{ label: 'Open PKG', onClick: () => ext.runtime.sendMessage({ type: 'open:pkg' }) }] }));
    $('feedBox').replaceChildren(...nodes);
  }

  function runPageAction(a) {
    if (a.id === 'save' || a.id === 'clutter') return toTab({ type: 'assistant:sp-page', id: a.id }).catch(() => {});
    return run(async (signal) => {
      addUser(a.label);
      const reply = addAssistant(a.id === 'top' ? 'Collecting…' : 'Reading the page…');
      const stop = () => toTab({ type: 'assistant:sp-page', op: 'stop' }).catch(() => {});
      signal.addEventListener('abort', stop, { once: true });
      let res;
      try {
        res = await toTab({ type: 'assistant:sp-page', id: a.id });
      } finally {
        signal.removeEventListener('abort', stop);
      }
      if (signal.aborted || (res && res.stopped)) {
        reply.finish('');
        throw Object.assign(new Error('Stopped.'), { name: 'AbortError' });
      }
      if (!res || !res.ok) {
        reply.finish('');
        throw new Error((res && res.error) || 'Couldn’t read this page.');
      }
      let text;
      if (res.kind === 'text') text = res.text;
      else if (res.kind === 'job') {
        reply.status(`Reading ${res.count} ${res.noun}…`);
        const record = await runJob(res.spec, reply, signal);
        text = record.text;
        if (record.snippetId) {
          reply.finish(text);
          append(card({ kind: 'ok', title: 'Saved to your snippets', actions: [{ label: 'Open', onClick: () => ext.runtime.sendMessage({ type: 'open:snippets', id: record.snippetId }) }] }));
        }
      } else text = S.browse.linkRefs(S.stripThinking(await streamChat(res.messages, reply, signal)), res);
      reply.finish(text);
      thread().history.push({ role: 'user', content: res.label || a.label }, { role: 'assistant', content: text });
      if (res.kind !== 'text') suggestFollowUps(res.label || a.label, text);
    });
  }

  function setEnabled() {
    const pdf = currentPdf();
    renderPageActions(!pdf && state.snap ? state.snap.page : null);
    const readable = Boolean((state.snap && state.snap.readable) || (pdf && pdf.status === 'ready' && pdf.text));
    const ready = Boolean(state.ai && state.ai.ok);
    $('summarize').disabled = !readable || !ready || Boolean(state.busy);
    $('save').disabled = !state.snap && !(pdf && pdf.status === 'ready');
    $('input').disabled = !ready || !readable;
    $('send').disabled = !state.busy && (!ready || !readable);
    setHtml($('send'), state.busy ? STOP : SEND);
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
    if (t.url && url && t.url !== url) t.asked.clear();
    if (t.url && url && t.url !== url && t.node.childElementCount) t.node.append(el('div', { className: 'divider', textContent: `Now on: ${(tab && tab.title) || 'another page'}` }));
    t.url = url;
    state.url = url;
    const pdf = state.pdfs.get(tabId);
    if (pdf && pdf.pageUrl !== url) state.pdfs.delete(tabId); // the tab moved on
    state.snap = /^https?:/.test(url) && !state.pdfs.has(tabId) && !S.isPdf(url) ? await toTab({ type: 'assistant:sp-snapshot' }).catch(() => null) : null;
    // A PDF in the browser's viewer: the page there is only the viewer, so read the file from here.
    if (state.snap && state.snap.pdf) state.snap = null;
    if (!state.snap && !state.pdfs.has(tabId) && /^https?:/.test(url)) {
      const probe = S.isPdf(url) ? { pdf: true } : await ext.runtime.sendMessage({ type: 'pdf:probe', url }).catch(() => null);
      if (probe && probe.pdf) readPdf(tabId, url, url);
    }
    renderPage();
    if (currentPdf()) renderPdfNote();
    else if (!state.snap) {
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
  // PDFs: read in the background with pdf.js, then handled here like a page
  // ---------------------------------------------------------------------------

  const currentPdf = () => state.pdfs.get(state.tabId) || null;

  function renderPdfNote() {
    const pdf = currentPdf();
    $('homeNote').textContent =
      pdf.status === 'reading' ? 'Reading the PDF…'
      : pdf.status === 'error' ? `Couldn’t read this PDF: ${pdf.error}`
      : !pdf.text ? 'This PDF has no text to read (it may be a scan).'
      : `Read ${pdf.pages} page${pdf.pages === 1 ? '' : 's'}${pdf.truncated ? ' (the first 400)' : ''}. ${state.ai && state.ai.ok ? noteFor(state.ai) : ''}`;
  }

  // pageUrl: the tab's address (the PDF itself, or a page with a link to it).
  async function readPdf(tabId, url, pageUrl, { thenSummarize = false } = {}) {
    const pdf = { url, pageUrl, status: 'reading', title: '', text: '', pages: 0, truncated: false, error: '', questions: [] };
    state.pdfs.set(tabId, pdf);
    if (tabId === state.tabId) {
      renderPage();
      renderPdfNote();
      setEnabled();
    }
    const res = await ext.runtime.sendMessage({ type: 'pdf:read', url }).catch((err) => ({ ok: false, error: err.message }));
    Object.assign(pdf, res && res.ok ? { status: 'ready', title: res.title, text: res.text, pages: res.pages, truncated: res.truncated } : { status: 'error', error: (res && res.error) || 'unknown error' });
    if (state.pdfs.get(tabId) !== pdf) return;
    if (tabId === state.tabId) {
      renderPage();
      renderPdfNote();
      setEnabled();
    }
    if (pdf.status !== 'ready' || !pdf.text) return;
    if (thenSummarize && tabId === state.tabId) summarize();
    else if (S.autoOn(await S.getSettings(), 'preparePages')) pdfQuestions(tabId);
  }

  async function pdfPage(pdf) {
    const limit = S.pageCharLimit(await S.getSettings());
    const condensed = S.condenseText(pdf.text, limit, { title: pdf.title });
    return { title: pdf.title, url: pdf.url, text: condensed.text, condensed: condensed.condensed };
  }
  const pdfContext = (pdf) => `This is a PDF document (${pdf.pages} pages), read as text: figures and tables may be missing or out of order.`;

  async function pdfSpec(pdf) {
    const page = await pdfPage(pdf);
    return {
      url: pdf.url,
      pageTitle: pdf.title,
      site: 'PDF',
      model: '',
      label: 'Summarize this PDF',
      kind: 'page',
      fingerprint: `pdf:${pdf.pages}:${pdf.text.length}`,
      final: S.buildMessages('summarize', S.pageVars(page, { context: pdfContext(pdf) }), {}),
      saveMessages: S.buildMessages('save', S.pageVars({ title: pdf.title, url: pdf.url, text: S.JOB_PLACEHOLDERS.summary }), {}),
    };
  }

  async function pdfAskMessages(pdf, question, history) {
    const [system] = S.buildMessages('ask', S.pageVars(await pdfPage(pdf), { context: pdfContext(pdf), question }), {});
    return [system, ...history.slice(-12), { role: 'user', content: question }];
  }

  async function savePdf(pdf) {
    const saved = (await S.snippetsForPage(pdf.url))[0];
    if (saved) return { ok: true, already: true, snippet: saved };
    const intro = pdf.text.replace(/\s+/g, ' ').trim();
    const snippet = await S.addSnippet({ kind: 'page', source: 'pdf', title: pdf.title, pageTitle: pdf.title, url: pdf.url, summary: intro.length > 280 ? `${intro.slice(0, 280).replace(/\s+\S*$/, '')}…` : intro, text: pdf.text.slice(0, 20000) });
    const messages = S.buildMessages('save', S.pageVars({ title: pdf.title, url: pdf.url, text: (await pdfPage(pdf)).text.slice(0, 5000) }), {});
    ext.runtime.sendMessage({ type: 'capture:label', id: snippet.id, messages }).catch(() => {});
    return { ok: true, already: false, snippet };
  }

  // Questions for a PDF, written from its condensed text in quick mode.
  async function pdfQuestions(tabId) {
    const pdf = state.pdfs.get(tabId);
    if (!pdf || pdf.status !== 'ready' || !state.ai || !state.ai.ok) return;
    pdf.status = 'questions';
    if (tabId === state.tabId) renderPage();
    const template = S.questionTemplate('');
    const messages = S.buildMessages('questions', S.pageVars(await pdfPage(pdf), { context: `${pdfContext(pdf)} The reader wants the main argument or findings, the method, the evidence and its limits, and related work.`, slots: S.slotsText(template) }), {});
    const reply = { push() {}, status() {} };
    const text = await streamChat(messages, reply, new AbortController().signal, { json: true, quick: true }).catch(() => '');
    pdf.questions = S.parseQuestions(S.stripThinking(text)).length ? S.parseSlotQuestions(S.stripThinking(text), template) : [];
    pdf.status = 'ready';
    if (tabId === state.tabId) renderPage();
  }

  // "Summarize this PDF with soroagent" (right-click): read it here and summarize.
  async function takePdfRequest(req) {
    if (!req || !req.url || Date.now() - (req.at || 0) > 60000) return;
    ext.storage.session.remove('pdfRequest').catch(() => {});
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    if (tab.id !== state.tabId) await load(tab.id);
    const existing = state.pdfs.get(tab.id);
    if (existing && existing.url === req.url && existing.status === 'ready') return summarize();
    readPdf(tab.id, req.url, tab.url || '', { thenSummarize: true });
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
  function streamChat(messages, reply, signal, { json = false, quick = false } = {}) {
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
      port.postMessage({ type: 'chat', messages, json, quick, model: '' });
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
      const pdf = currentPdf();
      if (pdf && (pdf.status === 'reading' || pdf.status === 'error' || !pdf.text)) throw new Error(pdf.status === 'reading' ? 'Still reading the PDF…' : 'This PDF has no text soroagent could read.');
      const res = pdf ? { ok: true, spec: await pdfSpec(pdf) } : await toTab({ type: 'assistant:sp-summary', fresh });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Couldn’t read this page.');
      addUser(res.spec.label);
      const reply = addAssistant(res.spec.preset ? 'Here it is…' : 'Reading the page…');
      const record = await runJob(res.spec, reply, signal);
      reply.finish(record.text);
      thread().history.push({ role: 'user', content: res.spec.label }, { role: 'assistant', content: record.text });
      if (record.snippetId) append(card({ kind: 'ok', title: 'Saved to your snippets', actions: [{ label: 'Open', onClick: () => ext.runtime.sendMessage({ type: 'open:snippets', id: record.snippetId }) }] }));
      suggestFollowUps(res.spec.label, record.text);
    });
  }

  // ---------------------------------------------------------------------------
  // Follow-up questions: two under each answer, written by the model from that answer (the same
  // followUps prompt as the floating panel). Clicked questions, suggested or follow-up, are ticked.
  // ---------------------------------------------------------------------------

  const askedKey = (q) => String(q).toLowerCase().replace(/[?.!\s]+$/, '');
  function askFrom(button) {
    if (state.busy) return;
    thread().asked.add(askedKey(button.dataset.ask));
    button.classList.add('asked');
    ask(button.dataset.ask);
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
    if ((await S.getSettings()).followUps === false || text.trim().length < 80) return;
    const t = thread();
    const node = el('div', { className: 'follow-ups', role: 'group' }, [el('div', { className: 'follow-label', textContent: 'Keep exploring' }), el('div', { className: 'ghost' }), el('div', { className: 'ghost' })]);
    node.setAttribute('aria-label', 'Follow-up questions');
    append(node);
    const mine = (followUps = { controller: new AbortController(), node });
    try {
      const pdf = currentPdf();
      const vars = S.followUpVars({ title: (pdf && pdf.title) || (state.snap && state.snap.title) || '', url: state.url, question, answer: text });
      const quiet = { push() {}, status() {} };
      const reply = await streamChat(S.buildMessages('followUps', vars, {}), quiet, mine.controller.signal, { json: true, quick: true });
      const list = S.pickFollowUps(reply, [question, ...t.asked]);
      if (followUps !== mine) return;
      if (!list.length) throw new Error('No follow-ups');
      node.querySelectorAll('.ghost').forEach((g) => g.remove());
      for (const q of list) {
        const b = el('button', { type: 'button', textContent: q });
        b.dataset.ask = q;
        b.addEventListener('click', () => askFrom(b));
        node.append(b);
      }
      followUps = null;
    } catch (err) {
      if (followUps === mine) followUps = null;
      node.remove();
    }
  }

  function ask(question, { aboutPage = false, echo = true } = {}) {
    return run(async (signal) => {
      if (echo) addUser(question);
      const t = thread();
      const pdf = currentPdf();
      const res = pdf ? { ok: true, messages: await pdfAskMessages(pdf, question, t.history) } : await toTab({ type: 'assistant:sp-ask', question, history: t.history, aboutPage });
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
      // Held back while it could still be [[search: …]] (the page doesn't have the answer).
      let held = '';
      let released = false;
      const gate = { push: (tok) => (released ? reply.push(tok) : ((held += tok), !S.mayBeWebRequest(held) && ((released = true), reply.push(held)))), status: reply.status };
      let text;
      try {
        text = await streamChat(res.messages, gate, signal);
      } catch (err) {
        reply.finish();
        throw err;
      }
      const web = S.parseWebRequest(S.stripThinking(text), question);
      if (web.query && web.explicit) reply.node.remove();
      else reply.finish(web.shown || text);
      if (!web.query) {
        t.history.push({ role: 'user', content: question }, { role: 'assistant', content: text });
        t.history = t.history.slice(-12);
        suggestFollowUps(question, text);
        return;
      }
      const settings = await S.getSettings();
      if (settings.webFallback === false) {
        append(card({
          title: 'That isn’t on this page.',
          body: 'Look it up on the web? soroagent searches, reads the top results and answers with sources.',
          actions: [{ label: `Search the web for “${web.query}”`, onClick: (e, node) => (node.remove(), run((s) => webAnswer(question, web.query, s))) }],
        }));
        return;
      }
      await webAnswer(question, web.query, signal);
    });
  }

  // A question the page couldn't answer: web search results, then a cited answer from them.
  async function webAnswer(question, query, signal) {
    const reply = addAssistant(`Not on this page. Searching the web for “${query}”…`);
    const res = await ext.runtime.sendMessage({ type: 'web:sources', query }).catch((err) => ({ ok: false, error: err.message }));
    if (!res || res.ok === false) {
      reply.node.remove();
      throw Object.assign(new Error((res && res.error) || 'Couldn’t search the web.'), { hint: 'Check your connection, or pick another search engine in Settings → Research.' });
    }
    reply.status(`Reading ${res.sources.length} web sources…`);
    const pdf = currentPdf();
    const page = { title: (pdf && pdf.title) || (state.snap && state.snap.title) || '', url: state.url, text: res.formatted };
    const text = await streamChat(S.buildMessages('webAnswer', S.pageVars(page, { question }), {}), reply, signal);
    reply.finish(text);
    const list = el('ol', {}, res.sources.map((src) => el('li', {}, [el('a', { href: S.safeUrl(src.url), target: '_blank', rel: 'noopener noreferrer', textContent: src.title || src.url })])));
    append(el('div', { className: 'card' }, [el('b', { textContent: `From the web · searched “${query}”` }), list]));
    const t = thread();
    t.history.push({ role: 'user', content: question }, { role: 'assistant', content: `${text}\n\n(Answered from a web search for “${query}”.)` });
    t.history = t.history.slice(-12);
    suggestFollowUps(question, text);
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  $('summarize').addEventListener('click', () => summarize());
  $('techFilter').addEventListener('click', async () => {
    const on = $('techFilter').getAttribute('aria-pressed') !== 'true';
    await toTab({ type: 'assistant:sp-techfilter', on }).catch(() => {});
  });
  $('save').addEventListener('click', async () => {
    const pdf = currentPdf();
    const res = pdf ? await savePdf(pdf).catch((err) => ({ ok: false, error: err.message })) : await toTab({ type: 'assistant:sp-save' }).catch((err) => ({ ok: false, error: err.message }));
    if (!res || !res.ok) return append(card({ kind: 'error', title: (res && res.error) || 'Couldn’t save this page.' }));
    const open = { label: 'Open in snippets', onClick: () => ext.runtime.sendMessage({ type: 'open:snippets', id: res.snippet.id }) };
    append(card({ kind: 'ok', title: res.already ? 'Already in your PKG.' : 'Saved to your PKG.', body: res.already ? res.snippet.title : 'Your AI is adding a title, summary and tags.', actions: [open] }));
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
  $('suggestMore').addEventListener('click', async () => {
    $('suggestMore').hidden = true;
    if (currentPdf()) return pdfQuestions(state.tabId);
    $('suggest').replaceChildren(...[0, 1, 2, 3].map(() => el('div', { className: 'ghost' })));
    $('suggestLabel').textContent = 'Reading the page for questions…';
    const snap = await toTab({ type: 'assistant:sp-refresh' }).catch(() => null);
    if (snap) state.snap = snap;
    renderPage();
  });
  $('moreBtn').addEventListener('click', () => ($('menu').hidden = !$('menu').hidden));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#menu, #moreBtn')) $('menu').hidden = true;
  });
  $('menu').addEventListener('click', (e) => {
    const cmd = e.target.closest('[data-cmd]');
    if (!cmd) return;
    $('menu').hidden = true;
    const c = cmd.dataset.cmd;
    if (c === 'owl') {
      // Back to the owl on every page: open the floating panel here and close the side panel.
      ext.runtime.sendMessage({ type: 'appearance:set', mode: 'owl' }).then(() => toTab({ type: 'assistant:sp-open' })).catch(() => {}).finally(() => window.close());
    } else if (c === 'page') toTab({ type: 'assistant:sp-open' }).catch(() => {});
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
    if (area === 'session' && changes.pdfRequest && changes.pdfRequest.newValue) takePdfRequest(changes.pdfRequest.newValue);
  });

  (async () => {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    state.windowId = tab ? tab.windowId : null;
    if (tab) await load(tab.id);
    await connectAI();
    // Opened from "Summarize this PDF with soroagent"?
    const { pdfRequest } = ext.storage.session ? await ext.storage.session.get('pdfRequest').catch(() => ({})) : {};
    if (pdfRequest) takePdfRequest(pdfRequest);
  })();
})();

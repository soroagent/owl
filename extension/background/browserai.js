// AI that runs inside the browser: no server, no key, nothing leaves the computer.
//
// - "nano": Chrome's built-in Gemini Nano (the Prompt API, `LanguageModel`). Chrome downloads and
//   manages the model; the first download must be started by a click on an extension page.
// - "webllm": Qwen2.5-1.5B on WebGPU with WebLLM (vendor/web-llm, shipped with the extension: the
//   engine and its compiled model library are code, so they can't be fetched). The weights (about
//   880 MB) download once from Hugging Face and stay in the browser's cache. WebLLM is an ES module,
//   which Chrome's service worker can't import, so in Chrome it runs in the offscreen document and
//   the worker talks to it over a port; Firefox's background page runs it directly.
//
// The prompt conversion is pure and unit tested.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});
  const WEBLLM_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
  const WEBLLM_WEIGHTS = 'https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
  const WEBLLM_LIB = 'vendor/web-llm/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm';
  const PORT = 'webllm';

  const browserError = (code, message, hint) =>
    soroagent.LLMError ? new soroagent.LLMError(code, message, hint) : Object.assign(new Error(message), { code, hint });

  /**
   * Pure: chat messages as the Prompt API wants them: one system prompt and the earlier turns as
   * the session's initial prompts, and the last user message as the prompt.
   */
  function toPromptApi(messages) {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const turns = messages.filter((m) => m.role !== 'system');
    const last = turns.length && turns[turns.length - 1].role === 'user' ? turns.pop() : { role: 'user', content: '' };
    return {
      initialPrompts: [...(system ? [{ role: 'system', content: system }] : []), ...turns.map((m) => ({ role: m.role, content: String(m.content) }))],
      prompt: String(last.content),
    };
  }

  // ---------------------------------------------------------------------------
  // Gemini Nano (Prompt API)
  // ---------------------------------------------------------------------------

  const LANGUAGES = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
  const hasNano = () => typeof root.LanguageModel !== 'undefined';

  /** 'available' | 'downloadable' | 'downloading' | 'unavailable' */
  async function nanoAvailability() {
    if (!hasNano()) return 'unavailable';
    try {
      return await root.LanguageModel.availability(LANGUAGES);
    } catch {
      try {
        return await root.LanguageModel.availability();
      } catch {
        return 'unavailable';
      }
    }
  }

  /** Starts Chrome's download of Gemini Nano (needs a click on an extension page). onProgress(0..1). */
  async function downloadNano(onProgress = () => {}) {
    if (!hasNano()) throw browserError('browser_unavailable', "This browser doesn't have a built-in AI.");
    const session = await root.LanguageModel.create({
      ...LANGUAGES,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => onProgress(e.loaded));
      },
    });
    session.destroy();
    return true;
  }

  async function nanoChat({ messages, signal, onToken }) {
    const state = await nanoAvailability();
    if (state !== 'available') {
      throw browserError('browser_not_ready', state === 'unavailable' ? "Chrome's built-in AI isn't available on this computer." : "Chrome's built-in AI hasn't finished downloading.", 'Open soroagent settings → AI to finish setting it up, or choose another AI.');
    }
    const { initialPrompts, prompt } = toPromptApi(messages);
    const session = await root.LanguageModel.create({ ...LANGUAGES, initialPrompts, signal });
    try {
      let input = prompt;
      // Gemini Nano has a small context: shorten the page text rather than fail.
      if (session.measureInputUsage && session.inputQuota) {
        for (let i = 0; i < 4 && (await session.measureInputUsage(input)) > session.inputQuota - (session.inputUsage || 0) - 64; i++) {
          input = input.slice(0, Math.floor(input.length * 0.7));
        }
      }
      let text = '';
      for await (const chunk of session.promptStreaming(input, { signal })) {
        text += chunk;
        if (onToken) onToken(chunk);
      }
      return text;
    } finally {
      session.destroy();
    }
  }

  // ---------------------------------------------------------------------------
  // WebLLM (WebGPU): the engine host runs where ES modules and WebGPU are available
  // ---------------------------------------------------------------------------

  async function hasWebGPU() {
    try {
      return Boolean(root.navigator && root.navigator.gpu && (await root.navigator.gpu.requestAdapter()));
    } catch {
      return false;
    }
  }

  /** The engine itself: in Chrome's offscreen document, or in Firefox's background page. */
  function createWebLLMHost(ext) {
    let module = null;
    let engine = null;
    let queue = Promise.resolve();
    const state = { phase: 'idle', progress: 0, text: '' }; // idle | loading | ready | error
    const listeners = new Set();
    const emit = () => listeners.forEach((fn) => fn({ ...state }));

    const appConfig = () => ({
      model_list: [{ model: WEBLLM_WEIGHTS, model_id: WEBLLM_MODEL, model_lib: ext.runtime.getURL(WEBLLM_LIB), overrides: { context_window_size: 4096 } }],
    });
    const load = async () => (module ||= await import(ext.runtime.getURL('vendor/web-llm/index.js')));

    function start() {
      if (engine) return engine;
      Object.assign(state, { phase: 'loading', progress: 0, text: 'Starting…' });
      emit();
      engine = (async () => {
        if (!(await hasWebGPU())) throw browserError('browser_unavailable', "This browser can't run AI models itself (no WebGPU).", 'Use a local model server or a cloud AI instead.');
        const webllm = await load();
        return webllm.CreateMLCEngine(WEBLLM_MODEL, {
          appConfig: appConfig(),
          initProgressCallback: (r) => {
            Object.assign(state, { phase: 'loading', progress: r.progress || 0, text: r.text || '' });
            emit();
          },
        });
      })().then(
        (e) => {
          Object.assign(state, { phase: 'ready', progress: 1, text: '' });
          emit();
          return e;
        },
        (err) => {
          engine = null;
          Object.assign(state, { phase: 'error', text: err.message || String(err) });
          emit();
          throw err;
        }
      );
      return engine;
    }

    // One reply at a time: the GPU runs one generation.
    function chat({ messages, json, quick, signal, onToken }) {
      const run = queue.then(async () => {
        const e = await start();
        if (signal && signal.aborted) throw Object.assign(new Error('Stopped.'), { name: 'AbortError' });
        const stop = () => e.interruptGenerate();
        if (signal) signal.addEventListener('abort', stop, { once: true });
        try {
          const chunks = await e.chat.completions.create({
            messages,
            stream: true,
            temperature: 0.3,
            max_tokens: quick ? 300 : 900,
            ...(json ? { response_format: { type: 'json_object' } } : {}),
          });
          let text = '';
          for await (const c of chunks) {
            const delta = (c.choices && c.choices[0] && c.choices[0].delta && c.choices[0].delta.content) || '';
            if (!delta) continue;
            text += delta;
            if (onToken) onToken(delta);
          }
          if (signal && signal.aborted) throw Object.assign(new Error('Stopped.'), { name: 'AbortError' });
          return text;
        } finally {
          if (signal) signal.removeEventListener('abort', stop);
        }
      });
      queue = run.catch(() => {});
      return run;
    }

    // Requests from Chrome's worker (or an extension page) arrive on a port.
    function listen() {
      ext.runtime.onConnect.addListener((port) => {
        if (port.name !== PORT) return;
        const controller = new AbortController();
        const watch = (s) => port.postMessage({ type: 'state', state: s });
        port.onDisconnect.addListener(() => {
          controller.abort();
          listeners.delete(watch);
        });
        port.onMessage.addListener(async (msg) => {
          try {
            if (msg.type === 'status') port.postMessage({ type: 'status', state: { ...state }, webgpu: await hasWebGPU() });
            else if (msg.type === 'load') {
              listeners.add(watch);
              watch({ ...state });
              await start();
              port.postMessage({ type: 'done', text: '' });
            } else if (msg.type === 'chat') {
              const text = await chat({ ...msg, signal: controller.signal, onToken: (t) => port.postMessage({ type: 'token', text: t }) });
              port.postMessage({ type: 'done', text });
            }
          } catch (err) {
            port.postMessage({ type: 'error', name: err.name, code: err.code || 'browser_error', error: err.message || String(err), hint: err.hint || '' });
          }
        });
      });
    }

    return { chat, start, state: () => ({ ...state }), listen, onState: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
  }

  /** A client for the WebLLM host over a port (Chrome's worker → offscreen document; pages → host). */
  function webllmClient(ext, ensureHost = async () => {}) {
    async function call(msg, { signal, onToken, onState } = {}) {
      await ensureHost();
      return new Promise((resolve, reject) => {
        const port = ext.runtime.connect({ name: PORT });
        let settled = false;
        const finish = (fn, v) => {
          if (settled) return;
          settled = true;
          try {
            port.disconnect();
          } catch {
            // closed
          }
          fn(v);
        };
        port.onMessage.addListener((m) => {
          if (m.type === 'token' && onToken) onToken(m.text);
          else if (m.type === 'state' && onState) onState(m.state);
          else if (m.type === 'status') finish(resolve, m);
          else if (m.type === 'done') finish(resolve, m.text);
          else if (m.type === 'error') finish(reject, m.name === 'AbortError' ? Object.assign(new Error('Stopped.'), { name: 'AbortError' }) : browserError(m.code, m.error, m.hint));
        });
        port.onDisconnect.addListener(() => finish(reject, browserError('browser_error', 'The in-browser AI stopped.', 'Try again.')));
        if (signal) signal.addEventListener('abort', () => finish(reject, Object.assign(new Error('Stopped.'), { name: 'AbortError' })), { once: true });
        port.postMessage(msg);
      });
    }
    return {
      status: () => call({ type: 'status' }),
      load: (onState) => call({ type: 'load' }, { onState }),
      chat: ({ messages, json, quick, signal, onToken }) => call({ type: 'chat', messages, json, quick }, { signal, onToken }),
    };
  }

  /**
   * The background's entry point. In Chrome, WebLLM requests go to the offscreen document (created
   * on demand); in Firefox, to the host in this same background page.
   */
  function createBrowserAI({ ext }) {
    const local = ext.offscreen ? null : createWebLLMHost(ext);
    if (local) local.listen(); // Firefox: extension pages reach the host over the port too
    const ensureOffscreen = async () => {
      if (!ext.offscreen || (await ext.offscreen.hasDocument())) return;
      await ext.offscreen.createDocument({ url: 'pages/offscreen.html', reasons: ['BLOBS', 'WORKERS'], justification: 'Save backup files, and run the optional in-browser AI model.' });
    };
    const remote = ext.offscreen ? webllmClient(ext, ensureOffscreen) : null;

    // Whether the weights are in the browser's cache, remembered once a load finished (Chrome's
    // offscreen document can't use extension storage, so this side records it).
    const markReady = () => ext.storage.local.set({ browserAI: { webllmReady: true } }).catch(() => {});

    async function status(engine) {
      if (engine === 'nano') {
        const availability = await nanoAvailability();
        return { engine, ready: availability === 'available', availability };
      }
      const webgpu = await hasWebGPU();
      const { browserAI = {} } = await ext.storage.local.get('browserAI');
      return { engine, ready: webgpu && Boolean(browserAI.webllmReady), webgpu };
    }

    async function chat({ connection, messages, json, quick, signal, onToken }) {
      if (connection.engine === 'nano') return nanoChat({ messages, signal, onToken });
      const text = await (local || remote).chat({ messages, json, quick, signal, onToken });
      markReady();
      return text;
    }

    return { status, chat, ensureOffscreen, markReady };
  }

  Object.assign(soroagent, {
    toPromptApi,
    nanoAvailability,
    downloadNano,
    hasWebGPU,
    createWebLLMHost,
    webllmClient,
    createBrowserAI,
    WEBLLM_MODEL,
  });
})(globalThis);

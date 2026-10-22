// Model client. Speaks three wire formats:
//   - Ollama's native API (local)
//   - OpenAI chat completions (local servers like LM Studio/llama.cpp/Jan, and hosted APIs:
//     OpenAI, Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI, custom)
//   - Anthropic's Messages API (Claude)
// Works on a "connection" from soroagent.resolveConnection. No browser APIs, so it runs under Node tests.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  class LLMError extends Error {
    constructor(code, message, hint, status) {
      super(message);
      this.name = 'LLMError';
      this.code = code;
      this.hint = hint || '';
      this.status = status || 0;
    }
  }

  const ORIGINS_HINT =
    'The server rejected the browser extension. Allow extension origins and restart it.\n' +
    'macOS: launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*" then quit and reopen Ollama.\n' +
    'Windows: setx OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*" then quit Ollama from the tray and start it again.';

  const ANTHROPIC_VERSION = '2023-06-01';

  function normalizeBaseUrl(raw) {
    let value = String(raw || '').trim() || 'http://127.0.0.1:11434';
    if (!/^https?:\/\//i.test(value)) value = 'http://' + value;
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new LLMError('bad_url', `"${raw}" is not a valid URL.`, 'Use something like http://127.0.0.1:11434');
    }
    let path = url.pathname.replace(/\/+$/, '');
    // People often paste a full endpoint; trim it back to the server root.
    path = path.replace(/\/api(\/(tags|chat|generate|version))?$/i, '');
    path = path.replace(/\/(chat\/completions|completions|models|messages)$/i, '');
    return url.origin + path;
  }

  // Hosted APIs are used exactly as configured; local servers get /v1 added when missing.
  function openaiRoot(conn, baseUrl) {
    return conn.cloud || /\/v1$/i.test(baseUrl) ? baseUrl : baseUrl + '/v1';
  }

  function ollamaRoot(baseUrl) {
    return baseUrl.replace(/\/v1$/i, '');
  }

  function authHeaders(conn) {
    if (conn.api === 'anthropic') {
      return {
        'x-api-key': conn.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        // Requests from an extension carry an Origin header; Anthropic requires this opt-in for them.
        'anthropic-dangerous-direct-browser-access': 'true',
      };
    }
    return conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {};
  }

  function checkConnection(conn) {
    if (!conn.cloud) return;
    if (!conn.baseUrl) {
      throw new LLMError('bad_url', 'No API URL set.', 'Enter the base URL of your OpenAI-compatible API in settings.');
    }
    if (!conn.apiKey) {
      const what = /API$/.test(conn.label) ? `${conn.label} key` : `${conn.label} API key`;
      throw new LLMError('no_key', `Add your ${what} to use it.`, 'Open soroagent settings and paste a key.');
    }
  }

  async function request(fetchImpl, url, init, conn, baseUrl) {
    let res;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new LLMError(
        'unreachable',
        `Can't reach ${conn.cloud ? conn.label : baseUrl}.`,
        conn.cloud
          ? 'Check your internet connection and the API URL in settings.'
          : 'Make sure your local model server is running (for Ollama: open the app or run "ollama serve") and the URL in settings is right.'
      );
    }
    if (res.ok) return res;

    let detail = '';
    try {
      const body = await res.text();
      try {
        const json = JSON.parse(body);
        const err = Array.isArray(json) ? json[0] && json[0].error : json.error; // Gemini wraps errors in an array
        detail = (err && (err.message || err)) || json.message || body;
      } catch {
        detail = body;
      }
    } catch {
      // ignore unreadable bodies
    }
    detail = String(detail || res.statusText || '').slice(0, 300);
    const status = res.status;

    if (status === 401 || (conn.cloud && status === 403)) {
      throw new LLMError(
        'unauthorized',
        conn.cloud ? `${conn.label} rejected the API key.` : 'The server needs an API key.',
        conn.cloud ? 'Check the key in soroagent settings, and that it has access to this model.' : 'Add the key in soroagent settings.',
        status
      );
    }
    if (status === 403) throw new LLMError('forbidden', `${baseUrl} returned 403 Forbidden.`, ORIGINS_HINT, status);
    if (status === 429) {
      throw new LLMError(
        'rate_limited',
        `${conn.cloud ? conn.label : 'The server'} is rate limiting requests${detail ? `: ${detail}` : '.'}`,
        conn.cloud ? 'Wait a moment and try again, or check the usage limits and billing on your account.' : '',
        status
      );
    }
    if (status === 404 && /model/i.test(detail)) {
      throw new LLMError(
        'model_missing',
        detail,
        conn.cloud ? 'Pick another model in settings.' : 'Pick another model, or pull it first (for example "ollama pull llama3.2").',
        status
      );
    }
    throw new LLMError('http', `Server error ${status}${detail ? `: ${detail}` : ''}`, '', status);
  }

  function isChatModel(model, catalog) {
    const caps = model.capabilities;
    if (Array.isArray(caps) && caps.length) return caps.includes('completion');
    if (/embed/i.test(model.id)) return false;
    if (!catalog) return true;
    if (catalog.include && !catalog.include.test(model.id)) return false;
    return !soroagent.NON_CHAT.test(model.id);
  }

  // The model to use when none is chosen: the first catalog preference that matches, else the first.
  function suggestModel(models, catalog) {
    const ids = models.map((m) => m.id);
    for (const pattern of (catalog && catalog.prefer) || []) {
      const hit = ids.find((id) => pattern.test(id));
      if (hit) return hit;
    }
    return ids[0] || '';
  }

  async function listOllamaModels(conn, baseUrl, fetchImpl) {
    const res = await request(fetchImpl, `${ollamaRoot(baseUrl)}/api/tags`, { headers: authHeaders(conn) }, conn, baseUrl);
    const json = await res.json();
    if (!json || !Array.isArray(json.models)) throw new LLMError('not_ollama', 'Not an Ollama server.');
    return json.models.map((m) => ({
      id: m.name || m.model,
      size: (m.details && m.details.parameter_size) || '',
      capabilities: m.capabilities || [],
    }));
  }

  async function listOpenAIModels(conn, baseUrl, fetchImpl) {
    const res = await request(fetchImpl, `${openaiRoot(conn, baseUrl)}/models`, { headers: authHeaders(conn) }, conn, baseUrl);
    const json = await res.json();
    if (!json || !Array.isArray(json.data)) throw new LLMError('not_openai', 'Not an OpenAI-compatible server.');
    // Gemini lists ids as "models/gemini-…"; its chat endpoint takes the bare name.
    return json.data.map((m) => ({ id: String(m.id).replace(/^models\//, ''), size: '', capabilities: [] }));
  }

  async function listAnthropicModels(conn, baseUrl, fetchImpl) {
    const res = await request(fetchImpl, `${baseUrl}/models?limit=100`, { headers: authHeaders(conn) }, conn, baseUrl);
    const json = await res.json();
    if (!json || !Array.isArray(json.data)) throw new LLMError('http', 'Unexpected response from the Anthropic API.');
    return json.data.map((m) => ({ id: m.id, size: '', name: m.display_name || m.id, capabilities: [] }));
  }

  /**
   * Lists chat models. Resolves with { api, baseUrl, models, suggested }.
   * For a local connection with api "auto", tries Ollama first, then the OpenAI dialect.
   */
  async function listModels(conn, fetchImpl = root.fetch.bind(root)) {
    if (conn.api === 'browser') {
      // In-browser AI: one model, usable once it's downloaded.
      const ai = soroagent.browserAI;
      const st = ai ? await ai.status(conn.engine) : { ready: false };
      if (!st.ready) {
        throw new LLMError('browser_not_ready', conn.engine === 'nano' ? "Chrome's built-in AI isn't ready on this computer yet." : "The in-browser AI hasn't been downloaded yet.", 'Open soroagent settings → AI to set it up, or choose another AI.');
      }
      return { api: 'browser', baseUrl: '', models: [{ id: conn.model, size: '', capabilities: [] }], suggested: conn.model };
    }
    checkConnection(conn);
    const baseUrl = normalizeBaseUrl(conn.baseUrl);
    const order =
      conn.api === 'anthropic' ? ['anthropic']
      : conn.api === 'ollama' ? ['ollama']
      : conn.api === 'openai' ? ['openai']
      : /\/v1$/i.test(baseUrl) ? ['openai', 'ollama']
      : ['ollama', 'openai'];
    const listers = { ollama: listOllamaModels, openai: listOpenAIModels, anthropic: listAnthropicModels };

    let firstError;
    for (const api of order) {
      try {
        const models = (await listers[api](conn, baseUrl, fetchImpl))
          .filter((m) => isChatModel(m, conn.catalog))
          .sort((a, b) => (conn.cloud ? a.id.localeCompare(b.id) : 0));
        return { api, baseUrl, models, suggested: suggestModel(models, conn.catalog) };
      } catch (err) {
        // A transport-level failure won't be fixed by trying the other API shape.
        if (err && (err.name === 'AbortError' || ['unreachable', 'forbidden', 'unauthorized', 'rate_limited'].includes(err.code))) throw err;
        firstError = firstError || err;
      }
    }
    throw firstError || new LLMError('unknown', 'No compatible model server found.');
  }

  // Splits a byte stream into lines, calling onLine for each complete one.
  async function readLines(body, onLine) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line && onLine(line) === false) return;
        }
      }
      const rest = (buffer + decoder.decode()).trim();
      if (rest) onLine(rest);
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  function parseOllamaLine(line) {
    const obj = JSON.parse(line);
    if (obj.error) throw new LLMError('http', String(obj.error));
    return {
      content: (obj.message && obj.message.content) || '',
      thinking: (obj.message && obj.message.thinking) || '',
      done: Boolean(obj.done),
    };
  }

  function parseOpenAILine(line) {
    if (!line.startsWith('data:')) return null;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return { content: '', thinking: '', done: true };
    const obj = JSON.parse(data);
    if (obj.error) throw new LLMError('http', String(obj.error.message || obj.error));
    const delta = (obj.choices && obj.choices[0] && obj.choices[0].delta) || {};
    return {
      content: delta.content || '',
      thinking: delta.reasoning_content || delta.reasoning || '',
      done: false,
    };
  }

  // Anthropic server-sent events: we only need the "data:" lines; each carries its own type.
  function parseAnthropicLine(line) {
    if (!line.startsWith('data:')) return null;
    const obj = JSON.parse(line.slice(5).trim());
    switch (obj.type) {
      case 'content_block_delta': {
        const d = obj.delta || {};
        if (d.type === 'text_delta') return { content: d.text || '', thinking: '', done: false };
        if (d.type === 'thinking_delta') return { content: '', thinking: d.thinking || ' ', done: false };
        return null;
      }
      case 'content_block_start':
        return obj.content_block && obj.content_block.type === 'thinking' ? { content: '', thinking: ' ', done: false } : null;
      case 'message_delta':
        return obj.delta && obj.delta.stop_reason === 'refusal' ? { content: '', thinking: '', done: false, refusal: true } : null;
      case 'message_stop':
        return { content: '', thinking: '', done: true };
      case 'error':
        throw new LLMError('http', String((obj.error && obj.error.message) || 'The Anthropic API returned an error.'));
      default:
        return null;
    }
  }

  // Current Claude generations: support the effort control, larger outputs and server-side fallbacks.
  const CLAUDE_EFFORT = /^claude-(opus|sonnet|haiku|fable|mythos)-[5-9]|^claude-opus-4-[5-8]|^claude-sonnet-4-6/;
  const CLAUDE_FALLBACKS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

  function anthropicBody(conn, messages, quick = false) {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const modern = CLAUDE_EFFORT.test(conn.model);
    const body = {
      model: conn.model,
      max_tokens: quick ? 2048 : modern ? 64000 : 8192,
      stream: true,
      messages: messages.filter((m) => m.role !== 'system'),
    };
    if (system) body.system = system;
    // Current Claude models reject sampling parameters, so temperature is not sent.
    // These tasks are quick reads of a page; low effort keeps them fast unless thinking is allowed.
    if (modern && (quick || !conn.allowThinking)) body.output_config = { effort: 'low' };
    const headers = {};
    if (CLAUDE_FALLBACKS.test(conn.model)) {
      // If a safety classifier declines, the API retries on a fallback model in the same call.
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }
    return { body, headers };
  }

  /**
   * Streams a chat completion. Resolves with the full reply text (reasoning removed).
   * opts: { connection, api, messages, json, quick, signal, onToken(text), onThinking() }
   * `quick`: a short answer wanted fast (suggested questions): no extended thinking, a small output.
   * `api` is the resolved wire format for local "auto" connections.
   */
  async function chat(opts, fetchImpl = root.fetch.bind(root)) {
    const { connection: conn, messages, json, quick, signal, onToken, onThinking } = opts;
    if (conn.api === 'browser') {
      if (!soroagent.browserAI) throw new LLMError('browser_unavailable', 'The in-browser AI is not available here.');
      return soroagent.stripThinking(await soroagent.browserAI.chat({ connection: conn, messages, json, quick, signal, onToken }));
    }
    checkConnection(conn);
    const baseUrl = normalizeBaseUrl(conn.baseUrl);
    const api = opts.api || (conn.api === 'auto' ? 'ollama' : conn.api);
    if (!conn.model) throw new LLMError('no_model', 'No model selected.', 'Pick a model in the assistant or in settings.');

    let url;
    let body;
    let extraHeaders = {};
    let parse;
    if (api === 'ollama') {
      url = `${ollamaRoot(baseUrl)}/api/chat`;
      body = {
        model: conn.model,
        messages,
        stream: true,
        options: { temperature: conn.temperature, num_ctx: conn.contextWindow },
      };
      if (!conn.allowThinking || quick) body.think = false;
      if (quick) body.options.num_predict = 400;
      if (json) body.format = 'json';
      parse = parseOllamaLine;
    } else if (api === 'anthropic') {
      url = `${baseUrl}/messages`;
      ({ body, headers: extraHeaders } = anthropicBody(conn, messages, quick));
      parse = parseAnthropicLine;
    } else {
      url = `${openaiRoot(conn, baseUrl)}/chat/completions`;
      body = { model: conn.model, messages, stream: true, temperature: conn.temperature };
      parse = parseOpenAILine;
    }

    const send = (payload) =>
      request(
        fetchImpl,
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders(conn), ...extraHeaders },
          body: JSON.stringify(payload),
          signal,
        },
        conn,
        baseUrl
      );

    let res;
    try {
      res = await send(body);
    } catch (err) {
      // Reasoning models (OpenAI o-series, GPT-5…) reject a custom temperature: retry with the default.
      if (api === 'openai' && err.status === 400 && /temperature/i.test(err.message) && 'temperature' in body) {
        delete body.temperature;
        res = await send(body);
      } else throw err;
    }

    let text = '';
    let refused = false;
    await readLines(res.body, (line) => {
      let chunk;
      try {
        chunk = parse(line);
      } catch (err) {
        if (err instanceof LLMError) throw err;
        return true; // skip keep-alive comments and malformed lines
      }
      if (!chunk) return true;
      if (chunk.refusal) refused = true;
      if (chunk.thinking && onThinking) onThinking();
      if (chunk.content) {
        text += chunk.content;
        if (onToken) onToken(chunk.content);
      }
      return !chunk.done;
    });
    const reply = soroagent.stripThinking(text);
    if (refused && !reply) throw new LLMError('refused', 'The model declined to answer this request.', 'Try another model or a different page.');
    return reply;
  }

  // ---------------------------------------------------------------------------
  // Embeddings (semantic search over the library)
  // ---------------------------------------------------------------------------

  // Embedding models the hosted APIs offer (Anthropic, Groq and DeepSeek have none).
  const CLOUD_EMBEDDINGS = { openai: 'text-embedding-3-small', gemini: 'text-embedding-004', mistral: 'mistral-embed' };
  const OLLAMA_EMBED_PREFERENCE = [/nomic-embed-text/, /mxbai-embed/, /snowflake-arctic-embed/, /bge-m3/, /all-minilm/, /embed/];

  /** Pure: the best installed Ollama embedding model id, or ''. */
  function pickOllamaEmbedding(models) {
    const ids = models.filter((m) => /embed|minilm|bge-/i.test(m.id) || (m.capabilities || []).includes('embedding')).map((m) => m.id);
    for (const pattern of OLLAMA_EMBED_PREFERENCE) {
      const hit = ids.find((id) => pattern.test(id));
      if (hit) return hit;
    }
    return ids[0] || '';
  }

  /**
   * Where to compute embeddings: a local Ollama embedding model if one is installed (private and
   * free), else the cloud provider's, else null (search then falls back to keywords).
   * Resolves with { kind: 'ollama' | 'openai', baseUrl, model, conn } or null.
   */
  async function embeddingTarget({ local, cloud }, fetchImpl = root.fetch.bind(root)) {
    if (local && local.baseUrl) {
      try {
        const baseUrl = normalizeBaseUrl(local.baseUrl);
        const model = pickOllamaEmbedding(await listOllamaModels(local, baseUrl, fetchImpl));
        if (model) return { kind: 'ollama', baseUrl, model, conn: local };
      } catch {
        // no local Ollama; try the cloud
      }
    }
    if (cloud && cloud.cloud && cloud.apiKey && CLOUD_EMBEDDINGS[cloud.id]) {
      return { kind: 'openai', baseUrl: normalizeBaseUrl(cloud.baseUrl), model: CLOUD_EMBEDDINGS[cloud.id], conn: cloud };
    }
    return null;
  }

  /** Embeds texts with a target from embeddingTarget(). Resolves with one vector per text. */
  async function embed(target, texts, fetchImpl = root.fetch.bind(root)) {
    const { kind, baseUrl, model, conn } = target;
    const init = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(conn) }, body: JSON.stringify(body) });
    if (kind === 'ollama') {
      const res = await request(fetchImpl, `${ollamaRoot(baseUrl)}/api/embed`, init({ model, input: texts }), conn, baseUrl);
      const json = await res.json();
      if (!json || !Array.isArray(json.embeddings)) throw new LLMError('http', 'The embedding model returned no vectors.');
      return json.embeddings;
    }
    const res = await request(fetchImpl, `${openaiRoot(conn, baseUrl)}/embeddings`, init({ model, input: texts }), conn, baseUrl);
    const json = await res.json();
    if (!json || !Array.isArray(json.data)) throw new LLMError('http', 'The embedding API returned no vectors.');
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  Object.assign(soroagent, {
    pickOllamaEmbedding,
    embeddingTarget,
    embed,
    LLMError,
    normalizeBaseUrl,
    listModels,
    suggestModel,
    chat,
    parseOllamaLine,
    parseOpenAILine,
    parseAnthropicLine,
  });
})(globalThis);

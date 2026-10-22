import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, fakeFetch } from './helpers.mjs';

const S = await load('shared/config.js', 'shared/markdown.js', 'background/llm.js');

const local = (over = {}) => S.resolveConnection({ ...S.DEFAULT_SETTINGS, model: 'llama3.2', ...over });
const cloud = (provider, key = 'k', over = {}) =>
  S.resolveConnection({ ...S.DEFAULT_SETTINGS, source: 'cloud', cloudProvider: provider, ...over }, key ? { [provider]: key } : {});

test('normalizeBaseUrl trims pasted endpoints and adds a scheme', () => {
  assert.equal(S.normalizeBaseUrl('http://127.0.0.1:11434/'), 'http://127.0.0.1:11434');
  assert.equal(S.normalizeBaseUrl('127.0.0.1:11434'), 'http://127.0.0.1:11434');
  assert.equal(S.normalizeBaseUrl('http://localhost:11434/api/tags'), 'http://localhost:11434');
  assert.equal(S.normalizeBaseUrl('http://127.0.0.1:1234/v1/chat/completions'), 'http://127.0.0.1:1234/v1');
  assert.equal(S.normalizeBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai'), 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(S.normalizeBaseUrl(''), 'http://127.0.0.1:11434');
  assert.throws(() => S.normalizeBaseUrl('http://exa mple'), /not a valid URL/);
});

test('resolveConnection and modelPatch follow the selected source', () => {
  const settings = { ...S.DEFAULT_SETTINGS, source: 'cloud', cloudProvider: 'openai', cloudModels: { openai: 'gpt-5' } };
  const conn = S.resolveConnection(settings, { openai: 'sk-1', anthropic: 'sk-ant' });
  assert.deepEqual([conn.cloud, conn.api, conn.baseUrl, conn.apiKey, conn.model], [true, 'openai', 'https://api.openai.com/v1', 'sk-1', 'gpt-5']);
  assert.deepEqual(S.modelPatch(settings, 'gpt-5-mini'), { cloudModels: { openai: 'gpt-5-mini' } });
  assert.deepEqual(S.modelPatch({ ...settings, source: 'local' }, 'llama3.2'), { model: 'llama3.2' });
  assert.equal(S.resolveConnection({ ...settings, cloudProvider: 'custom', customBaseUrl: 'https://x.test/v1/' }).baseUrl, 'https://x.test/v1');
});

test('listModels detects Ollama and drops embedding-only models', async () => {
  const { fetch } = fakeFetch({
    'http://127.0.0.1:11434/api/tags': {
      json: {
        models: [
          { name: 'llama3.2:3b', details: { parameter_size: '3.2B' }, capabilities: ['completion', 'tools'] },
          { name: 'nomic-embed-text', capabilities: ['embedding'] },
        ],
      },
    },
  });
  const res = await S.listModels(local(), fetch);
  assert.equal(res.api, 'ollama');
  assert.deepEqual(res.models.map((m) => m.id), ['llama3.2:3b']);
  assert.equal(res.suggested, 'llama3.2:3b');
});

test('listModels falls back to an OpenAI-compatible local server', async () => {
  const { fetch } = fakeFetch({
    'http://127.0.0.1:1234/api/tags': { status: 404, text: 'Unexpected endpoint' },
    'http://127.0.0.1:1234/v1/models': { json: { data: [{ id: 'qwen2.5-7b-instruct' }, { id: 'text-embedding-nomic' }] } },
  });
  const res = await S.listModels(local({ baseUrl: 'http://127.0.0.1:1234' }), fetch);
  assert.equal(res.api, 'openai');
  assert.deepEqual(res.models.map((m) => m.id), ['qwen2.5-7b-instruct']);
});

test('local connection errors carry a helpful hint', async () => {
  const down = fakeFetch({});
  await assert.rejects(S.listModels(local(), down.fetch), (err) => err.code === 'unreachable' && /running/.test(err.hint));
  const forbidden = fakeFetch({ 'http://127.0.0.1:11434/api/tags': { status: 403, text: '' } });
  await assert.rejects(S.listModels(local(), forbidden.fetch), (err) => err.code === 'forbidden' && /OLLAMA_ORIGINS/.test(err.hint));
});

test('chat streams Ollama NDJSON, disables thinking and strips <think> blocks', async () => {
  const { fetch, calls } = fakeFetch({
    'http://127.0.0.1:11434/api/chat': {
      lines: [
        JSON.stringify({ message: { content: '<think>hmm</think>' } }),
        JSON.stringify({ message: { content: 'Hello' } }),
        JSON.stringify({ message: { content: ' world' } }),
        JSON.stringify({ message: { content: '' }, done: true }),
      ],
    },
  });
  const tokens = [];
  const text = await S.chat({ connection: local(), api: 'ollama', messages: [{ role: 'user', content: 'hi' }], json: true, onToken: (t) => tokens.push(t) }, fetch);
  assert.equal(text, 'Hello world');
  assert.equal(tokens.length, 3);
  assert.equal(calls[0].body.think, false);
  assert.equal(calls[0].body.format, 'json');
  assert.equal(calls[0].body.options.num_ctx, 8192);
});

test('chat streams OpenAI-style server-sent events', async () => {
  const chunk = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`;
  const { fetch, calls } = fakeFetch({
    'http://127.0.0.1:1234/v1/chat/completions': { lines: [': keep-alive', chunk('Hi'), '', chunk(' there'), 'data: [DONE]'] },
  });
  const text = await S.chat({ connection: local({ baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'k' }), api: 'openai', messages: [] }, fetch);
  assert.equal(text, 'Hi there');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
});

test('chat reports a missing model', async () => {
  const { fetch } = fakeFetch({ 'http://127.0.0.1:11434/api/chat': { status: 404, json: { error: "model 'nope' not found" } } });
  await assert.rejects(S.chat({ connection: local({ model: 'nope' }), api: 'ollama', messages: [] }, fetch), (err) => err.code === 'model_missing');
});

// ---------------------------------------------------------------------------
// Cloud providers
// ---------------------------------------------------------------------------

test('cloud connections need an API key before any request', async () => {
  const { fetch, calls } = fakeFetch({});
  await assert.rejects(S.listModels(cloud('openai', ''), fetch), (err) => err.code === 'no_key' && /OpenAI/.test(err.message));
  assert.equal(calls.length, 0);
});

test('Anthropic: lists models and suggests the current Opus', async () => {
  const { fetch, calls } = fakeFetch({
    'https://api.anthropic.com/v1/models?limit=100': {
      json: { data: [{ id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }, { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5' }] },
    },
  });
  const res = await S.listModels(cloud('anthropic', 'sk-ant'), fetch);
  assert.equal(res.api, 'anthropic');
  assert.equal(res.suggested, 'claude-opus-5-5');
  const h = calls[0].init.headers;
  assert.equal(h['x-api-key'], 'sk-ant');
  assert.equal(h['anthropic-version'], '2023-06-01');
  assert.equal(h['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(h.Authorization, undefined);
});

test('Anthropic: streams text, moves system prompts to the top level and omits temperature', async () => {
  const ev = (obj) => `data: ${JSON.stringify(obj)}`;
  const { fetch, calls } = fakeFetch({
    'https://api.anthropic.com/v1/messages': {
      lines: [
        'event: message_start', ev({ type: 'message_start', message: {} }),
        ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
        ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } }),
        ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
        ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } }),
        ev({ type: 'ping' }),
        ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: ' Claude' } }),
        ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
        ev({ type: 'message_stop' }),
      ],
    },
  });
  let thinking = 0;
  const conn = cloud('anthropic', 'sk-ant', { cloudModels: { anthropic: 'claude-opus-5-5' } });
  const text = await S.chat({
    connection: conn,
    messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }],
    onThinking: () => thinking++,
  }, fetch);
  assert.equal(text, 'Hello Claude');
  assert.ok(thinking > 0);
  const body = calls[0].body;
  assert.equal(body.system, 'Be brief.');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Hi' }]);
  assert.equal(body.temperature, undefined);
  assert.equal(body.stream, true);
  assert.deepEqual(body.output_config, { effort: 'low' });
  assert.equal(body.fallbacks, 'default');
  assert.equal(calls[0].init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
});

test('Anthropic: older models get no effort/fallbacks, and an empty refusal is an error', async () => {
  const ev = (obj) => `data: ${JSON.stringify(obj)}`;
  const { fetch, calls } = fakeFetch({
    'https://api.anthropic.com/v1/messages': {
      lines: [ev({ type: 'message_delta', delta: { stop_reason: 'refusal' } }), ev({ type: 'message_stop' })],
    },
  });
  const conn = cloud('anthropic', 'sk-ant', { cloudModels: { anthropic: 'claude-3-5-haiku-latest' } });
  await assert.rejects(S.chat({ connection: conn, messages: [{ role: 'user', content: 'x' }] }, fetch), (err) => err.code === 'refused');
  assert.equal(calls[0].body.output_config, undefined);
  assert.equal(calls[0].body.fallbacks, undefined);
  assert.equal(calls[0].body.max_tokens, 8192);
});

test('Gemini: strips the models/ prefix, keeps only chat models and uses the base URL as-is', async () => {
  const base = 'https://generativelanguage.googleapis.com/v1beta/openai';
  const { fetch, calls } = fakeFetch({
    [`${base}/models`]: {
      json: { data: [{ id: 'models/gemini-2.5-flash' }, { id: 'models/gemini-2.5-pro' }, { id: 'models/text-embedding-004' }, { id: 'models/gemini-embedding-001' }, { id: 'models/imagen-4.0' }] },
    },
  });
  const res = await S.listModels(cloud('gemini', 'AIza'), fetch);
  assert.deepEqual(res.models.map((m) => m.id), ['gemini-2.5-flash', 'gemini-2.5-pro']);
  assert.equal(res.suggested, 'gemini-2.5-pro');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer AIza');
});

test('OpenAI: retries without temperature when a reasoning model rejects it', async () => {
  let attempt = 0;
  const { fetch, calls } = fakeFetch({
    'https://api.openai.com/v1/chat/completions': () =>
      ++attempt === 1
        ? { status: 400, json: { error: { message: "Unsupported value: 'temperature' does not support 0.3 with this model." } } }
        : { lines: [`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}`, 'data: [DONE]'] },
  });
  const text = await S.chat({ connection: cloud('openai', 'sk', { cloudModels: { openai: 'gpt-5' } }), messages: [] }, fetch);
  assert.equal(text, 'ok');
  assert.equal(calls[0].body.temperature, 0.3);
  assert.equal('temperature' in calls[1].body, false);
});

test('cloud errors explain bad keys and rate limits', async () => {
  const bad = fakeFetch({ 'https://api.openai.com/v1/models': { status: 401, json: { error: { message: 'Incorrect API key' } } } });
  await assert.rejects(S.listModels(cloud('openai'), bad.fetch), (err) => err.code === 'unauthorized' && /OpenAI rejected the API key/.test(err.message));
  const limited = fakeFetch({ 'https://api.groq.com/openai/v1/models': { status: 429, json: { error: { message: 'slow down' } } } });
  await assert.rejects(S.listModels(cloud('groq'), limited.fetch), (err) => err.code === 'rate_limited' && /billing/.test(err.hint));
  const offline = fakeFetch({});
  await assert.rejects(S.listModels(cloud('mistral'), offline.fetch), (err) => err.code === 'unreachable' && /internet/.test(err.hint));
});

test('quick requests (suggested questions) skip long thinking and keep the reply short', async () => {
  const ollama = fakeFetch({ 'http://127.0.0.1:11434/api/chat': { lines: [JSON.stringify({ message: { content: '{}' }, done: true })] } });
  await S.chat({ connection: { ...local(), allowThinking: true }, api: 'ollama', messages: [{ role: 'user', content: 'q' }], json: true, quick: true }, ollama.fetch);
  assert.equal(ollama.calls[0].body.think, false, 'no thinking even when thinking is allowed');
  assert.equal(ollama.calls[0].body.options.num_predict, 400);

  const ev = (obj) => `data: ${JSON.stringify(obj)}`;
  const claude = fakeFetch({ 'https://api.anthropic.com/v1/messages': { lines: [ev({ type: 'message_stop' })] } });
  const conn = { ...cloud('anthropic', 'sk-ant', { cloudModels: { anthropic: 'claude-opus-5-5' } }), allowThinking: true };
  await S.chat({ connection: conn, messages: [{ role: 'user', content: 'q' }], quick: true }, claude.fetch);
  assert.deepEqual(claude.calls[0].body.output_config, { effort: 'low' });
  assert.equal(claude.calls[0].body.max_tokens, 2048);
});

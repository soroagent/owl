import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/config.js', 'shared/markdown.js', 'background/llm.js', 'background/browserai.js');

test('in-browser AI settings resolve to a "browser" connection with less page text', () => {
  const nano = S.resolveConnection({ ...S.DEFAULT_SETTINGS, source: 'browser', browserEngine: 'nano' });
  assert.equal(nano.api, 'browser');
  assert.equal(nano.engine, 'nano');
  assert.equal(nano.cloud, false);
  assert.equal(nano.label, "Chrome's built-in AI");
  assert.equal(S.resolveConnection({ ...S.DEFAULT_SETTINGS, source: 'browser', browserEngine: 'webllm' }).model, 'Qwen2.5-1.5B');
  assert.equal(S.resolveConnection({ ...S.DEFAULT_SETTINGS, source: 'browser', browserEngine: 'nope' }).engine, 'nano');
  assert.equal(S.pageCharLimit({ ...S.DEFAULT_SETTINGS, source: 'browser' }), 6000);
  assert.equal(S.pageCharLimit({ ...S.DEFAULT_SETTINGS, source: 'local' }), 12000);
  assert.deepEqual(S.modelPatch({ source: 'browser' }, 'x'), {});
});

test('chat messages become Prompt API initial prompts plus the last user prompt', () => {
  const out = S.toPromptApi([
    { role: 'system', content: 'Be brief.' },
    { role: 'system', content: 'Use Markdown.' },
    { role: 'user', content: 'What is this page?' },
    { role: 'assistant', content: 'A kettle.' },
    { role: 'user', content: 'How much is it?' },
  ]);
  assert.deepEqual(out.initialPrompts, [
    { role: 'system', content: 'Be brief.\n\nUse Markdown.' },
    { role: 'user', content: 'What is this page?' },
    { role: 'assistant', content: 'A kettle.' },
  ]);
  assert.equal(out.prompt, 'How much is it?');
  assert.deepEqual(S.toPromptApi([{ role: 'user', content: 'Hi' }]), { initialPrompts: [], prompt: 'Hi' });
});

test('browser connections go to the in-browser AI, and say clearly when it is not set up', async () => {
  const conn = S.resolveConnection({ ...S.DEFAULT_SETTINGS, source: 'browser', browserEngine: 'webllm' });
  const calls = [];
  S.browserAI = {
    status: async () => ({ ready: false }),
    chat: async (opts) => (calls.push(opts), opts.onToken('Hel'), opts.onToken('lo'), '<think>x</think>Hello'),
  };
  await assert.rejects(S.listModels(conn, () => assert.fail('no network')), (err) => err.code === 'browser_not_ready' && /settings/.test(err.hint));
  S.browserAI.status = async () => ({ ready: true });
  assert.deepEqual((await S.listModels(conn)).models.map((m) => m.id), ['Qwen2.5-1.5B']);
  const tokens = [];
  const text = await S.chat({ connection: conn, messages: [{ role: 'user', content: 'q' }], json: true, quick: true, onToken: (t) => tokens.push(t) }, () => assert.fail('no network'));
  assert.equal(text, 'Hello');
  assert.deepEqual(tokens, ['Hel', 'lo']);
  assert.equal(calls[0].json, true);
  assert.equal(calls[0].quick, true);
  delete S.browserAI;
});

test('the Ollama fix allows browser extensions only, with the right command per OS', () => {
  const mac = S.ollamaOriginsFix('MacIntel');
  assert.equal(mac.os, 'macOS');
  assert.equal(mac.command, 'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"');
  assert.match(mac.then, /quit Ollama/i);
  assert.equal(S.ollamaOriginsFix('Win32').command, 'setx OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"');
  assert.match(S.ollamaOriginsFix('Linux x86_64').command, /systemctl restart ollama/);
  for (const p of ['MacIntel', 'Win32', 'Linux x86_64']) assert.doesNotMatch(S.ollamaOriginsFix(p).command, /ORIGINS="?\*"?(\s|$)/, 'never "*" (every website)');
});

test('sync is offered at 5 saved items, never while on, and backs off after "Not now"', () => {
  assert.equal(S.syncOfferDue({ count: 4, syncOn: false }), false);
  assert.equal(S.syncOfferDue({ count: 5, syncOn: false }), true);
  assert.equal(S.syncOfferDue({ count: 50, syncOn: true }), false);
  assert.equal(S.syncOfferDue({ count: 12, syncOn: false, offer: { snoozedAt: 5, times: 1 } }), false);
  assert.equal(S.syncOfferDue({ count: 20, syncOn: false, offer: { snoozedAt: 5, times: 1 } }), true);
  assert.equal(S.syncOfferDue({ count: 99, syncOn: false, offer: { snoozedAt: 20, times: 2 } }), false, 'two "Not now"s: stop asking');
});

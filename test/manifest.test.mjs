import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { root } from './helpers.mjs';
import { expandScripts } from '../scripts/manifest-utils.mjs';

const ext = join(root, 'extension');
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));

test('every file the manifest references exists', () => {
  const files = [
    manifest.background.service_worker,
    ...manifest.background.scripts,
    ...manifest.content_scripts.flatMap((c) => expandScripts(c.js, ext)),
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons).map((p) => p.replace('icons/', 'icons/dark/')),
  ];
  for (const file of files) assert.ok(existsSync(join(ext, file)), `missing ${file}`);
});

test('the Chrome service worker loads the same scripts as Firefox, in order', () => {
  const sw = readFileSync(join(ext, manifest.background.service_worker), 'utf8');
  const imported = [...sw.matchAll(/'([^']+\.js)'/g)].map((m) => join('background', m[1]));
  assert.deepEqual(imported.map((p) => join(ext, p)), manifest.background.scripts.map((p) => join(ext, p)));
});

test('pages only load scripts that exist', () => {
  for (const page of ['options', 'snippets', 'history', 'onboard']) {
    const html = readFileSync(join(ext, 'pages', `${page}.html`), 'utf8');
    for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
      assert.ok(existsSync(join(ext, 'pages', src)), `${page}.html -> ${src}`);
    }
  }
});

test('content scripts load the site registry before the site profiles and the assistant last', () => {
  const main = manifest.content_scripts.find((script) => script.js.includes('content/assistant.js'));
  const js = expandScripts(main.js, ext);
  const registry = js.indexOf('sites/registry.js');
  const x = js.indexOf('sites/x.js');
  assert.ok(registry >= 0 && x > registry, 'registry before profiles');
  assert.ok(js.indexOf('shared/prompts.js') < js.indexOf('prompts/default.js'), 'prompt engine before prompt files');
  assert.ok(js.includes('prompts/x.js'), 'site prompt files are loaded');
  assert.ok(!js.some((f) => f.includes('_template')), 'templates are not loaded');
  assert.equal(js.at(-1), 'content/assistant.js');
});

test('pages that build prompts load every prompt file', () => {
  const files = readdirSync(join(ext, 'prompts')).filter((f) => f.endsWith('.js') && !f.startsWith('_'));
  for (const page of ['options', 'snippets']) {
    const html = readFileSync(join(ext, 'pages', `${page}.html`), 'utf8');
    for (const file of files) assert.ok(html.includes(`../prompts/${file}`), `${page}.html loads prompts/${file}`);
  }
});

test('the shared settings script loads cleanly on an extension page', async () => {
  // Regression: a const used before its definition broke every soroagent page.
  const { runInNewContext } = await import('node:vm');
  const links = [{ href: '' }];
  const fakeChrome = { runtime: { getManifest: () => ({ version: '9.9.9' }), sendMessage: () => Promise.resolve() }, storage: { local: {} } };
  const context = {
    chrome: fakeChrome,
    navigator: { userAgent: 'Chrome' },
    location: { protocol: 'chrome-extension:', pathname: '/pages/stats.html' },
    document: { querySelectorAll: () => links },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    URLSearchParams,
  };
  context.globalThis = context;
  runInNewContext(readFileSync(join(ext, 'shared/config.js'), 'utf8'), context);
  assert.ok(context.soroagent && context.soroagent.ext, 'config.js finished and exported ext');
  assert.match(links[0].href, /^https:\/\/soroagent\.com\/feedback\?v=9\.9\.9&browser=chrome&from=stats$/);
});

test('only http(s) links are made clickable', async () => {
  const { runInNewContext } = await import('node:vm');
  const context = { chrome: { runtime: {}, storage: {} } };
  context.globalThis = context;
  runInNewContext(readFileSync(join(ext, 'shared/config.js'), 'utf8'), context);
  const { safeUrl } = context.soroagent;
  assert.equal(safeUrl('https://a.com/x'), 'https://a.com/x');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x', '', undefined]) assert.equal(safeUrl(bad), '#');
});

test('Google Drive sync can sign in (identity), and its redirect matches the pinned Chrome ID', () => {
  assert.ok(manifest.permissions.includes('identity'));
  const key = readFileSync(join(root, 'keys/chrome-public-key.txt'), 'utf8').trim();
  const hash = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  const id = [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  // Registered in Google Cloud as an authorized redirect URI; changing the key breaks sign-in.
  assert.equal(id, 'jomghmmgdlajfonjihmagbhomimadpcg');
  assert.equal(createHash('sha1').update(manifest.browser_specific_settings.gecko.id).digest('hex'), '2cc4144500e90330e1a3d0c39bbd9cc2e7ce6aeb');
});

test('the in-browser AI ships its engine (no remote code) and may run WebAssembly', () => {
  assert.match(manifest.content_security_policy.extension_pages, /'wasm-unsafe-eval'/);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /https?:|'unsafe-eval'/, 'no remote or eval scripts');
  for (const f of ['vendor/web-llm/index.js', 'vendor/web-llm/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm', 'vendor/web-llm/LICENSE']) assert.ok(existsSync(join(ext, f)), f);
  const engine = readFileSync(join(ext, 'background/browserai.js'), 'utf8');
  assert.ok(engine.includes("'vendor/web-llm/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm'"), 'the model library comes from the extension');
  const offscreen = readFileSync(join(ext, 'pages/offscreen.html'), 'utf8');
  assert.match(offscreen, /browserai\.js/);
});

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
  for (const page of ['options', 'snippets', 'onboard', 'sidepanel', 'offscreen']) {
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

test('Alt+Shift+O opens soroagent (floating panel or side panel); browser shortcuts stay free', () => {
  assert.equal(manifest.commands['open-soroagent'].suggested_key.default, 'Alt+Shift+O');
  assert.equal(manifest.commands['open-soroagent'].suggested_key.mac, 'Alt+Shift+O');
  const keys = Object.values(manifest.commands).flatMap((c) => Object.values(c.suggested_key || {}));
  // Taken by the browsers: Firefox's Library (Ctrl/Cmd+Shift+O), Chrome's bookmark manager on Windows,
  // screenshots in Firefox and Edge (Ctrl/Cmd+Shift+S), Firefox's History menu (Alt+S).
  for (const taken of ['Ctrl+Shift+O', 'Command+Shift+O', 'Ctrl+Shift+S', 'Command+Shift+S', 'Alt+S']) assert.ok(!keys.includes(taken), taken);
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.equal(manifest.side_panel.default_path, 'pages/sidepanel.html');
  assert.ok(existsSync(join(ext, manifest.side_panel.default_path)));
});

test('fallback parser, PDF reader: vendored, loaded where they run, nothing fetched as code', () => {
  for (const f of ['vendor/readability/Readability.js', 'vendor/readability/LICENSE.md', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/pdfjs/LICENSE']) assert.ok(existsSync(join(ext, f)), f);
  const js = manifest.content_scripts[0].js;
  assert.ok(js.indexOf('vendor/readability/Readability.js') >= 0 && js.indexOf('vendor/readability/Readability.js') < js.indexOf('content/extract.js'), 'Readability loads before the extractor');
  const reader = readFileSync(join(ext, 'background/pdfread.js'), 'utf8');
  assert.match(reader, /import\('\.\.\/vendor\/pdfjs\/pdf\.min\.mjs'\)/, 'a literal, packaged path');
  assert.match(reader, /isEvalSupported: false/);
  assert.match(readFileSync(join(ext, 'pages/offscreen.html'), 'utf8'), /pdfread\.js/);
  assert.ok(manifest.background.scripts.includes('background/pdfread.js'));
});

test('vendored libraries are byte-identical to their pinned official releases', async () => {
  const { check, SHA256 } = await import('../scripts/vendor.mjs');
  assert.deepEqual(check(), []);
  for (const [file, hash] of Object.entries(SHA256)) assert.match(hash, /^[0-9a-f]{64}$/, `${file} has a pinned hash`);
});

test('store builds: third-party licenses ship; the Firefox build has no WebLLM (too large for AMO to parse)', async () => {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { stdio: 'ignore' });
  for (const b of ['chrome', 'firefox']) {
    for (const lic of ['vendor/readability/LICENSE.md', 'vendor/pdfjs/LICENSE']) assert.ok(existsSync(join(root, 'dist', b, lic)), `${b}: ${lic}`);
  }
  assert.ok(existsSync(join(root, 'dist/chrome/vendor/web-llm/index.js')));
  assert.ok(existsSync(join(root, 'dist/chrome/vendor/web-llm/LICENSE')));
  assert.ok(!existsSync(join(root, 'dist/firefox/vendor/web-llm')), 'no WebLLM in Firefox');
  const ff = JSON.parse(readFileSync(join(root, 'dist/firefox/manifest.json'), 'utf8'));
  assert.equal(ff.browser_specific_settings.gecko.strict_min_version, '140.0');
  assert.ok(!ff.permissions.includes('activeTab'));
  assert.ok(ff.description.length <= 132, 'Chrome Web Store limit');
  const chrome = JSON.parse(readFileSync(join(root, 'dist/chrome/manifest.json'), 'utf8'));
  assert.equal(chrome.browser_specific_settings, undefined);
  assert.ok(chrome.description.length <= 132);
});

test('the extension pages share one header: logo with the version, and two tabs with icons', async () => {
  const { readFileSync } = await import('node:fs');
  const headers = ['snippets', 'options'].map((page) => {
    const html = readFileSync(new URL(`../extension/pages/${page}.html`, import.meta.url), 'utf8');
    const m = html.match(/<header class="app-header">[\s\S]*?<\/header>/);
    assert.ok(m, `${page}.html has the shared header`);
    assert.match(m[0], new RegExp(`<a href="${page}.html" aria-current="page">`), `${page} is the current tab`);
    return m[0].replace(/ aria-current="page"/, '');
  });
  assert.equal(new Set(headers).size, 1, 'identical apart from the current tab');
  const tabs = [...headers[0].matchAll(/<a href="[^"]+">(<svg class="icon"[^]*?<\/svg>)([^<]+)<\/a>/g)];
  assert.deepEqual(tabs.map((m) => m[2]), ['Snippets', 'Settings'], 'two tabs, each with an icon');
  assert.match(headers[0], /<sup class="app-version" id="appVersion"><\/sup>/, 'the version sits next to the logo');
});

test('extension pages only look up elements their HTML has', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (f) => readFileSync(new URL(`../extension/pages/${f}`, import.meta.url), 'utf8');
  for (const page of ['sidepanel', 'options', 'snippets', 'onboard']) {
    const html = read(`${page}.html`);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const used = new Set([...read(`${page}.js`).matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)].map((m) => m[1]));
    const missing = [...used].filter((id) => !ids.has(id));
    assert.deepEqual(missing, [], `${page}.js looks up ids that ${page}.html doesn't have`);
  }
});

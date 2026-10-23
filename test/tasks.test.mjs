import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, promptFiles } from './helpers.mjs';

const S = await load('shared/config.js', 'shared/markdown.js', 'shared/prompts.js', ...promptFiles, 'shared/snippets.js', 'shared/knowledge.js', 'background/research.js', 'background/jobs.js');

test('the page to open: the site the user names wins; a typed path is kept; else the model\'s pick', () => {
  assert.deepEqual(S.taskTarget('fetch the latest news from rediff', { url: 'https://www.rediff.com/' }), { url: 'https://www.rediff.com/', typed: false });
  assert.deepEqual(S.taskTarget('latest news from rediff.com', { url: 'https://www.cnn.com/' }), { url: 'https://rediff.com/', typed: true });
  assert.equal(S.taskTarget('what is trending on https://github.com/trending today', { url: 'https://github.com/' }).url, 'https://github.com/trending');
  assert.equal(S.taskTarget('headlines from bbc.co.uk/news', {}).url, 'https://bbc.co.uk/news');
  assert.deepEqual(S.taskTarget('weather in Bengaluru', { url: 'javascript:alert(1)' }), { url: '', typed: false });
  assert.deepEqual(S.taskTarget('weather in Bengaluru', {}), { url: '', typed: false });
});

test('headline links: absolute, on-site first, no account links or duplicates', () => {
  const html = '<a href="/cricket/a">Vaibhav Sooryavanshi selfie goes viral! 3 hours ago</a><a href="https://register.rediff.com/x">Get name@rediffmail.com, FREE! Sign up now today</a><a href="/cricket/a#c">Vaibhav Sooryavanshi selfie goes viral! 3 hours ago</a><a href="https://other.com/z">An external story that is long enough to count</a><a href="/m">Menu</a><a href="javascript:void(0)">not a link at all but long enough text</a><a href="/news/b">Markets &amp; more: Sensex rises 300 points today</a>';
  const links = S.pickLinks(S.anchorsIn(html), 'https://www.rediff.com/');
  assert.deepEqual(links.map((l) => l.url), ['https://www.rediff.com/cricket/a', 'https://www.rediff.com/news/b', 'https://other.com/z']);
  assert.equal(links[1].text, 'Markets & more: Sensex rises 300 points today');
});

test('a task job plans, reads the site (or a background tab when it needs JavaScript) and reports with its links', async () => {
  const store = {};
  const ext = {
    storage: { local: {
      get: async (k) => (k === null ? { ...store } : Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, store[x]]))),
      set: async (o) => Object.assign(store, o),
      remove: async (ks) => [].concat(ks).forEach((x) => delete store[x]),
    } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    runtime: { getPlatformInfo: async () => ({}) },
  };
  const calls = [];
  const runChat = async ({ messages, json }) => {
    calls.push(messages);
    if (json && messages.some((m) => /plan quick web tasks/.test(m.content))) return '{"url":"https://www.rediff.com/","goal":"List the top headlines"}';
    if (json) return '{"title":"Rediff headlines","summary":"s","tags":["news"]}';
    return 'Looked at rediff.com home.\n- [Sensex rises](https://www.rediff.com/news/b)';
  };
  const realRead = S.readSite;
  const realExt = S.ext;
  S.ext = ext; // the library (snippets) uses the same storage
  let tabReads = 0;
  try {
    for (const thin of [false, true]) {
      S.readSite = async (url) => ({ title: 'Rediff', url, text: thin ? 'Loading…' : 'Top stories. '.repeat(100), links: [{ text: 'Markets: Sensex rises 300 points today', url: 'https://www.rediff.com/news/b' }] });
      const runner = S.createJobRunner({ ext, runChat, errorPayload: (e) => ({ error: e.message }), getSettings: async () => ({ ...S.DEFAULT_SETTINGS }), readTab: async (url) => (tabReads++, { title: 'Rediff (rendered)', url, text: 'Rendered stories. '.repeat(100), links: [] }) });
      const msgs = [];
      const spec = {
        url: 'https://www.bbc.com/news/x', pageTitle: 'BBC', label: 'Task: latest news from rediff', kind: 'task', task: 'latest news from rediff',
        planMessages: S.buildMessages('taskPlan', S.pageVars({ title: '', url: '', text: '' }, { question: 'latest news from rediff', context: 'Today is Friday.' }), {}),
        final: S.buildMessages('taskReport', S.pageVars({ title: S.JOB_PLACEHOLDERS.pageTitle, url: S.JOB_PLACEHOLDERS.pageUrl, text: S.JOB_PLACEHOLDERS.pageText }, { question: 'latest news from rediff', context: S.JOB_PLACEHOLDERS.goal }), {}),
        saveMessages: S.buildMessages('save', S.pageVars({ title: 'Task', url: '', text: S.JOB_PLACEHOLDERS.summary }), {}),
      };
      await runner.start(spec, { postMessage: (m) => msgs.push(m) });
      for (let i = 0; i < 100 && !msgs.some((m) => m.type === 'done' || m.type === 'error'); i++) await new Promise((r) => setTimeout(r, 5));
      const done = msgs.find((m) => m.type === 'done');
      assert.ok(done, JSON.stringify(msgs.find((m) => m.type === 'error')));
      const report = calls.find((m) => m.some((x) => /complete a web task/.test(x.content)));
      const user = report.find((m) => m.role === 'user').content;
      assert.match(user, /Goal: List the top headlines/);
      assert.doesNotMatch(user, /@@SOROAGENT/, 'every placeholder filled');
      if (thin) assert.match(user, /Rendered stories/, 'the background tab was used');
      else {
        assert.match(user, /Top stories/);
        assert.match(user, /LINKS ON THE PAGE:\n- \[Markets: Sensex rises 300 points today\]\(https:\/\/www\.rediff\.com\/news\/b\)/);
      }
      assert.ok(msgs.some((m) => m.type === 'status' && /Reading rediff\.com/.test(m.text)));
      const saved = Object.values(store).find((v) => v && v.kind === 'summary' && v.label === 'Task: latest news from rediff' && v.url === 'https://www.rediff.com/');
      assert.ok(saved, 'saved under the site it read');
      calls.length = 0;
    }
    assert.equal(tabReads, 1);
  } finally {
    S.readSite = realRead;
    S.ext = realExt;
  }
});

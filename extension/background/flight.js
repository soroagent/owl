// Flight recorder: the last 50 things that went wrong inside soroagent (internal errors, site
// extractors that found nothing, model replies in an unexpected shape, storage upgrades), kept in
// session storage: in memory only, gone when the browser closes, never synced or backed up.
//
// Every event is scrubbed before it's stored: no web addresses, host names, page text, emails,
// keys or tokens, local file paths; short messages and a few whitelisted fields only. Settings →
// "Copy diagnostic report" turns it into Markdown the reader can look over and paste into a GitHub
// issue. Nothing is ever sent anywhere by soroagent itself. Scrubbing, the ring buffer and the
// report are pure and unit tested.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});
  const MAX_EVENTS = 50;
  const KEY = 'flightRecorder';
  const AREAS = ['error', 'extractor', 'llm', 'migration'];
  const DETAIL_KEYS = ['where', 'site', 'pageType', 'api', 'provider', 'engine', 'model', 'status', 'selector', 'from', 'to', 'changed', 'phase', 'lines'];
  const ISSUES_URL = 'https://github.com/soroagent/owl/issues/new';

  // ---------------------------------------------------------------------------
  // Pure: scrubbing
  // ---------------------------------------------------------------------------

  const SECRET = /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[abprs]-[A-Za-z0-9-]{8,}|ya29\.[\w.-]{8,}|gsk_[A-Za-z0-9]{16,}|xai-[A-Za-z0-9]{16,})/g;
  const BEARER = /\b(Bearer|Basic)(\s+)\S+|\b(token|key|apikey|api_key|password|passphrase|secret)(\s*[:=]\s*)\S+/gi;
  const URL_RE = /\b(?:https?|wss?|ftp|file|chrome-extension|moz-extension|chrome|about|data|blob):[^\s"'<>)\]]*/gi;
  const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  const HOST = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|io|ai|dev|app|co|gov|edu|info|me|tv|xyz|news|uk|de|fr|jp|in|cn|ru|br|au|ca|es|it|nl|se|ch|us|eu|ly|gg|so|to|fm|sh|page|site|cloud|tech|blog|local|localhost|internal|lan)\b/gi;
  const IP = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b|\blocalhost(?::\d+)?\b/gi;
  const PATH = /(?:\/Users|\/home|\/root|[A-Z]:\\Users)[\\/][^\s"'<>]+/g;
  const LONG_TOKEN = /\b[A-Za-z0-9_+/=-]{32,}\b/g;

  /** Pure: text with addresses, hosts, emails, secrets, paths and long tokens replaced, shortened. */
  function scrub(text, max = 200) {
    let s = String(text == null ? '' : text);
    s = s
      .replace(SECRET, '[secret]')
      .replace(BEARER, (m, a, b, c, d) => `${a || c}${b || d}[secret]`)
      .replace(URL_RE, '[url]')
      .replace(EMAIL, '[email]')
      .replace(PATH, '[path]')
      .replace(IP, '[host]')
      .replace(HOST, '[host]')
      .replace(LONG_TOKEN, '[redacted]')
      .replace(/\s+/g, ' ')
      .trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }

  /** Pure: an event reduced to what's safe and useful: area, code, a short message, whitelisted details. */
  function sanitizeEvent(event = {}, now = Date.now()) {
    const area = AREAS.includes(event.area) ? event.area : 'error';
    const code = /^[\w.:-]{1,40}$/.test(String(event.code || '')) ? String(event.code) : '';
    const detail = {};
    for (const k of DETAIL_KEYS) {
      const v = event.detail && event.detail[k];
      if (v === undefined || v === null || v === '') continue;
      detail[k] = typeof v === 'number' || typeof v === 'boolean' ? v : scrub(v, 80);
    }
    return { at: new Date(now).toISOString(), area, code, message: scrub(event.message, 200), detail, count: 1 };
  }

  // Storage may hand objects back with their keys in another order (Chrome sorts them).
  const sorted = (o) => JSON.stringify(Object.keys(o || {}).sort().map((k) => [k, o[k]]));
  const sameEvent = (a, b) => a.area === b.area && a.code === b.code && a.message === b.message && sorted(a.detail) === sorted(b.detail);

  /** Pure: the buffer with `event` added: a repeat of the last event bumps its count; at most `max`. */
  function pushEvent(buffer, event, max = MAX_EVENTS) {
    const list = Array.isArray(buffer) ? [...buffer] : [];
    const last = list[list.length - 1];
    if (last && sameEvent(last, event)) list[list.length - 1] = { ...last, at: event.at, count: (last.count || 1) + 1 };
    else list.push(event);
    return list.slice(-max);
  }

  // ---------------------------------------------------------------------------
  // Pure: the report
  // ---------------------------------------------------------------------------

  /**
   * Pure: the environment worth knowing for a bug report, from settings and the browser. No
   * addresses, keys or library content: the server address is only "default" or "custom".
   */
  function describeEnvironment({ settings = {}, version = '', userAgent = '', schemaVersion = '', libraryCount = 0, syncOn = false, markdownOn = false }) {
    const browser = (userAgent.match(/(Edg|OPR|Firefox|Chrome)\/(\d+)/) || []).slice(1).join(' ').replace(/^Edg/, 'Edge').replace(/^OPR/, 'Opera') || 'unknown';
    const os = /Mac OS X/.test(userAgent) ? 'macOS' : /Windows/.test(userAgent) ? 'Windows' : /CrOS/.test(userAgent) ? 'ChromeOS' : /Android/.test(userAgent) ? 'Android' : /Linux/.test(userAgent) ? 'Linux' : 'unknown';
    const defaults = soroagent.DEFAULT_SETTINGS || {};
    const ai =
      settings.source === 'cloud' ? `cloud: ${settings.cloudProvider || '?'}${settings.cloudProvider === 'custom' ? ' (custom address)' : ''}`
      : settings.source === 'browser' ? `in the browser: ${settings.browserEngine || 'nano'}`
      : `local server: ${settings.provider || 'auto'} at ${settings.baseUrl && settings.baseUrl !== defaults.baseUrl ? 'a custom address' : 'the default address'}`;
    const model = settings.source === 'cloud' ? (settings.cloudModels || {})[settings.cloudProvider] : settings.source === 'browser' ? '' : settings.model;
    const on = (v) => (v ? 'on' : 'off');
    return [
      ['soroagent', version || '?'],
      ['Browser', browser],
      ['OS', os],
      ['AI', ai],
      ['Model', scrub(model || 'recommended', 60)],
      ['Thinking allowed', on(settings.allowThinking)],
      ['Prepare on visit / page questions', `${on(settings.preparePages)} / ${on(settings.pageQuestions)}`],
      ['Passive capture', settings.autoCapture === 'on' ? 'on' : 'off'],
      ['Search by meaning', on(settings.semanticSearch !== false)],
      ['Sync / Markdown folder', `${on(syncOn)} / ${on(markdownOn)}`],
      ['Owl button / opens in', `${on(settings.showLauncher)} / ${settings.openIn || 'page'}`],
      ['Storage schema', String(schemaVersion || '?')],
      ['Library items', String(libraryCount)],
    ];
  }

  /** Pure: the report as Markdown (newest event first). */
  function formatReport({ events = [], env = [], generatedAt = new Date().toISOString() }) {
    const rows = env.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '/')} |`).join('\n');
    const list = [...events].reverse().map((e) => {
      const detail = Object.entries(e.detail || {}).map(([k, v]) => `${k}=${v}`).join(', ');
      const times = e.count > 1 ? ` ×${e.count}` : '';
      return `- \`${e.at.slice(0, 19).replace('T', ' ')}\` **${e.area}**${e.code ? ` \`${e.code}\`` : ''}${times}: ${e.message || '(no message)'}${detail ? ` _(${detail})_` : ''}`;
    });
    return [
      '### Diagnostic report',
      '',
      `Generated ${generatedAt.slice(0, 19).replace('T', ' ')} UTC. soroagent removes web addresses, page text, emails and keys from this report.`,
      '',
      '| | |',
      '|---|---|',
      rows,
      '',
      `#### Recent events (${events.length}${events.length >= MAX_EVENTS ? `, the last ${MAX_EVENTS}` : ''})`,
      '',
      list.length ? list.join('\n') : '_Nothing went wrong since the browser started._',
    ].join('\n');
  }

  /** Pure: a pre-filled GitHub issue URL. Long reports are cut to fit the address; the full one is on the clipboard. */
  function issueUrl(report, { title = 'Bug: ', maxBody = 6000 } = {}) {
    const intro = '**What happened?**\n\n<!-- Describe what you did, what you expected, and what happened instead. -->\n\n**Steps to reproduce**\n\n1. \n\n';
    let body = `${intro}${report}`;
    if (encodeURIComponent(body).length > maxBody * 3) {
      body = `${intro}${report.slice(0, maxBody)}\n\n…(cut to fit; the full report is on your clipboard, paste it here)`;
    }
    const params = new URLSearchParams({ title, labels: 'bug', body });
    return `${ISSUES_URL}?${params}`;
  }

  // ---------------------------------------------------------------------------
  // The recorder (background)
  // ---------------------------------------------------------------------------

  function createFlightRecorder({ ext }) {
    const area = ext.storage && ext.storage.session;
    let memory = []; // when session storage isn't available
    let queue = Promise.resolve();

    const read = async () => (area ? (await area.get(KEY))[KEY] || [] : memory);
    const write = async (list) => (area ? area.set({ [KEY]: list }) : (memory = list));

    function record(event) {
      const clean = sanitizeEvent(event);
      queue = queue.then(async () => write(pushEvent(await read(), clean))).catch(() => {});
      return queue;
    }

    return { record, list: () => queue.then(read), clear: () => (queue = queue.then(() => write([]))) };
  }

  Object.assign(soroagent, { scrubDiagnostic: scrub, sanitizeEvent, pushEvent, describeEnvironment, formatReport, issueUrl, createFlightRecorder, FLIGHT_MAX_EVENTS: MAX_EVENTS });
})(globalThis);

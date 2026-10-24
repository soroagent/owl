// Browsing pattern page: reading stats from the reading log (shared/patterns.js) plus the library's
// own numbers. Everything is read from this browser's storage; nothing is sent anywhere.
(function () {
  'use strict';

  const S = globalThis.soroagent;
  S.watchPageErrors('browsing pattern');
  const { ext } = S;
  const $ = (id) => document.getElementById(id);
  let days = 30;
  try {
    days = Number(localStorage.getItem('patternDays') ?? 30);
  } catch {
    // storage blocked: the default range
  }

  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
  const dayLabel = (day, opts = { day: 'numeric', month: 'short' }) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
  };
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

  function tile(k, v, s = '') {
    return el('div', { className: 'tile' }, [el('div', { className: 'k', textContent: k }), el('div', { className: 'v', textContent: v }), el('div', { className: 's', textContent: s })]);
  }

  // Ranked bars (one hue for magnitude); the value is also written out, so color never carries it alone.
  function rank(node, rows, empty) {
    if (!rows.length) return node.replaceChildren(el('p', { className: 'empty-note', textContent: empty }));
    const top = Math.max(...rows.map((r) => r.ms), 1);
    node.replaceChildren(...rows.map((r) => {
      const bar = el('div', { className: 'bar' });
      bar.style.width = `${Math.max(2, (r.ms / top) * 100)}%`;
      const row = el('div', { className: 'rank-row' }, [el('span', { className: 'name', textContent: r.name, title: r.name }), el('div', { className: 'track' }, [bar]), el('span', { className: 'val', textContent: `${S.formatDuration(r.ms)} · ${plural(r.pages, 'page')}` })]);
      row.dataset.tip = `${r.name}: ${S.formatDuration(r.ms)} over ${plural(r.pages, 'page')}`;
      return row;
    }));
  }

  // Column bars over time, with a tooltip per bar.
  function columns(node, values, tipFor, label) {
    const top = Math.max(...values.map((v) => v.ms), 1);
    node.setAttribute('aria-label', label);
    node.replaceChildren(...values.map((v) => {
      const fill = el('span');
      fill.style.height = `${(v.ms / top) * 100}%`;
      const col = el('div', { className: `col${v.ms ? '' : ' zero'}` }, [fill]);
      col.dataset.tip = tipFor(v);
      return col;
    }));
  }

  async function render() {
    const all = await ext.storage.local.get(null);
    const settings = { ...S.DEFAULT_SETTINGS, ...(all.settings || {}) };
    const log = Array.isArray(all.readingLog) ? all.readingLog : [];
    const now = new Date();
    document.querySelectorAll('[data-days]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days)));
    $('off').hidden = settings.readingLog !== false;

    const st = S.readingStats(log, { days, now });
    const first = log.reduce((a, e) => (!a || e.d < a ? e.d : a), '');
    $('intro').textContent = first ? `What you read, how long and when. Since ${dayLabel(first, { day: 'numeric', month: 'long', year: 'numeric' })}.` : 'What you read, how long and when. It fills in as you read.';
    $('tiles').replaceChildren(
      tile('Time reading', S.formatDuration(st.totalMs), st.activeDays ? `${S.formatDuration(st.totalMs / st.activeDays)} a day you read` : 'Nothing yet'),
      tile('Pages read', st.pages.toLocaleString(), st.siteCount ? `on ${plural(st.siteCount, 'site')}` : ''),
      tile('Average read', st.pages ? S.formatDuration(st.avgMs) : '–', st.longest ? `Longest: ${S.formatDuration(st.longest.ms)}` : 'per page'),
      tile('Days reading', st.activeDays.toLocaleString(), st.streak > 1 ? `${st.streak}-day streak` : st.streak === 1 ? 'Read today' : 'No streak yet'),
      tile('You read most at', st.peakHour === null ? '–' : hourLabel(st.peakHour), st.peakHour === null ? '' : `${S.formatDuration(st.byHour[st.peakHour])} in that hour`),
    );

    const topics = S.readingTopics(log.filter((e) => !days || e.d >= st.byDay[0].day), { max: 10 });
    rank($('topics'), topics.map((t) => ({ name: t.topic, ms: t.ms, pages: t.pages })), log.length ? 'Topics appear once you’ve read a few pages on the same subject.' : 'Nothing read yet.');
    rank($('sites'), st.sites.map((s) => ({ name: s.host, ms: s.ms, pages: s.pages })), 'Nothing read yet.');

    columns($('days'), st.byDay, (v) => `${dayLabel(v.day, { weekday: 'short', day: 'numeric', month: 'short' })}: ${v.ms ? `${S.formatDuration(v.ms)} · ${plural(v.pages, 'page')}` : 'no reading'}`, 'Reading time per day');
    const n = st.byDay.length;
    $('dayAxis').replaceChildren(...(n ? [st.byDay[0], st.byDay[Math.floor((n - 1) / 2)], st.byDay[n - 1]] : []).map((v, i) => el('span', { textContent: i === 2 ? 'Today' : dayLabel(v.day) })));
    columns($('hours'), st.byHour.map((ms, h) => ({ ms, h })), (v) => `${hourLabel(v.h)}: ${v.ms ? S.formatDuration(v.ms) : 'no reading'}`, 'Reading time by hour of day');

    const snippets = Object.keys(all).filter((k) => k.startsWith('snippet:')).map((k) => all[k]);
    const summaries = Object.keys(all).filter((k) => k.startsWith('summary:')).map((k) => all[k]);
    const lib = S.libraryStats(snippets, summaries, { days, now });
    $('libSub').textContent = days ? `Added in the last ${days} days · ${plural(lib.total, 'note')} in all` : `${plural(lib.total, 'note')} in all`;
    const k = lib.byKind;
    $('libTiles').replaceChildren(
      tile('Saved', lib.added.toLocaleString(), 'notes added'),
      tile('Summaries', lib.summaries.toLocaleString(), 'made'),
      tile('Research briefs', (k.research || 0).toLocaleString(), (k.deliverable ? `${k.deliverable} drafts and guides` : '')),
      tile('Pages and highlights', ((k.page || 0) + (k.read || 0) + (k.selection || 0)).toLocaleString(), k.screenshot ? plural(k.screenshot, 'screenshot') : ''),
    );
    $('tags').replaceChildren(...lib.topTags.map((t) => el('span', { className: 'tag', title: `${plural(t.count, 'note')} tagged ${t.tag}` }, [t.tag, el('span', { className: 'count', textContent: t.count })])));
  }

  document.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
    days = Number(b.dataset.days);
    try {
      localStorage.setItem('patternDays', String(days));
    } catch {
      // not remembered; fine
    }
    render();
  }));

  // Tooltips for bars and rows.
  const tip = $('tip');
  document.addEventListener('pointermove', (e) => {
    const target = e.target.closest && e.target.closest('[data-tip]');
    if (!target) return (tip.hidden = true);
    tip.textContent = target.dataset.tip;
    tip.style.left = `${e.clientX}px`;
    tip.style.top = `${e.clientY}px`;
    tip.hidden = false;
  });
  document.addEventListener('pointerleave', () => (tip.hidden = true));

  let timer = 0;
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.readingLog || changes.settings || Object.keys(changes).some((k) => k.startsWith('snippet:')))) return;
    clearTimeout(timer);
    timer = setTimeout(render, 500);
  });
  render();
})();

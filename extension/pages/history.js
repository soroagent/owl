(function () {
  'use strict';

  const S = globalThis.soroagent;
  S.watchPageErrors('history');
  const { ext, groupTimeline, renderMarkdown, stripThinking, addSnippet } = S;
  const PREFIX = 'summary:';
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  // Model output is escaped by renderMarkdown; DOMParser keeps it inert.
  const markdown = (text, url) => {
    const doc = new DOMParser().parseFromString(`<body>${renderMarkdown(S.linkHandles(stripThinking(text || ''), url))}</body>`, 'text/html');
    return [...doc.body.childNodes];
  };

  const STATUS_LABEL = { running: 'Running', done: 'Done', error: 'Failed', interrupted: 'Interrupted', stopped: 'Stopped' };
  let records = [];
  let statusFilter = 'all';
  let siteFilter = '';
  const expanded = new Set();

  const hostOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };
  const siteColor = (host) => {
    let hash = 0;
    for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 45% 45%)`;
  };
  const formatTime = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };
  const duration = (r) => {
    if (!r.finishedAt) return '';
    const seconds = Math.round((Date.parse(r.finishedAt) - Date.parse(r.createdAt)) / 1000);
    return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
  };

  function matches(record, query) {
    if (statusFilter === 'running' && record.status !== 'running') return false;
    if (statusFilter === 'done' && record.status !== 'done') return false;
    if (statusFilter === 'failed' && !['error', 'interrupted'].includes(record.status)) return false;
    if (siteFilter && hostOf(record.url) !== siteFilter) return false;
    if (!query) return true;
    const haystack = [record.label, record.pageTitle, record.url, record.site, record.text, record.model].join(' ').toLowerCase();
    return query.split(/\s+/).every((word) => haystack.includes(word));
  }

  function renderCard(record) {
    const host = hostOf(record.url);
    const title = el('h2', {}, [
      el('span', { textContent: record.pageTitle || record.label }),
      el('span', { className: `status-chip ${record.status}`, textContent: STATUS_LABEL[record.status] || record.status }),
    ]);
    const meta = el('div', { className: 'meta' });
    if (host) {
      const site = el('button', { type: 'button', className: 'site', title: `Show only ${host}` }, [
        el('span', { className: 'avatar', textContent: host[0].toUpperCase(), style: `background:${siteColor(host)}` }),
        el('span', { textContent: host }),
      ]);
      site.addEventListener('click', () => {
        siteFilter = host;
        render();
      });
      meta.append(site);
    }
    meta.append(el('span', { textContent: record.label }));
    if (record.model) meta.append(el('span', { textContent: record.model }));
    if (duration(record)) meta.append(el('span', { textContent: duration(record) }));
    if (/^https?:/.test(record.url)) meta.append(el('a', { href: S.safeUrl(record.url), target: '_blank', rel: 'noopener', textContent: 'Open page ↗' }));

    const card = el('article', { className: 'item compact' }, [title, meta]);
    if (record.status === 'running') card.append(el('div', { className: 'working', textContent: record.statusText || 'Summarizing in the background…' }));
    if (record.error && record.status !== 'done') card.append(el('div', { className: 'problem', textContent: `${record.error}${record.hint ? ` ${record.hint}` : ''}` }));
    if (record.text) {
      const result = el('div', { className: `result${expanded.has(record.id) || record.status === 'running' ? ' open' : ''}` }, markdown(record.text, record.url));
      card.append(result);
    }
    if (record.sources && record.sources.length) {
      card.append(el('div', { className: 'meta', textContent: `Research sources · searched “${record.query || ''}”` }));
      card.append(el('ol', { className: 'sources' }, record.sources.map((src) => el('li', {}, [el('a', { href: S.safeUrl(src.url), target: '_blank', rel: 'noopener noreferrer', textContent: src.title || src.url })]))));
    }

    const actions = el('div', { className: 'actions' });
    if (record.text && record.status !== 'running') {
      const more = el('button', { className: 'btn small', type: 'button', textContent: expanded.has(record.id) ? 'Show less' : 'Show all' });
      more.addEventListener('click', () => {
        if (expanded.has(record.id)) expanded.delete(record.id);
        else expanded.add(record.id);
        render();
      });
      const copy = el('button', { className: 'btn small', type: 'button', textContent: 'Copy' });
      copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(`${record.pageTitle}\n${record.url}\n\n${stripThinking(record.text)}`);
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1500);
      });
      const keep = el('button', { className: 'btn small', type: 'button', textContent: 'Save as snippet' });
      keep.addEventListener('click', async () => {
        const text = stripThinking(record.text);
        await addSnippet({
          title: `Summary: ${record.pageTitle || record.label}`.slice(0, 120),
          summary: text.replace(/[*#>`_-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300),
          tags: ['summary'],
          text,
          url: record.url,
          pageTitle: record.pageTitle,
          source: 'page',
          model: record.model,
        });
        keep.textContent = 'Saved';
        keep.disabled = true;
      });
      actions.append(more, copy, keep);
    }
    const remove = el('button', { className: 'btn small danger', type: 'button', textContent: record.status === 'running' ? 'Stop & delete' : 'Delete' });
    remove.addEventListener('click', () => ext.runtime.sendMessage({ type: 'summary:delete', ids: [record.id] }));
    actions.append(remove);
    card.append(actions);
    return card;
  }

  function renderFilters() {
    const box = $('filters');
    box.replaceChildren();
    if (siteFilter) {
      const clear = el('button', { className: 'btn small', type: 'button', textContent: 'Clear' });
      clear.addEventListener('click', () => {
        siteFilter = '';
        render();
      });
      box.append(el('span', { textContent: 'Site:' }), el('span', { className: 'tag', textContent: siteFilter }), clear);
    }
    box.hidden = !siteFilter;
  }

  function render() {
    const query = $('search').value.trim().toLowerCase();
    const visible = records.filter((r) => matches(r, query));
    const running = records.filter((r) => r.status === 'running').length;
    $('count').textContent = records.length ? `(${records.length}${running ? ` · ${running} running` : ''})` : '';
    for (const b of document.querySelectorAll('[data-status]')) b.setAttribute('aria-pressed', String(b.dataset.status === statusFilter));
    renderFilters();
    if (!visible.length) {
      $('view').replaceChildren(el('div', {
        className: 'empty',
        textContent: records.length ? 'No summaries match.' : 'No summaries yet. Click Summarize on any page; every summary is kept here.',
      }));
      return;
    }
    const months = groupTimeline(visible);
    const index = el('nav', { className: 'months', ariaLabel: 'Jump to month' }, [el('div', { className: 'months-title', textContent: 'Months' })]);
    const content = el('div', { className: 'timeline' });
    for (const month of months) {
      const section = el('section', { className: 'month', id: `month-${month.key}` }, [el('h2', { className: 'month-label', textContent: month.label })]);
      for (const day of month.days) {
        section.append(el('div', { className: 'day' }, [
          el('div', { className: 'day-head' }, [el('span', { textContent: day.label }), el('small', { textContent: `${day.items.length} summar${day.items.length === 1 ? 'y' : 'ies'}` })]),
          el('div', { className: 'rail' }, day.items.map((r) => el('div', { className: 'entry' }, [el('time', { dateTime: r.createdAt, textContent: formatTime(r.createdAt) }), renderCard(r)]))),
        ]));
      }
      content.append(section);
      const jump = el('button', { type: 'button' }, [document.createTextNode(month.label), el('span', { textContent: String(month.count) })]);
      jump.addEventListener('click', () => document.getElementById(`month-${month.key}`).scrollIntoView({ behavior: 'smooth', block: 'start' }));
      index.append(jump);
    }
    $('view').replaceChildren(el('div', { className: 'timeline-layout' }, [index, content]));
  }

  async function load() {
    const all = await ext.storage.local.get(null);
    records = Object.keys(all).filter((k) => k.startsWith(PREFIX)).map((k) => all[k]);
    render();
    // Opening the history counts as seeing the results.
    const unseen = records.filter((r) => r.status !== 'running' && !r.seen).map((r) => r.id);
    if (unseen.length) ext.runtime.sendMessage({ type: 'summary:seen', ids: unseen });
  }

  for (const button of document.querySelectorAll('[data-status]')) {
    button.addEventListener('click', () => {
      statusFilter = button.dataset.status;
      render();
    });
  }
  $('search').addEventListener('input', render);
  $('clear').addEventListener('click', async () => {
    if (records.length && confirm(`Delete all ${records.length} summaries from the history?`)) {
      await ext.runtime.sendMessage({ type: 'summary:delete', ids: records.map((r) => r.id) });
    }
  });

  // Live updates while summaries run (throttled: running jobs save every ~1.5 s).
  let pending = 0;
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.keys(changes).some((k) => k.startsWith(PREFIX))) return;
    clearTimeout(pending);
    pending = setTimeout(load, 300);
  });

  load();

  // "Ask your library": the chat console at the bottom of the page.
  S.mountLibraryChat({ placeholder: 'Ask your library… (Ctrl/⌘ K)' });
})();

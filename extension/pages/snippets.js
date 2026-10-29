(function () {
  'use strict';

  const S = globalThis.soroagent;
  S.watchPageErrors('snippets');
  const { ext, listSnippets, deleteSnippets, importSnippets, isSnippetChange, groupTimeline, renderMarkdown, stripThinking, addSnippet } = S;
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  // Model output is escaped by renderMarkdown; DOMParser keeps it inert.
  // `url` links @handles (X) and u/ r/ names (Reddit) in summaries of those sites.
  const markdown = (text, url) => [...new DOMParser().parseFromString(`<body>${renderMarkdown(S.linkHandles(stripThinking(text || ''), url))}</body>`, 'text/html').body.childNodes];

  const PREFS_KEY = 'soroagent.snippetsView';
  let snippets = [];
  // The summary history, merged in: every summary job (summary:<id>). Saved ones show as their
  // snippet; the rest (running, failed, or not saved) show as `jobs` items with their status.
  let records = [];
  let jobs = [];
  let selectedId = '';
  let tagFilter = '';
  let siteFilter = '';
  let prefs = { group: 'day' };
  try {
    prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    // keep defaults
  }
  const savePrefs = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // not saved; still applied
    }
  };
  // Search by meaning and words (the library index), ranked; null when the box is empty.
  let ranked = null; // { query, ids: [...], mode }
  const relatedCache = new Map(); // snippet id -> related notes

  const KIND_LABEL = { summary: 'Summary', selection: 'Selection', page: 'Page', research: 'Research', deliverable: 'Created', read: 'Read' };
  const JOB_LABEL = { running: 'Working', done: 'Not saved', error: 'Failed', interrupted: 'Interrupted', stopped: 'Stopped' };
  const kindOf = (s) => s.kind || (s.source === 'selection' ? 'selection' : s.source === 'summary' ? 'summary' : 'page');
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
  const when = (iso, opts) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, opts);
  };
  const plain = (text) => stripThinking(text || '').replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim();

  function matches(s, query) {
    if (tagFilter && !s.tags.includes(tagFilter)) return false;
    if (siteFilter && hostOf(s.url) !== siteFilter) return false;
    if (!query) return true;
    if (ranked && ranked.query === query) return ranked.ids.includes(s.id);
    const haystack = [s.title, s.summary, s.text, s.pageTitle, s.url, ...s.tags, s.research && s.research.text].join(' ').toLowerCase();
    return query.split(/\s+/).every((word) => haystack.includes(word));
  }

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  function siteBadge(host) {
    return el('span', { className: 'site' }, [
      el('span', { className: 'avatar', textContent: (host[0] || '?').toUpperCase(), style: `background:${siteColor(host || '?')}` }),
      el('span', { textContent: host }),
    ]);
  }

  function renderCard(s) {
    const kind = kindOf(s);
    const host = hostOf(s.url);
    const summary = s.summary || plain(s.text).slice(0, 220);
    const card = el('button', { type: 'button', className: 'card' }, [
      el('div', { className: 'card-title', textContent: s.title || s.pageTitle || 'Untitled' }),
      summary ? el('div', { className: 'card-summary', textContent: summary }) : '',
      el('div', { className: 'meta' }, [
        s.job ? el('span', { className: `kind job ${s.job.status}`, textContent: JOB_LABEL[s.job.status] || s.job.status }) : el('span', { className: `kind ${kind}`, textContent: KIND_LABEL[kind] || kind }),
        host ? siteBadge(host) : '',
        el('span', { textContent: when(s.createdAt, { hour: 'numeric', minute: '2-digit', ...(prefs.group === 'day' ? {} : { day: 'numeric', month: 'short' }) }) }),
        s.research ? el('span', { className: 'has-research', textContent: '· researched' }) : '',
      ]),
    ]);
    card.setAttribute('aria-current', String(s.id === selectedId));
    card.addEventListener('click', () => select(s.id));
    return card;
  }

  function groups(visible) {
    if (prefs.group === 'site') {
      const bySite = new Map();
      for (const s of visible) {
        const host = hostOf(s.url) || 'Other';
        if (!bySite.has(host)) bySite.set(host, []);
        bySite.get(host).push(s);
      }
      return [...bySite.entries()].sort((a, b) => String(b[1][0].createdAt).localeCompare(String(a[1][0].createdAt))).map(([label, items]) => ({ label, items }));
    }
    if (prefs.group === 'topic') {
      const byTag = new Map();
      for (const s of visible) {
        const tag = s.tags[0] ? `#${s.tags[0]}` : 'No topic';
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag).push(s);
      }
      return [...byTag.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([label, items]) => ({ label, items }));
    }
    return groupTimeline(visible).flatMap((month) => month.days.map((day) => ({ label: day.label, items: day.items })));
  }

  function renderList(visible, rankedBy = null) {
    if (!visible.length) {
      $('list').replaceChildren(el('div', {
        className: 'empty',
        textContent: snippets.length
          ? libraryMode === 'words' && $('search').value.trim()
            ? 'Nothing uses those words. To also find notes by meaning (the same idea in other words), install a free embedding model: ollama pull nomic-embed-text'
            : 'No snippets match.'
          : 'No snippets yet. Every summary you make is saved here automatically.',
      }));
      return;
    }
    const nodes = [];
    if (rankedBy) {
      nodes.push(el('div', { className: 'group-head' }, [el('span', { textContent: `Best matches${rankedBy.mode === 'meaning' ? ' · by meaning and words' : ''}` }), el('small', { textContent: String(visible.length) })]));
      for (const s of visible) nodes.push(renderCard(s));
      $('list').replaceChildren(...nodes);
      return;
    }
    for (const group of groups(visible)) {
      nodes.push(el('div', { className: 'group-head' }, [el('span', { textContent: group.label }), el('small', { textContent: String(group.items.length) })]));
      for (const s of group.items) nodes.push(renderCard(s));
    }
    $('list').replaceChildren(...nodes);
  }

  // ---------------------------------------------------------------------------
  // Reading view
  // ---------------------------------------------------------------------------

  function sourcesList(sources) {
    return el('ol', { className: 'sources' }, (sources || []).map((src) =>
      el('li', {}, [el('a', { href: S.safeUrl(src.url), target: '_blank', rel: 'noopener noreferrer', textContent: src.title || hostOf(src.url) }), el('small', { textContent: ` ${hostOf(src.url)}` })])
    ));
  }

  function renderReader() {
    const reader = $('reader');
    const s = snippets.find((x) => x.id === selectedId) || jobs.find((x) => x.id === selectedId);
    reader.classList.toggle('open', Boolean(s));
    if (!s) {
      reader.replaceChildren(el('div', { className: 'reader-empty', textContent: snippets.length ? 'Select a snippet to read it here.' : 'Your snippets will appear here.' }));
      return;
    }
    const kind = kindOf(s);
    const host = hostOf(s.url);
    const back = el('button', { type: 'button', className: 'btn small back', textContent: '← All snippets' });
    back.addEventListener('click', () => select(''));

    const meta = el('div', { className: 'meta' }, [
      el('span', { className: `kind ${kind}`, textContent: KIND_LABEL[kind] || kind }),
      host ? siteBadge(host) : '',
      el('span', { textContent: when(s.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) }),
      s.model ? el('span', { textContent: s.model }) : '',
    ]);
    const nodes = [back, meta, el('h1', { textContent: s.title || s.pageTitle || 'Untitled' })];
    if (s.tags.length) {
      nodes.push(el('div', { className: 'tags' }, s.tags.map((tag) => {
        const chip = el('button', { type: 'button', className: 'tag', textContent: `#${tag}` });
        chip.addEventListener('click', () => {
          tagFilter = tag;
          render();
        });
        return chip;
      })));
    }

    if (s.job) return renderJobReader(s, reader, back);

    const body = el('div', { className: 'prose' });
    if (kind === 'summary' || kind === 'research' || kind === 'deliverable') body.append(...markdown(s.text, s.url));
    else {
      if (s.summary) body.append(el('p', { textContent: s.summary }));
      body.append(el('blockquote', { className: 'quote', textContent: s.text }));
    }
    nodes.push(body);
    nodes.push(relatedSection(s));

    // Research done from the panel is attached to the snippet; shown here when there is some.
    if (s.research && kind !== 'research') {
      nodes.push(el('div', { className: 'section-title', textContent: 'Research' }));
      nodes.push(el('div', { className: 'meta', textContent: `Searched “${s.research.query || ''}” · ${when(s.research.at, { dateStyle: 'medium', timeStyle: 'short' })}` }));
      nodes.push(el('div', { className: 'prose' }, markdown(s.research.text, s.url)));
      nodes.push(el('div', { className: 'section-title', textContent: 'Sources' }), sourcesList(s.research.sources));
    } else if (kind === 'research' && s.research) {
      nodes.push(el('div', { className: 'section-title', textContent: 'Sources' }), sourcesList(s.research.sources));
    }

    const actions = el('div', { className: 'reader-actions' });
    if (/^https?:/.test(s.url)) actions.append(el('a', { className: 'btn', href: S.safeUrl(s.url), target: '_blank', rel: 'noopener', textContent: 'Open source ↗' }));
    const copy = el('button', { type: 'button', className: 'btn', textContent: 'Copy' });
    copy.addEventListener('click', async () => {
      const extra = s.research ? `\n\n## Research\n${stripThinking(s.research.text)}` : '';
      await navigator.clipboard.writeText(`# ${s.title}\n${s.url}\n\n${stripThinking(s.text)}${extra}`);
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy'), 1500);
    });
    const remove = el('button', { type: 'button', className: 'btn danger', textContent: 'Delete' });
    remove.addEventListener('click', async () => {
      await deleteSnippets([s.id]);
      forgetJobsOf([s.id]);
      selectedId = '';
    });
    actions.append(copy, remove);
    nodes.push(actions);
    reader.replaceChildren(...nodes);
  }

  // A summary from the history that isn't a snippet: its progress, its problem, or its unsaved result.
  function renderJobReader(s, reader, back) {
    const r = s.job;
    const seconds = r.finishedAt ? Math.round((Date.parse(r.finishedAt) - Date.parse(r.createdAt)) / 1000) : 0;
    const meta = el('div', { className: 'meta' }, [
      el('span', { className: `kind job ${r.status}`, textContent: JOB_LABEL[r.status] || r.status }),
      hostOf(r.url) ? siteBadge(hostOf(r.url)) : '',
      el('span', { textContent: when(r.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) }),
      r.label ? el('span', { textContent: r.label }) : '',
      r.model ? el('span', { textContent: r.model }) : '',
      seconds ? el('span', { textContent: seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s` }) : '',
    ]);
    const nodes = [back, meta, el('h1', { textContent: s.title })];
    if (r.status === 'running') nodes.push(el('div', { className: 'working', textContent: r.statusText || 'Working in the background…' }));
    if (r.error && r.status !== 'done') nodes.push(el('div', { className: 'problem', textContent: `${r.error}${r.hint ? ` ${r.hint}` : ''}` }));
    if (r.text) nodes.push(el('div', { className: 'prose' }, markdown(r.text, r.url)));
    if (r.sources && r.sources.length) nodes.push(el('div', { className: 'section-title', textContent: 'Sources' }), sourcesList(r.sources));
    const actions = el('div', { className: 'reader-actions' });
    if (r.status === 'done' && r.text) {
      const keep = el('button', { type: 'button', className: 'btn primary', textContent: 'Save as snippet' });
      keep.addEventListener('click', async () => {
        keep.disabled = true;
        const text = stripThinking(r.text);
        const saved = await addSnippet({ kind: r.kind === 'research' ? 'research' : 'summary', source: 'page', title: (r.pageTitle || r.label || 'Summary').slice(0, 160), pageTitle: r.pageTitle, createdAt: r.createdAt, summary: plain(text).slice(0, 300), text, url: r.url, model: r.model, tags: [] });
        await ext.runtime.sendMessage({ type: 'summary:delete', ids: [r.id] }); // it lives on as the snippet
        selectedId = saved && saved.id ? saved.id : '';
      });
      actions.append(keep);
    }
    if (/^https?:/.test(r.url)) actions.append(el('a', { className: 'btn', href: S.safeUrl(r.url), target: '_blank', rel: 'noopener', textContent: 'Open page ↗' }));
    if (r.text) {
      const copy = el('button', { type: 'button', className: 'btn', textContent: 'Copy' });
      copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(`${r.pageTitle || r.label}\n${r.url}\n\n${stripThinking(r.text)}`);
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1500);
      });
      actions.append(copy);
    }
    const remove = el('button', { type: 'button', className: 'btn danger', textContent: r.status === 'running' ? 'Stop & delete' : 'Delete' });
    remove.addEventListener('click', async () => {
      await ext.runtime.sendMessage({ type: 'summary:delete', ids: [r.id] });
      selectedId = '';
    });
    actions.append(remove);
    nodes.push(actions);
    reader.replaceChildren(...nodes);
  }

  // Deleting a snippet also deletes the summary job that made it, so it doesn't come back as "not saved".
  function forgetJobsOf(ids) {
    const gone = records.filter((r) => r.snippetId && ids.includes(r.snippetId)).map((r) => r.id);
    if (gone.length) ext.runtime.sendMessage({ type: 'summary:delete', ids: gone }).catch(() => {});
  }

  // A summary job as a list item (only those without a saved snippet; see load()).
  function jobItem(r) {
    const text = r.text || '';
    return {
      id: `job:${r.id}`,
      job: r,
      kind: 'job',
      title: r.pageTitle || r.label || 'Summary',
      summary: r.status === 'running' ? r.statusText || 'Working in the background…' : r.error && r.status !== 'done' ? r.error : plain(text).slice(0, 220),
      text,
      url: r.url || '',
      pageTitle: r.pageTitle || '',
      createdAt: r.createdAt,
      tags: [],
    };
  }

  // "Related in your library": notes about the same thing, found by meaning and words.
  function relatedSection(s) {
    const box = el('div', { className: 'related-notes' });
    const show = (list) => {
      if (!list.length) return box.replaceChildren();
      box.replaceChildren(
        el('div', { className: 'section-title', textContent: 'Related in your PKG' }),
        el('ul', { className: 'related-list' }, list.map((n) => {
          const link = el('button', { type: 'button', className: 'link', textContent: n.title || n.pageTitle || 'Untitled' });
          link.addEventListener('click', () => select(n.id));
          return el('li', {}, [link, el('small', { textContent: ` ${hostOf(n.url)} · ${when(n.createdAt, { day: 'numeric', month: 'short' })}` })]);
        }))
      );
    };
    if (relatedCache.has(s.id)) show(relatedCache.get(s.id));
    else {
      ext.runtime.sendMessage({ type: 'library:search', query: `${s.title}\n${(s.tags || []).join(' ')}\n${s.summary || ''}`, limit: 6 })
        .then((res) => {
          const list = ((res && res.results) || []).map((r) => r.note).filter((n) => n.id !== s.id && !(s.url && n.url === s.url)).slice(0, 4);
          relatedCache.set(s.id, list);
          if (s.id === selectedId) show(list);
        })
        .catch(() => {});
    }
    return box;
  }

  function select(id) {
    selectedId = id;
    render();
    if (id && window.innerWidth > 860) $('reader').scrollTop = 0;
  }

  // ---------------------------------------------------------------------------

  function renderFilters() {
    const box = $('filters');
    box.replaceChildren();
    const add = (label, value, clear) => {
      const button = el('button', { className: 'btn small', type: 'button', textContent: 'Clear' });
      button.addEventListener('click', () => {
        clear();
        render();
      });
      box.append(el('span', { textContent: label }), el('span', { className: 'tag', textContent: value }), button);
    };
    if (tagFilter) add('Topic:', `#${tagFilter}`, () => (tagFilter = ''));
    if (siteFilter) add('Site:', siteFilter, () => (siteFilter = ''));
    box.hidden = !tagFilter && !siteFilter;
  }

  function render() {
    const query = $('search').value.trim().toLowerCase();
    const visible = [...snippets, ...jobs].filter((s) => matches(s, query)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    for (const b of document.querySelectorAll('[data-group]')) b.setAttribute('aria-pressed', String(b.dataset.group === prefs.group));
    renderFilters();
    renderLibraryLine();
    if (ranked && ranked.query === query) visible.sort((a, b) => ranked.ids.indexOf(a.id) - ranked.ids.indexOf(b.id));
    renderList(visible, ranked && ranked.query === query ? ranked : null);
    renderReader();
  }

  // The library at a glance: it grows with everything you read.
  let libraryMode = '';
  function renderLibraryLine() {
    const text = snippets;
    if (!text.length) {
      $('libraryLine').textContent = '';
      return;
    }
    const topics = new Set(text.flatMap((s) => s.tags));
    const sites = new Set(text.map((s) => hostOf(s.url)).filter(Boolean));
    const first = text.reduce((min, s) => (String(s.createdAt) < min ? String(s.createdAt) : min), String(text[0].createdAt));
    const week = text.filter((s) => Date.now() - new Date(s.createdAt).getTime() < 7 * 86400000).length;
    const parts = [`${text.length} note${text.length === 1 ? '' : 's'}`, `${topics.size} topic${topics.size === 1 ? '' : 's'}`, `${sites.size} site${sites.size === 1 ? '' : 's'}`, `growing since ${when(first, { month: 'long', year: 'numeric' })}`];
    if (week) parts.push(`+${week} this week`);
    if (libraryMode) parts.push(libraryMode === 'meaning' ? 'searchable by meaning' : 'searchable by words');
    $('libraryLine').replaceChildren(el('a', { href: 'pkg.html', textContent: 'Your PKG' }), document.createTextNode(': '), document.createTextNode(parts.join(' · ')));
  }

  // snippets.html#<id> opens that snippet (the panel's "Open in snippets" links).
  function openFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const s = id && (snippets.find((x) => x.id === id) || jobs.find((x) => x.id === id));
    if (!s) return;
    selectedId = id;
    history.replaceState(null, '', location.pathname);
  }

  async function load() {
    relatedCache.clear();
    snippets = (await listSnippets()).map((s) => ({ ...s, tags: Array.isArray(s.tags) ? s.tags : [] }));
    const all = await ext.storage.local.get(null);
    records = Object.keys(all).filter((k) => k.startsWith('summary:')).map((k) => all[k]).filter((r) => r && r.id);
    const saved = new Set(snippets.map((s) => s.id));
    jobs = records.filter((r) => !(r.snippetId && saved.has(r.snippetId)) && (r.status !== 'done' || r.text)).map(jobItem);
    // Opening the list counts as seeing the results (as the summary history did).
    const unseen = records.filter((r) => r.status !== 'running' && !r.seen).map((r) => r.id);
    if (unseen.length) ext.runtime.sendMessage({ type: 'summary:seen', ids: unseen }).catch(() => {});
    openFromHash();
    if (!selectedId && window.innerWidth > 860) selectedId = (snippets.find((s) => matches(s, '')) || { id: '' }).id;
    if (selectedId && !snippets.some((s) => s.id === selectedId) && !jobs.some((s) => s.id === selectedId)) selectedId = '';
    render();
  }

  function download(name, type, content) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    el('a', { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  for (const b of document.querySelectorAll('[data-group]')) {
    b.addEventListener('click', () => {
      prefs.group = b.dataset.group;
      savePrefs();
      render();
    });
  }
  // Typing searches the library index (by meaning and words) after a short pause.
  let searchTimer = 0;
  $('search').addEventListener('input', () => {
    render();
    clearTimeout(searchTimer);
    const query = $('search').value.trim().toLowerCase();
    if (query.length < 3) {
      ranked = null;
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        const res = await ext.runtime.sendMessage({ type: 'library:search', query, limit: 50 });
        if (res && res.ok !== false && $('search').value.trim().toLowerCase() === query) {
          ranked = { query, ids: res.results.map((r) => r.note.id), mode: res.mode };
          render();
        }
      } catch {
        // keep the word-match results
      }
    }, 300);
  });
  ext.runtime.sendMessage({ type: 'library:status' }).then((st) => {
    libraryMode = (st && st.mode) || '';
    renderLibraryLine();
  }).catch(() => {});

  window.addEventListener('hashchange', () => {
    openFromHash();
    render();
  });

  $('exportJson').addEventListener('click', () => download(`soroagent-snippets-${stamp()}.json`, 'application/json', JSON.stringify(snippets, null, 2)));
  $('exportMd').addEventListener('click', () => {
    const md = snippets
      .map((s) => {
        const tags = s.tags.length ? `\n${s.tags.map((t) => `#${t}`).join(' ')}` : '';
        const body = kindOf(s) === 'summary' || kindOf(s) === 'research' ? stripThinking(s.text) : s.text.split('\n').map((l) => `> ${l}`).join('\n');
        const extra = s.research && kindOf(s) !== 'research' ? `\n\n### Research\n${stripThinking(s.research.text)}\n\n${(s.research.sources || []).map((src, i) => `${i + 1}. [${src.title}](${src.url})`).join('\n')}` : '';
        return `## ${s.title}\n\n${s.url}  \n_${when(s.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}_${tags}\n\n${body}${extra}\n`;
      })
      .join('\n---\n\n');
    download(`soroagent-snippets-${stamp()}.md`, 'text/markdown', `# soroagent snippets\n\n${md}`);
  });
  $('import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const items = JSON.parse(await file.text());
      const added = await importSnippets(Array.isArray(items) ? items : []);
      alert(`Imported ${added} snippet${added === 1 ? '' : 's'}.`);
    } catch (err) {
      alert(`Couldn't import that file: ${err.message}`);
    }
  });
  $('clear').addEventListener('click', async () => {
    if ((snippets.length || records.length) && confirm(`Delete all ${snippets.length} snippets and the summary history? Download a backup first if you want to keep them.`)) {
      await deleteSnippets(snippets.map((s) => s.id));
      if (records.length) await ext.runtime.sendMessage({ type: 'summary:delete', ids: records.map((r) => r.id) });
      // Reading time, what's-new memory and the knowledge graph go with the PKG.
      const all = await ext.storage.local.get(null);
      await ext.storage.local.remove(['pkgDwell', 'seenLists', ...Object.keys(all).filter((k) => /^kg(x|cmp|page):/.test(k) || k === 'kgEdits' || k === 'kgState')]);
    }
  });

  let pending = 0;
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(isSnippetChange(changes) || Object.keys(changes).some((k) => k.startsWith('summary:')))) return;
    clearTimeout(pending);
    pending = setTimeout(load, 300); // running summaries save every ~1.5 s
  });

  load();
})();

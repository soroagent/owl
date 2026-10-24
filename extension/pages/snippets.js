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
  let prefs = { group: 'day', kind: 'all' };
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
  let settings = {};
  // The prompts for the site a snippet came from, with the system prompt from settings if any.
  const promptsForUrl = (url) => {
    const id = S.promptSetForHost(hostOf(url));
    const persona = S.customPersona(settings, id);
    return S.promptsFor(id, persona ? { persona } : null);
  };
  const research = new Map(); // snippet id -> { status, text, error, sources } while running
  // Search by meaning and words (the library index), ranked; null when the box is empty.
  let ranked = null; // { query, ids: [...], mode }
  const relatedCache = new Map(); // snippet id -> related notes

  const KIND_LABEL = { summary: 'Summary', selection: 'Selection', page: 'Page', research: 'Research', screenshot: 'Screenshot', deliverable: 'Created', read: 'Read' };
  // Kinds with a section of their own, kept out of the text views.
  const SECTIONS = ['screenshot'];
  const topicPicks = new Map(); // snippet id -> { status: 'loading' | 'ready' | 'error', topics, error, draft }
  if (!['all', ...SECTIONS].includes(prefs.kind)) prefs.kind = 'all'; // e.g. the old Summaries / Research views
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
    const kind = kindOf(s);
    // Screenshots have their own section and stay out of the text views.
    if (SECTIONS.includes(prefs.kind) || SECTIONS.includes(kind)) {
      if (prefs.kind !== kind) return false;
    }
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

  function renderShot(s) {
    const host = hostOf(s.url);
    const shot = el('button', { type: 'button', className: 'shot' }, [
      el('img', { src: s.image, alt: '', loading: 'lazy', decoding: 'async' }),
      el('div', { className: 'card-title', textContent: s.title || s.pageTitle || 'Screenshot' }),
      el('div', { className: 'meta' }, [host ? siteBadge(host) : '', el('span', { textContent: when(s.createdAt, { hour: 'numeric', minute: '2-digit' }) })]),
    ]);
    shot.setAttribute('aria-current', String(s.id === selectedId));
    shot.addEventListener('click', () => select(s.id));
    return shot;
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
        textContent: prefs.kind === 'screenshot'
          ? 'No screenshots yet. Use Screenshot in the soroagent panel (or right-click a page) to take one.'
          : snippets.some((s) => !SECTIONS.includes(kindOf(s)))
          ? libraryMode === 'words' && $('search').value.trim()
            ? 'Nothing uses those words. To also find notes by meaning (the same idea in other words), install a free embedding model: ollama pull nomic-embed-text'
            : 'No snippets match.'
          : 'No snippets yet. Every summary you make is saved here automatically.',
      }));
      $('list').classList.remove('gallery');
      return;
    }
    $('list').classList.toggle('gallery', prefs.kind === 'screenshot');
    const nodes = [];
    if (rankedBy) {
      nodes.push(el('div', { className: 'group-head' }, [el('span', { textContent: `Best matches${rankedBy.mode === 'meaning' ? ' · by meaning and words' : ''}` }), el('small', { textContent: String(visible.length) })]));
      for (const s of visible) nodes.push(kindOf(s) === 'screenshot' ? renderShot(s) : renderCard(s));
      $('list').replaceChildren(...nodes);
      return;
    }
    for (const group of groups(visible)) {
      nodes.push(el('div', { className: 'group-head' }, [el('span', { textContent: group.label }), el('small', { textContent: String(group.items.length) })]));
      for (const s of group.items) nodes.push(kindOf(s) === 'screenshot' ? renderShot(s) : renderCard(s));
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

    if (kind === 'screenshot') {
      renderShotReader(s, reader, [back, meta, el('h1', { textContent: s.title || s.pageTitle || 'Screenshot' })]);
      return;
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

    // Research: further reading from the web, attached to this snippet.
    nodes.push(el('div', { className: 'section-title', textContent: 'Research' }));
    const live = research.get(s.id);
    if (live && live.status === 'running') {
      nodes.push(el('div', { className: 'working', textContent: live.statusText || 'Researching on the web…' }));
      if (live.sources) nodes.push(sourcesList(live.sources));
      if (live.text) nodes.push(el('div', { className: 'prose' }, markdown(live.text, s.url)));
    } else if (s.research && kind !== 'research') {
      nodes.push(el('div', { className: 'meta', textContent: `Searched “${s.research.query || ''}” · ${when(s.research.at, { dateStyle: 'medium', timeStyle: 'short' })}` }));
      nodes.push(el('div', { className: 'prose' }, markdown(s.research.text, s.url)));
      nodes.push(el('div', { className: 'section-title', textContent: 'Sources' }), sourcesList(s.research.sources));
    } else if (kind === 'research' && s.research) {
      nodes.push(sourcesList(s.research.sources));
    } else if (!topicPicks.has(s.id)) {
      nodes.push(el('p', { className: 'muted', textContent: 'Look this topic up on the web: soroagent searches, reads the top sources and writes a cited brief that goes beyond this snippet.' }));
    }
    if (topicPicks.has(s.id) && !(live && live.status === 'running')) nodes.push(...topicPicker(s));
    if (live && live.status === 'error') nodes.push(el('div', { className: 'problem', textContent: live.error }));

    const actions = el('div', { className: 'reader-actions' });
    if (kind !== 'research' && !(live && live.status === 'running') && !topicPicks.has(s.id)) {
      const go = el('button', { type: 'button', className: 'btn primary', textContent: s.research ? 'Research again' : 'Research this further' });
      go.addEventListener('click', () => pickTopic(s));
      actions.append(go);
    }
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

  function shotFileName(s) {
    const name = (hostOf(s.url) || 'screenshot').replace(/[^a-z0-9.-]+/gi, '-');
    return `soroagent-${name}-${String(s.createdAt).slice(0, 19).replace(/[T:]/g, '-')}.jpg`;
  }

  function renderShotReader(s, reader, nodes) {
    const img = el('img', { className: 'shot-full', src: s.image, alt: `Screenshot of ${s.pageTitle || s.url}` });
    // Full size in a new tab (browsers block opening data: URLs directly).
    img.addEventListener('click', async () => window.open(URL.createObjectURL(await (await fetch(s.image)).blob()), '_blank'));
    nodes.push(img);
    const actions = el('div', { className: 'reader-actions' });
    const save = el('a', { className: 'btn primary', href: s.image, download: shotFileName(s), textContent: 'Download' });
    const copy = el('button', { type: 'button', className: 'btn', textContent: 'Copy image' });
    copy.addEventListener('click', async () => {
      try {
        // The clipboard takes PNG, so redraw the stored JPEG.
        const bitmap = await createImageBitmap(await (await fetch(s.image)).blob());
        const canvas = el('canvas', { width: bitmap.width, height: bitmap.height });
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy not supported here';
      }
      setTimeout(() => (copy.textContent = 'Copy image'), 1500);
    });
    actions.append(save, copy);
    if (/^https?:/.test(s.url)) actions.append(el('a', { className: 'btn', href: S.safeUrl(s.url), target: '_blank', rel: 'noopener', textContent: 'Open page ↗' }));
    const remove = el('button', { type: 'button', className: 'btn danger', textContent: 'Delete' });
    remove.addEventListener('click', async () => {
      await deleteSnippets([s.id]);
      selectedId = '';
    });
    actions.append(remove);
    nodes.push(actions);
    reader.replaceChildren(...nodes);
  }

  // Before researching, ask what to focus on: topics the model finds in the snippet, the whole
  // snippet, or the reader's own words.
  function pickTopic(s) {
    const pick = { status: 'loading', topics: [], error: '', draft: '' };
    topicPicks.set(s.id, pick);
    renderReader();
    const vars = S.pageVars({ title: s.pageTitle || s.title, url: s.url, text: stripThinking(s.text || s.summary || '').slice(0, 4000) });
    S.askModel(S.buildMessages('researchTopics', vars, promptsForUrl(s.url)), { json: true })
      .then((reply) => Object.assign(pick, { status: 'ready', topics: S.parseTopics(stripThinking(reply)) }))
      .catch((err) => Object.assign(pick, { status: 'error', error: err.message }))
      .finally(() => s.id === selectedId && renderReader());
  }

  function topicPicker(s) {
    const pick = topicPicks.get(s.id);
    const start = (query) => {
      topicPicks.delete(s.id);
      startResearch(s, query);
    };
    const heading = el('p', {
      textContent: pick.status === 'loading' ? 'Finding topics in this snippet…'
        : pick.status === 'error' ? `Couldn't suggest topics (${pick.error}). Research everything, or type your own:`
        : pick.topics.length ? 'What should the research focus on? Pick a topic, or research everything:' : 'No clear topics found. Research everything, or type your own:',
      className: pick.status === 'loading' ? 'working' : '',
    });
    const topics = el('div', { className: 'topics' });
    for (const topic of pick.topics) {
      const button = el('button', { type: 'button', className: 'topic', textContent: topic });
      button.addEventListener('click', () => start(topic));
      topics.append(button);
    }
    const everything = el('button', { type: 'button', className: 'topic all', textContent: 'Everything in this snippet' });
    everything.addEventListener('click', () => start(''));
    topics.append(everything);
    const input = el('input', { type: 'text', placeholder: 'Or type your own topic…', value: pick.draft, maxLength: 120 });
    input.setAttribute('aria-label', 'Research topic');
    input.addEventListener('input', () => (pick.draft = input.value));
    const go = el('button', { type: 'button', className: 'btn primary small', textContent: 'Research' });
    go.addEventListener('click', () => input.value.trim() && start(input.value.trim()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && input.value.trim()) start(input.value.trim());
    });
    const cancel = el('button', { type: 'button', className: 'btn small', textContent: 'Cancel' });
    cancel.addEventListener('click', () => {
      topicPicks.delete(s.id);
      renderReader();
    });
    return [heading, topics, el('div', { className: 'topic-own' }, [input, go, cancel])];
  }

  // Research runs as a background job, so it finishes even if this page is closed; the
  // result is attached to the snippet.
  function startResearch(s, query = '') {
    const job = { status: 'running', statusText: query ? `Searching the web for “${query}”…` : 'Choosing what to search for…', text: '', sources: null };
    research.set(s.id, job);
    renderReader();
    const vars = S.pageVars({ title: s.pageTitle || s.title, url: s.url, text: stripThinking(s.text).slice(0, 4000) });
    const port = ext.runtime.connect({ name: 'summary' });
    let frame = 0;
    const refresh = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), s.id === selectedId && renderReader()));
    };
    port.onMessage.addListener((msg) => {
      if (msg.type === 'status') job.statusText = msg.text;
      else if (msg.type === 'sources') job.sources = msg.sources;
      else if (msg.type === 'token') job.text += msg.text;
      else if (msg.type === 'done') {
        research.delete(s.id);
        port.disconnect();
      } else if (msg.type === 'error') {
        Object.assign(job, { status: 'error', error: `${(msg.record && msg.record.error) || 'Research failed.'} ${(msg.record && msg.record.hint) || ''}` });
        port.disconnect();
      }
      refresh();
    });
    port.postMessage({
      type: 'start',
      job: {
        kind: 'research',
        label: `Research: ${s.title}`,
        url: s.url,
        pageTitle: s.pageTitle || s.title,
        site: hostOf(s.url),
        snippetId: s.id,
        fallbackQuery: s.title,
        query,
        queryMessages: query ? null : S.buildMessages('researchQuery', vars, promptsForUrl(s.url)),
        final: S.buildMessages('research', S.pageVars(
          { title: s.title, url: s.url, text: S.JOB_PLACEHOLDERS.sources },
          { context: stripThinking(s.text).slice(0, 3000), question: S.JOB_PLACEHOLDERS.query }
        ), promptsForUrl(s.url)),
      },
    });
  }

  // "Related in your library": notes about the same thing, found by meaning and words.
  function relatedSection(s) {
    const box = el('div', { className: 'related-notes' });
    const show = (list) => {
      if (!list.length) return box.replaceChildren();
      box.replaceChildren(
        el('div', { className: 'section-title', textContent: 'Related in your library' }),
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
    if (chat) chat.refresh();
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
    const shots = snippets.filter((s) => kindOf(s) === 'screenshot').length;
    $('shotCount').textContent = shots ? `(${shots})` : '';
    for (const b of document.querySelectorAll('[data-group]')) b.setAttribute('aria-pressed', String(b.dataset.group === prefs.group));
    for (const b of document.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', String(b.dataset.kind === prefs.kind));
    renderFilters();
    renderLibraryLine();
    if (ranked && ranked.query === query) visible.sort((a, b) => ranked.ids.indexOf(a.id) - ranked.ids.indexOf(b.id));
    renderList(visible, ranked && ranked.query === query ? ranked : null);
    renderReader();
  }

  // The library at a glance: it grows with everything you read.
  let libraryMode = '';
  function renderLibraryLine() {
    const text = snippets.filter((s) => kindOf(s) !== 'screenshot');
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
    $('libraryLine').replaceChildren(el('b', { textContent: 'Your library: ' }), document.createTextNode(parts.join(' · ')));
  }

  // snippets.html#<id> opens that snippet (the panel links new screenshots this way).
  function openFromHash() {
    const view = location.hash.match(/^#view=(\w+)$/);
    if (view && SECTIONS.includes(view[1])) {
      prefs.kind = view[1];
      selectedId = '';
      history.replaceState(null, '', location.pathname);
      return;
    }
    const id = decodeURIComponent(location.hash.slice(1));
    const s = id && (snippets.find((x) => x.id === id) || jobs.find((x) => x.id === id));
    if (!s) return;
    selectedId = id;
    prefs.kind = SECTIONS.includes(kindOf(s)) ? kindOf(s) : 'all';
    history.replaceState(null, '', location.pathname);
  }

  async function load() {
    relatedCache.clear();
    settings = await S.getSettings();
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
  for (const b of document.querySelectorAll('[data-kind]')) {
    b.addEventListener('click', () => {
      prefs.kind = prefs.kind === b.dataset.kind ? 'all' : b.dataset.kind; // Screenshots toggles its section
      savePrefs();
      const first = snippets.find((s) => matches(s, ''));
      if (window.innerWidth > 860) selectedId = first ? first.id : '';
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
      .filter((s) => !SECTIONS.includes(kindOf(s)))
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
    }
  });

  let pending = 0;
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(isSnippetChange(changes) || Object.keys(changes).some((k) => k.startsWith('summary:')))) return;
    clearTimeout(pending);
    pending = setTimeout(load, 300); // running summaries save every ~1.5 s
  });

  // "Ask your library": the chat console at the bottom of the page; it can focus on the open note.
  const chat = S.mountLibraryChat({
    getFocus: () => snippets.find((s) => s.id === selectedId && kindOf(s) !== 'screenshot') || null,
    placeholder: 'Ask your library… (Ctrl/⌘ K)',
  });
  if (new URLSearchParams(location.search).has('chat')) chat.open();

  load().then(() => chat.refresh());
})();

// Summary jobs run in the background worker, not in the page. Leaving or closing the page
// doesn't stop them: the result lands in the summary history, the toolbar badge counts results
// you haven't seen, and the page shows them when you come back.
//
// Records are stored as "summary:<id>" in chrome.storage.local:
//   { id, createdAt, finishedAt, url, pageTitle, site, label, kind, fingerprint, model,
//     status: 'running' | 'done' | 'error' | 'stopped' | 'interrupted', statusText, text, error, hint, seen }
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});
  const PREFIX = 'summary:';
  const MAX_RECORDS = 300;

  // ---------------------------------------------------------------------------
  // Pure helpers (unit tested)
  // ---------------------------------------------------------------------------

  /** Replaces `placeholder` in every message's content (used to insert merged notes). */
  function fillPlaceholder(messages, placeholder, text) {
    return messages.map((m) => ({ ...m, content: String(m.content).split(placeholder).join(text) }));
  }

  /** Ids to delete so that at most `max` records remain, oldest first; running jobs are kept. */
  function idsToPrune(records, max = MAX_RECORDS) {
    const sorted = [...records].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return sorted.slice(max).filter((r) => r.status !== 'running').map((r) => r.id);
  }

  /** Records a page should show when it opens: running jobs and unseen results for its URL. */
  function pendingForUrl(records, url) {
    return records
      .filter((r) => r.url === url && (r.status === 'running' || !r.seen))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  const unseenCount = (records) => records.filter((r) => r.status !== 'running' && !r.seen).length;

  // ---------------------------------------------------------------------------
  // Runner
  // ---------------------------------------------------------------------------

  // Placeholders the page leaves in job messages for things only known while the job runs.
  // (Defined in shared/prompts.js, which the page and the worker both load.)
  const { summary: SUMMARY_PLACEHOLDER, sources: SOURCES_PLACEHOLDER, query: QUERY_PLACEHOLDER } = soroagent.JOB_PLACEHOLDERS || {};

  /**
   * opts: { ext, runChat({ messages, model, signal, onToken, onThinking, json }) → text, errorPayload(err), getSettings,
   * }
   */
  function createJobRunner({ ext, runChat, errorPayload, getSettings }) {
    const jobs = new Map(); // id -> { record, controller, ports: Set }
    let keepAlive = 0;

    const key = (id) => PREFIX + id;
    const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

    async function allRecords() {
      const all = await ext.storage.local.get(null);
      return Object.keys(all).filter((k) => k.startsWith(PREFIX)).map((k) => all[k]);
    }

    async function save(record) {
      await ext.storage.local.set({ [key(record.id)]: record });
    }

    async function updateBadge() {
      try {
        const count = unseenCount(await allRecords());
        await ext.action.setBadgeText({ text: count ? String(count) : '' });
        if (ext.action.setBadgeBackgroundColor) await ext.action.setBadgeBackgroundColor({ color: '#4f46e5' });
      } catch {
        // badges are best-effort
      }
    }

    // Chrome stops an idle service worker after ~30 s; extension API calls keep it alive
    // while a model is loading or thinking.
    function holdOpen() {
      if (!keepAlive) keepAlive = setInterval(() => ext.runtime.getPlatformInfo().catch(() => {}), 20000);
    }
    function release() {
      if (!jobs.size && keepAlive) {
        clearInterval(keepAlive);
        keepAlive = 0;
      }
    }

    function broadcast(job, msg) {
      for (const port of job.ports) {
        try {
          port.postMessage(msg);
        } catch {
          job.ports.delete(port);
        }
      }
    }

    async function prune() {
      const ids = idsToPrune(await allRecords());
      if (ids.length) await ext.storage.local.remove(ids.map(key));
    }

    async function run(job, spec) {
      const { record } = job;
      let lastSave = 0;
      const progress = (text) => {
        record.statusText = text;
        broadcast(job, { type: 'status', text });
        save(record);
      };
      try {
        let final = spec.final;
        if (record.kind === 'research') final = await prepareResearch(job, spec, progress);
        // Long content: notes on each part first, then one summary of all the notes.
        const notes = [];
        for (let i = 0; i < (spec.notes || []).length; i++) {
          progress(`Reading part ${i + 1} of ${spec.notes.length}…`);
          const text = await runChat({ messages: spec.notes[i], model: record.model, signal: job.controller.signal });
          notes.push(`--- Part ${i + 1} ---\n${text}`);
        }
        if (notes.length) progress('Writing the summary…');
        if (notes.length) final = fillPlaceholder(final, spec.placeholder, notes.join('\n\n'));
        record.text = '';
        // A summary already written for this page (prepared on page visit) is just recorded.
        const text = spec.preset ? spec.preset : await runChat({
          messages: final,
          model: record.model,
          signal: job.controller.signal,
          onThinking: () => broadcast(job, { type: 'thinking' }),
          onToken: (token) => {
            record.text += token;
            broadcast(job, { type: 'token', text: token });
            // Save now and then so the history page shows progress (and the worker stays alive).
            if (Date.now() - lastSave > 1500) {
              lastSave = Date.now();
              save(record);
            }
          },
        });
        if (spec.preset) broadcast(job, { type: 'token', text });
        Object.assign(record, { text, status: 'done', statusText: '', finishedAt: new Date().toISOString(), seen: job.ports.size > 0 });
        // Every summary is kept as a snippet automatically; research is attached to its snippet.
        if (record.kind === 'research') await attachResearch(record, spec);
        else if (spec.saveMessages) record.snippetId = await autoSave(record, spec);
      } catch (err) {
        const stopped = err && err.name === 'AbortError';
        const payload = stopped ? {} : errorPayload(err);
        Object.assign(record, {
          status: stopped ? 'stopped' : 'error',
          statusText: '',
          error: stopped ? 'Stopped.' : payload.error,
          hint: payload.hint || '',
          finishedAt: new Date().toISOString(),
          seen: stopped || job.ports.size > 0,
        });
      }
      await save(record);
      broadcast(job, { type: record.status === 'done' ? 'done' : 'error', record });
      jobs.delete(record.id);
      release();
      updateBadge();
    }

    // Research: a search query (from the model unless given), then the web sources it finds.
    async function prepareResearch(job, spec, progress) {
      const { record } = job;
      let query = String(spec.query || '').trim();
      if (!query && spec.queryMessages) {
        progress('Choosing what to search for…');
        try {
          const reply = await runChat({ messages: spec.queryMessages, model: record.model, signal: job.controller.signal, json: true });
          const json = soroagent.parseJsonLoose(reply);
          query = String((json && json.query) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        } catch (err) {
          if (err && err.name === 'AbortError') throw err;
        }
      }
      query = query || String(spec.fallbackQuery || record.pageTitle || '').slice(0, 120);
      record.query = query;
      const settings = await getSettings();
      const sources = await soroagent.gatherSources(query, {
        count: 5,
        engine: settings.researchEngine,
        searxUrl: settings.searxUrl,
        signal: job.controller.signal,
        onStatus: progress,
      });
      record.sources = sources.map((src) => ({ title: src.title, url: src.url }));
      record.engine = sources.engine || '';
      broadcast(job, { type: 'sources', query, sources: record.sources });
      progress(`Writing the research brief from ${sources.length} sources…`);
      return fillPlaceholder(fillPlaceholder(spec.final, SOURCES_PLACEHOLDER, soroagent.formatSources(sources)), QUERY_PLACEHOLDER, query);
    }

    async function autoSave(record, spec) {
      let meta = soroagent.parseSnippetMeta('', record.pageTitle || record.label);
      // The archivist keeps one vocabulary: the model sees the library's existing tags and reuses
      // them, and its answer is mapped onto them (so "AI Agents" files under "ai-agents").
      const vocabulary = soroagent.tagVocabulary(await soroagent.listSnippets(), 40);
      try {
        const messages = fillPlaceholder(spec.saveMessages, SUMMARY_PLACEHOLDER, record.text.slice(0, 6000));
        if (vocabulary.length) {
          const last = messages[messages.length - 1];
          last.content += `\n\nTags already in the user's library: ${vocabulary.map((v) => v.tag).join(', ')}.\nReuse these tags whenever they fit; add a new tag only for a genuinely new topic.`;
        }
        const reply = await runChat({ messages, model: record.model, json: true });
        meta = soroagent.parseSnippetMeta(reply, record.pageTitle || record.label);
        meta.tags = soroagent.canonicalTags(meta.tags, vocabulary);
      } catch {
        // Saved with the page title if labelling fails.
      }
      meta.tags = soroagent.withSourceTags(meta.tags, spec.sourceTags); // e.g. linkedin-post
      const snippet = await soroagent.upsertSnippet({
        ...meta,
        kind: 'summary',
        source: 'summary',
        text: record.text,
        url: record.url,
        pageTitle: record.pageTitle,
        site: record.site,
        model: record.model,
        summaryId: record.id,
        label: record.label,
        dedupeKey: record.fingerprint ? `summary:${record.url}:${record.fingerprint}` : '',
      });
      return snippet.id;
    }

    async function attachResearch(record, spec) {
      const research = { text: record.text, query: record.query, sources: record.sources || [], at: record.finishedAt, model: record.model, summaryId: record.id };
      if (spec.snippetId && (await soroagent.updateSnippet(spec.snippetId, { research }))) {
        record.snippetId = spec.snippetId;
        return;
      }
      const snippet = await soroagent.addSnippet({
        kind: 'research',
        source: 'research',
        title: `Research: ${record.query || record.pageTitle}`.slice(0, 120),
        summary: '',
        tags: ['research'],
        text: record.text,
        url: record.url,
        pageTitle: record.pageTitle,
        model: record.model,
        research,
      });
      record.snippetId = snippet.id;
    }

    /** Starts a summary job. spec: { url, pageTitle, site, label, kind, fingerprint, model, notes, final, placeholder, preset } */
    async function start(spec, port) {
      const record = {
        id: newId(),
        createdAt: new Date().toISOString(),
        finishedAt: '',
        url: spec.url,
        pageTitle: spec.pageTitle || '',
        site: spec.site || '',
        label: spec.label || 'Summary',
        kind: spec.kind || 'page',
        snippetId: spec.snippetId || '',
        query: spec.query || '',
        sources: [],
        fingerprint: spec.fingerprint || '',
        model: spec.model || '',
        status: 'running',
        statusText: '',
        text: '',
        error: '',
        hint: '',
        seen: false,
      };
      const job = { record, controller: new AbortController(), ports: new Set(port ? [port] : []) };
      jobs.set(record.id, job);
      holdOpen();
      await save(record);
      await prune();
      if (port) port.postMessage({ type: 'started', id: record.id });
      run(job, spec); // continues even if the page goes away
      return record.id;
    }

    /** Re-connects a page to a running job: sends what's been written so far, then live updates. */
    function attach(id, port) {
      const job = jobs.get(id);
      if (!job) return false;
      job.ports.add(port);
      port.postMessage({ type: 'snapshot', record: job.record });
      return true;
    }

    function detach(port) {
      for (const job of jobs.values()) job.ports.delete(port);
    }

    function stop(id) {
      const job = jobs.get(id);
      if (job) job.controller.abort();
    }

    async function markSeen(ids) {
      const all = await ext.storage.local.get(ids.map(key));
      const updates = {};
      for (const id of ids) {
        const record = all[key(id)];
        if (record && !record.seen) updates[key(id)] = { ...record, seen: true };
      }
      if (Object.keys(updates).length) await ext.storage.local.set(updates);
      updateBadge();
    }

    async function remove(ids) {
      ids.forEach(stop);
      await ext.storage.local.remove(ids.map(key));
      updateBadge();
    }

    // The newest finished summary of exactly this content, if any (to avoid re-summarizing).
    async function find(url, fingerprint) {
      if (!fingerprint) return null;
      const matches = (await allRecords())
        .filter((r) => r.url === url && r.fingerprint === fingerprint && r.status === 'done')
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return matches[0] || null;
    }

    async function forUrl(url) {
      return pendingForUrl(await allRecords(), url).map((r) => ({ ...r, live: jobs.has(r.id) }));
    }

    // After a browser or worker restart, jobs that were running can't resume.
    async function recover() {
      const stale = (await allRecords()).filter((r) => r.status === 'running' && !jobs.has(r.id));
      if (stale.length) {
        const updates = {};
        for (const r of stale) {
          updates[key(r.id)] = {
            ...r,
            status: 'interrupted',
            error: 'This summary was interrupted when the browser stopped soroagent.',
            hint: 'Run Summarize again on the page.',
            finishedAt: new Date().toISOString(),
          };
        }
        await ext.storage.local.set(updates);
      }
      updateBadge();
    }

    return { start, attach, detach, stop, markSeen, remove, find, forUrl, recover, updateBadge };
  }

  Object.assign(soroagent, {
    createJobRunner,
    fillPlaceholder,
    idsToPrune,
    pendingForUrl,
    unseenCount,
    SUMMARY_PREFIX: PREFIX,
  });
})(globalThis);

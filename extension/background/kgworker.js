// The knowledge graph worker: while the browser is idle, the AI reads the snippets one at a time and
// files their entities, relations and claims (shared/kg.js has the pure parts and the storage
// layout), compares new claims with older ones, and keeps the topic pages of the entities you read
// most about up to date. It stops as soon as you're back. "Build now" on the PKG page runs it at once.
(function (root) {
  'use strict';

  const soroagent = root.soroagent;

  /**
   * runChat(messages, { json }) → reply text, using the user's AI.
   * Returns { run({ manual }), writePage(key), status(), stop() }.
   */
  function createKnowledgeWorker({ ext, runChat, getSettings, getModel = async () => ({}), onProblem = () => {} }) {
    const K = soroagent.kg;
    let running = null;
    let stopRequested = false;
    let pausedUntil = 0; // after the AI was unreachable
    let userActive = false;

    const setState = (state) => ext.storage.local.set({ kgState: { ...state, at: new Date().toISOString() } });

    async function loadAll() {
      const all = await ext.storage.local.get(null);
      const notes = [];
      const extractions = {};
      const comparisons = {};
      const pages = {};
      for (const [k, v] of Object.entries(all)) {
        if (k.startsWith('snippet:') && v && v.id) notes.push(v);
        else if (k.startsWith('kgx:')) extractions[k.slice(4)] = v;
        else if (k.startsWith('kgcmp:')) comparisons[k.slice(6)] = v;
        else if (k.startsWith('kgpage:')) pages[k.slice(7)] = v;
      }
      return { notes, extractions, comparisons, pages, edits: all.kgEdits || K.EMPTY_EDITS, settings: all.settings || {} };
    }

    async function prompts() {
      const settings = await getSettings();
      const persona = soroagent.customPersona ? soroagent.customPersona(settings, 'default') : '';
      return persona ? { persona } : {};
    }

    async function extractOne(note, set) {
      const text = K.noteText(note);
      const messages = soroagent.buildMessages('extract', { title: note.title || note.pageTitle || '', url: note.url || '', content: text }, set);
      const reply = await runChat(messages, { json: true });
      const x = K.parseExtraction(reply, text);
      await ext.storage.local.set({ [`kgx:${note.id}`]: { v: K.VERSION, at: new Date().toISOString(), hash: K.textHash(text), ...x } });
      return x;
    }

    async function compareOne(noteId, data, set) {
      const kg = K.buildKG(data);
      const input = K.compareInput(kg, noteId, new Map(data.notes.map((n) => [n.id, n])));
      let pairs = [];
      if (input) {
        const reply = await runChat(soroagent.buildMessages('compareClaims', { content: input.content, context: input.context }, set), { json: true });
        // Each candidate is checked on its own: small models see contradictions in anything on the same topic.
        for (const p of K.parseComparison(reply, input.newIds, input.oldIds).slice(0, 5)) {
          const a = kg.claims.get(p.a);
          const b = kg.claims.get(p.b);
          const ask = (first, second) => runChat(soroagent.buildMessages('checkPair', { context: `${first.text} (${K.day(first.at)})`, content: `${second.text} (${K.day(second.at)})` }, set), { json: true }).then(K.parseCheck);
          // Asked both ways round; kept only when both answers agree.
          const rel = await ask(b, a);
          if (rel && rel === (await ask(a, b))) pairs.push({ ...p, rel });
        }
      }
      await ext.storage.local.set({ [`kgcmp:${noteId}`]: { at: new Date().toISOString(), pairs } });
      return pairs;
    }

    /** Writes (or rewrites) one entity's topic page. */
    async function writePage(key, data = null) {
      data = data || (await loadAll());
      const kg = K.buildKG(data);
      const ent = kg.entities.get(key);
      const input = K.topicPageInput(kg, key, new Map(data.notes.map((n) => [n.id, n])));
      if (!ent || !input) return null;
      const reply = await runChat(soroagent.buildMessages('topicPage', { question: input.question, content: input.content }, await prompts()), { json: false });
      const page = { at: new Date().toISOString(), basis: K.pageBasis(ent), text: soroagent.stripThinking(reply).trim(), cites: input.cites, name: ent.name };
      await ext.storage.local.set({ [`kgpage:${key}`]: page });
      return page;
    }

    const shouldStop = (manual) => stopRequested || (!manual && userActive);

    async function work({ manual = false } = {}) {
      const settings = await getSettings();
      if (!manual && (!soroagent.autoOn(settings, 'knowledgeGraph') || !settings.onboarded || Date.now() < pausedUntil)) return { skipped: true };
      const set = await prompts();
      let data = await loadAll();
      const queue = K.extractionQueue(data.notes, data.extractions);
      const limit = manual ? 25 : 10;
      const done = { extracted: 0, compared: 0, pages: 0 };
      const total = Math.min(queue.length, limit);
      try {
        for (const note of queue.slice(0, limit)) {
          if (shouldStop(manual)) break;
          await setState({ running: true, step: 'extract', done: done.extracted, total, left: queue.length - done.extracted });
          await extractOne(note, set);
          done.extracted++;
        }
        // New claims against older ones (oldest snippet first, so each is compared with what came before).
        // Not with small models: they see contradictions everywhere.
        data = await loadAll();
        const compare = K.canCompare(await getModel());
        const toCompare = !compare ? [] : data.notes.filter((n) => data.extractions[n.id] && (data.extractions[n.id].claims || []).length && !data.comparisons[n.id])
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        for (const note of toCompare.slice(0, limit)) {
          if (shouldStop(manual)) break;
          await setState({ running: true, step: 'compare', done: done.compared, total: Math.min(toCompare.length, limit) });
          await compareOne(note.id, data, set);
          done.compared++;
          data = await loadAll();
        }
        // Topic pages for the entities read about most, when something new came in.
        const kg = K.buildKG(data);
        const stale = K.rankEntities(kg, { min: 2 }).filter((e) => !data.pages[e.key] || data.pages[e.key].basis !== K.pageBasis(e)).slice(0, manual ? 5 : 3);
        for (const ent of stale) {
          if (shouldStop(manual)) break;
          await setState({ running: true, step: 'pages', done: done.pages, total: stale.length });
          await writePage(ent.key, data);
          done.pages++;
        }
        const left = K.extractionQueue((await loadAll()).notes, (await loadAll()).extractions).length;
        await setState({ running: false, ...done, left, noCompare: !compare });
        return { ...done, left };
      } catch (err) {
        if (err && err.name === 'AbortError') return { stopped: true };
        pausedUntil = Date.now() + 30 * 60000; // the AI is unreachable or failing: try again in half an hour
        onProblem(err);
        await setState({ running: false, ...done, error: (err && err.message) || String(err) });
        return { ...done, error: (err && err.message) || String(err) };
      }
    }

    function run(opts = {}) {
      if (running) return running;
      stopRequested = false;
      running = work(opts).finally(() => (running = null));
      return running;
    }

    return {
      run,
      writePage,
      stop: () => (stopRequested = true),
      setUserActive: (active) => (userActive = active),
      busy: () => Boolean(running),
    };
  }

  soroagent.createKnowledgeWorker = createKnowledgeWorker;
})(globalThis);

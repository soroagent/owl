// Prompt engine and response parsers. The prompt texts live in extension/prompts/:
// default.js for every site, plus one file per site (e.g. x.js) that overrides what it needs.
// See extension/prompts/README.md for actions, placeholders and how to fine-tune them.
//
// Placeholders available to every template:
//   {{persona}}      the persona from the prompt set
//   {{title}}        page title            {{url}}       page URL
//   {{content}}      the text being worked on (page text, posts, selection…)
//   {{page}}         title + URL + content wrapped in <page> tags, with a truncation note
//   {{count}}        number of items (posts) in {{content}}, when the site provides items
//   {{context}}      extra context from the site profile (e.g. "Search results for …")
//   {{note}}         truncation note ("" when nothing was cut)
//   {{question}}     the user's question (ask action only)
//   {{slots}}        the four question slots for this site (questions action; shared/templates.js)
// Pure functions: unit tested without a browser.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  const ACTIONS = Object.freeze(['summarize', 'notes', 'ask', 'webAnswer', 'taskPlan', 'taskReport', 'save', 'questions', 'followUps', 'researchTopics', 'researchQuery', 'research']);
  const PLACEHOLDERS = Object.freeze(['persona', 'title', 'url', 'content', 'page', 'count', 'context', 'note', 'question', 'slots']);
  const promptSets = {}; // set id ("default", "x", …) -> { persona?, <action>: { system?, user? } }

  function checkActions(id, prompts) {
    for (const key of Object.keys(prompts)) {
      if (['persona', 'pages', 'label', 'hosts'].includes(key)) continue;
      if (!ACTIONS.includes(key)) throw new Error(`Prompts "${id}": unknown action "${key}". Known: ${ACTIONS.join(', ')}.`);
    }
  }

  /**
   * Registers the prompts for a site id; called by the files in extension/prompts/.
   * `pages` holds overrides for specific page types (from the site profile's pageInfo().type),
   * e.g. { pages: { thread: { summarize: { user: '…' } } } }.
   */
  function definePrompts(id, prompts) {
    if (!id || typeof prompts !== 'object') throw new Error('definePrompts(id, prompts) needs an id and an object.');
    checkActions(id, prompts);
    for (const [pageType, overrides] of Object.entries(prompts.pages || {})) checkActions(`${id}.pages.${pageType}`, overrides);
    promptSets[id] = prompts;
  }

  // Later sets override earlier ones, per action and per field (system/user).
  function mergeSets(...sets) {
    const merged = {};
    for (const set of sets) {
      if (!set) continue;
      for (const [key, value] of Object.entries(set)) {
        if (key === 'pages' || key === 'label' || key === 'hosts') continue;
        merged[key] = key === 'persona' ? value : { ...(merged[key] || {}), ...value };
      }
    }
    return merged;
  }

  /**
   * Prompts for a site and page type: defaults, then extension/prompts/<siteId>.js, then that
   * file's overrides for the page type, then inline profile overrides.
   */
  function promptsFor(siteId, inline, pageType) {
    const set = siteId && siteId !== 'default' ? promptSets[siteId] : null;
    const forPage = set && set.pages && pageType ? set.pages[pageType] : null;
    return mergeSets(promptSets.default, set, forPage, inline);
  }

  /**
   * The prompt set for a website without a site profile, by its `hosts` (e.g. youtube.com also
   * matches www.youtube.com and m.youtube.com). Returns 'default' when none matches.
   */
  function promptSetForHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    for (const [id, set] of Object.entries(promptSets)) {
      if ((set.hosts || []).some((h) => host === h || host.endsWith(`.${h}`))) return id;
    }
    return 'default';
  }

  /** The built-in prompt sets, for the settings page: [{ id, label, hosts, persona }]. */
  function listPromptSets() {
    return Object.entries(promptSets).map(([id, set]) => ({
      id,
      label: set.label || (id === 'default' ? 'All websites' : id),
      hosts: set.hosts || [],
      persona: set.persona || promptSets.default.persona || '',
    }));
  }

  /**
   * The system prompt (persona) the user wrote in settings for a prompt set, or '' to use the
   * built-in one. A custom default applies to sites that don't have their own persona.
   */
  function customPersona(settings, setId) {
    const custom = (settings && settings.customPrompts) || {};
    if (typeof custom[setId] === 'string' && custom[setId].trim()) return custom[setId].trim();
    const ownPersona = setId !== 'default' && promptSets[setId] && promptSets[setId].persona;
    return ownPersona ? '' : String(custom.default || '').trim();
  }

  function render(template, vars) {
    return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, name) => (vars[name] === undefined ? '' : String(vars[name])));
  }

  /** Placeholder values for a page { title, url, text, truncated }, plus any extras. */
  function pageVars(page, extra = {}) {
    const note = page.condensed
      ? '[This is a long page, condensed to fit: its headings, the start and end of each section, and its most relevant paragraphs. "[…]" marks skipped parts; don\'t guess what they say.]'
      : page.truncated ? '[Content was truncated to fit the model context.]' : '';
    const content = page.text || '';
    return {
      title: page.title || '(untitled)',
      url: page.url || '',
      content,
      note,
      page: `Title: ${page.title || '(untitled)'}\nURL: ${page.url || ''}\n\n<page>\n${content}\n</page>${note ? `\n${note}` : ''}`,
      count: '',
      context: '',
      question: '',
      ...extra,
    };
  }

  /**
   * Builds chat messages for an action. `prompts` is a full set from promptsFor(), or a partial
   * set of overrides; anything missing comes from the default prompts.
   */
  function buildMessages(action, vars, prompts) {
    if (!ACTIONS.includes(action)) throw new Error(`Unknown prompt action: ${action}`);
    const set = mergeSets(promptSets.default, prompts);
    const template = set[action] || {};
    const allVars = { persona: set.persona || '', ...vars };
    const messages = [];
    const system = render(template.system, allVars).trim();
    if (system) messages.push({ role: 'system', content: system });
    if (template.user) messages.push({ role: 'user', content: render(template.user, allVars).trim() });
    return messages;
  }

  // Pulls the first JSON object out of a model reply, tolerating code fences and chatter.
  function parseJsonLoose(text) {
    const cleaned = soroagent.stripThinking(text || '')
      .replace(/```(?:json)?/gi, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // fall through to scanning for a balanced object
    }
    const start = cleaned.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  function parseSnippetMeta(text, fallbackTitle) {
    const json = parseJsonLoose(text) || {};
    const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const tags = Array.isArray(json.tags) ? json.tags : [];
    return {
      title: clean(json.title, 120) || clean(fallbackTitle, 120) || 'Untitled snippet',
      summary: clean(json.summary, 600),
      tags: [...new Set(tags.map((t) => clean(t, 30).toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 4),
    };
  }

  /** Research topics from the model's JSON reply: up to 5 short, distinct phrases. */
  function parseTopics(text) {
    const json = parseJsonLoose(text) || {};
    const list = Array.isArray(json) ? json : Array.isArray(json.topics) ? json.topics : [];
    const seen = new Set();
    const topics = [];
    for (const item of list) {
      const topic = String((item && item.topic) || item || '').replace(/\s+/g, ' ').replace(/^(?:\d+[.)]\s+|[-*•#]\s*)/, '').replace(/^["']+|["'.\s]+$/g, '').trim().slice(0, 80);
      if (topic && !seen.has(topic.toLowerCase())) {
        seen.add(topic.toLowerCase());
        topics.push(topic);
      }
    }
    return topics.slice(0, 5);
  }

  // What kind of page this is, from the page's own metadata (schema.org JSON-LD types, og:type) and
  // the site profile, so suggested questions fit it: how a product works, the background of a news
  // story, the solution in a thread… Each kind comes with what a curious reader would want to know.
  const PAGE_KINDS = {
    product: 'a product page in an online store. The reader is deciding whether to buy: how it works, who it suits, what buyers praise or complain about, how it compares, what is included and what it really costs.',
    news: 'a news story. The reader wants the background, the main people and organizations involved and their roles, why it matters, what happened before and what may happen next.',
    video: 'a video page. The reader wants what the video covers, its main claims or steps, and whether it is worth watching.',
    thread: 'a discussion thread. The reader wants the consensus, the strongest arguments on each side, the best answer or tip, and what remains unresolved.',
    question: 'a Q&A page. The reader wants the accepted or best solution, why it works, caveats, and alternatives.',
    code: 'a code repository, issue or pull request. The reader wants what it does, how to use it, its status and what is blocking it.',
    docs: 'technical documentation. The reader wants how to do the task, the key concepts, a minimal example and common pitfalls.',
    recipe: 'a recipe. The reader wants the steps, timing, substitutions and what could go wrong.',
    reference: 'a reference or encyclopedia article. The reader wants the essentials, the history, the key figures and how it connects to related topics.',
    profile: 'a profile of a person or organization. The reader wants who they are, what they are known for and their recent work.',
    article: 'an article or blog post. The reader wants the main argument, the evidence behind it, what is debatable and where to go deeper.',
    page: 'a web page. The reader wants what it is about, the key points and what to look into next.',
  };
  const LD_KINDS = [
    [/^(product|productgroup|offer|aggregateoffer|car|book)$/, 'product'],
    [/^(newsarticle|reportagenewsarticle|analysisnewsarticle|liveblogposting|backgroundnewsarticle)$/, 'news'],
    [/^(videoobject)$/, 'video'],
    [/^(qapage|question)$/, 'question'],
    [/^(discussionforumposting|socialmediaposting)$/, 'thread'],
    [/^(recipe)$/, 'recipe'],
    [/^(techarticle|apireference|howto)$/, 'docs'],
    [/^(softwaresourcecode|softwareapplication)$/, 'code'],
    [/^(profilepage|person|organization)$/, 'profile'],
    [/^(article|blogposting|scholarlyarticle|report)$/, 'article'],
  ];
  const SITE_KINDS = { amazon: 'product', news: 'news', youtube: 'video', reddit: 'thread', hackernews: 'thread', x: 'thread', stackoverflow: 'question', github: 'code', wikipedia: 'reference', linkedin: 'profile' };

  /**
   * Pure: the kind of page, for suggested questions. info: { ldTypes: [schema.org @type…], ogType,
   * siteId, pageType (the site profile's pageInfo().type), url }. Returns { kind, describe }.
   */
  function pageKind({ ldTypes = [], ogType = '', siteId = '', pageType = '', url = '' } = {}) {
    const types = ldTypes.map((t) => String(t).toLowerCase().replace(/^https?:\/\/schema\.org\//, ''));
    let kind = '';
    // The page's own description of itself wins, in this order (a product page also has an Organization).
    for (const [re, k] of LD_KINDS) if (!kind && types.some((t) => re.test(t))) kind = k;
    if (!kind && /^(product|og:product)/i.test(ogType)) kind = 'product';
    if (!kind && /video/i.test(ogType)) kind = 'video';
    if (!kind && ['thread', 'question', 'video', 'repo', 'profile', 'user'].includes(pageType)) kind = { repo: 'code', user: 'profile' }[pageType] || pageType;
    if (!kind && SITE_KINDS[siteId]) kind = SITE_KINDS[siteId];
    if (!kind && /\/(docs?|documentation|reference|api|guide|manual)(\/|$)/i.test(url)) kind = 'docs';
    if (!kind && /\/(dp|gp\/product|product|products|item|itm|p)\/[^/]+/i.test(url)) kind = 'product';
    if (!kind && /article/i.test(ogType)) kind = 'article';
    kind = kind || 'page';
    return { kind, describe: PAGE_KINDS[kind] };
  }

  /** Pure: placeholder values for the followUps prompt: the page, the question and the answer (trimmed). */
  function followUpVars({ title = '', url = '', question = '', answer = '' } = {}) {
    let text = soroagent.stripThinking(String(answer || '')).replace(/\[\[[^\]]*\]\]/g, '').trim();
    if (text.length > 3000) text = `${text.slice(0, 3000).replace(/\s+\S*$/, '')} […]`;
    return { title: title || '(untitled)', url, question: String(question || '').trim(), content: text, page: '', context: '', note: '', count: '' };
  }

  /** Pure: at most 2 follow-up questions from the model's reply, leaving out ones already asked. */
  function pickFollowUps(text, asked = []) {
    const seen = new Set(asked.map((q) => String(q).toLowerCase().replace(/[?.!\s]+$/, '')));
    return parseQuestions(text).filter((q) => !seen.has(q.toLowerCase().replace(/[?.!\s]+$/, ''))).slice(0, 2);
  }

  /** Pure: suggested questions from the model's JSON reply (3 to 4 short, distinct questions). */
  function parseQuestions(text) {
    const json = parseJsonLoose(text) || {};
    const list = Array.isArray(json) ? json : Array.isArray(json.questions) ? json.questions : [];
    const seen = new Set();
    const out = [];
    for (const item of list) {
      let q = String((item && (item.question || item.q)) || item || '').replace(/\s+/g, ' ').replace(/^(?:\d+[.)]\s+|[-*•]\s*)/, '').replace(/^["']+|["']+$/g, '').trim();
      if (q.length < 8 || q.length > 110) continue;
      if (!/[?.!]$/.test(q)) q += '?';
      if (!seen.has(q.toLowerCase())) {
        seen.add(q.toLowerCase());
        out.push(q);
      }
    }
    return out.slice(0, 4);
  }

  // A question the page can't answer: the model replies [[search: query]] (see the ask prompts).
  const SEARCH_MARK = /^\s*\[\[\s*search\s*:\s*([^\]\n]{2,160}?)\s*\]\]/i;
  const LATE_SEARCH_MARK = /\[\[\s*search\s*:\s*([^\]\n]{2,160}?)\s*\]\]/i;
  // Small models sometimes say so in words instead.
  const NOT_FOUND = /\b(does not|doesn't|do not|don't|did not|didn't|cannot|can't|isn't|is not|aren't|are not|no)\b[^.]{0,60}\b(contain|mention|include|provide|cover|say|state|information|details|data|specif|answer)/i;
  const ABOUT_PAGE = /\b(page|text|article|content|post|posts|document|thread|provided|given|above)\b/i;

  /**
   * Pure: the web search a reply asks for, or ''. replied: the model's whole reply; question: what
   * the user asked (the query when the model said "not on the page" in words). Returns { query, explicit }.
   */
  function parseWebRequest(replied, question = '') {
    const text = String(replied || '').trim();
    const m = text.match(SEARCH_MARK);
    if (m) return { query: m[1].replace(/^["']|["']$/g, '').trim(), explicit: true };
    // Small models sometimes answer what they can, then add the marker at the end: keep their words
    // (shown, without the marker) and still look the rest up.
    const late = text.match(LATE_SEARCH_MARK);
    if (late) return { query: late[1].replace(/^["']|["']$/g, '').trim(), explicit: false, shown: text.replace(LATE_SEARCH_MARK, '').trim() };
    if (text.length < 320 && NOT_FOUND.test(text) && ABOUT_PAGE.test(text) && question.trim()) {
      return { query: String(question).trim().replace(/\?+$/, '').slice(0, 160), explicit: false };
    }
    return { query: '', explicit: false };
  }

  /** Pure: whether the start of a streaming reply could still turn out to be [[search: …]] (hold it back). */
  const mayBeWebRequest = (prefix) => {
    const p = String(prefix || '').trimStart();
    return p.length < 9 ? '[[search:'.startsWith(p.toLowerCase().replace(/\s+/g, '')) || p === '' : /^\[\[\s*search/i.test(p);
  };

  // Markers the page leaves in background-job prompts for text only known while the job runs
  // (the finished summary, the web sources, the search query).
  const JOB_PLACEHOLDERS = Object.freeze({
    summary: '@@SOROAGENT_SUMMARY@@',
    sources: '@@SOROAGENT_SOURCES@@',
    query: '@@SOROAGENT_QUERY@@',
    // Tasks: the page the background read, and what to report from it.
    pageTitle: '@@SOROAGENT_PAGE_TITLE@@',
    pageUrl: '@@SOROAGENT_PAGE_URL@@',
    pageText: '@@SOROAGENT_PAGE_TEXT@@',
    goal: '@@SOROAGENT_GOAL@@',
  });

  Object.assign(soroagent, {
    JOB_PLACEHOLDERS,
    PROMPT_ACTIONS: ACTIONS,
    PROMPT_PLACEHOLDERS: PLACEHOLDERS,
    definePrompts,
    promptsFor,
    promptSet: (id) => promptSets[id] || null,
    promptSetForHost,
    listPromptSets,
    customPersona,
    renderTemplate: render,
    pageVars,
    buildMessages,
    parseJsonLoose,
    parseSnippetMeta,
    parseTopics,
    pageKind,
    parseQuestions,
    followUpVars,
    pickFollowUps,
    parseWebRequest,
    mayBeWebRequest,
  });
})(globalThis);

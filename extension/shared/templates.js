// Question templates: the suggested questions on each site follow four slots in the same order,
// Gist · Understand · Check · Next, so readers learn where to look. Each site (and page type) says
// what the slots mean there: the model writes the four questions from the slot patterns, filling the
// [brackets] from the page; without a model, the plain versions are shown. Approved by the owner
// 2026-10-24 (29 templates). Pure and unit tested; the panels show the slot label on each question.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  const SLOTS = ['Gist', 'Understand', 'Check', 'Next'];

  // [pattern for the model, plain question shown without a model]
  const T = {
    default: [
      ['What is the bottom line of [this page]?', 'What are the key points of this page?'],
      ['How does [the main idea or thing] work, or what is the background?', 'Explain this page simply, as if I\'m new to the topic.'],
      ['What is missing, debatable or unreliable about [the main claim]?', 'What claims here need checking, and what might be missing?'],
      ['What should I read, compare or do next about [the topic]?', 'What should I look into next?'],
    ],
    youtubeVideo: [
      ['What are the main points of this video, with timestamps?', 'What are the main points of this video, with timestamps?'],
      ['How does [method/claim in the video] actually work?', 'How does the main idea in this video actually work?'],
      ['Is [the creator]\'s claim about [X] backed by evidence?', 'Are the claims in this video backed by evidence?'],
      ['Which part should I watch if I only care about [subtopic]?', 'Which parts of this video are worth watching?'],
    ],
    xPost: [
      ['What is [@handle] actually saying here?', 'What is this post actually saying?'],
      ['What\'s the background to [event/topic] in this post?', 'What\'s the background to this post?'],
      ['Is this claim true, and what do the replies dispute?', 'Is this claim true, and what do the replies dispute?'],
      ['What\'s the strongest reply or counter-argument?', 'What\'s the strongest reply or counter-argument?'],
    ],
    redditThread: [
      ['What\'s the consensus answer in this thread?', 'What\'s the consensus answer in this thread?'],
      ['Why do people recommend [top suggestion]?', 'Why do people recommend the top suggestion?'],
      ['What do the dissenting comments say?', 'What do the dissenting comments say?'],
      ['Which tip in here should I try first for [problem]?', 'Which tip in here should I try first?'],
    ],
    wikipedia: [
      ['Explain [subject] in three sentences.', 'Explain this subject in three sentences.'],
      ['What are the key facts or turning points in [subject]\'s history?', 'What are the key facts or turning points in its history?'],
      ['Which claims here are disputed or need citations?', 'Which claims here are disputed or need citations?'],
      ['How does [subject] connect to [related topic]?', 'What related topics should I read about next?'],
    ],
    amazon: [
      ['What exactly do I get with [product]?', 'What exactly do I get with this product?'],
      ['How does [key feature] work in practice?', 'How does its main feature work in practice?'],
      ['What do the critical reviews complain about most?', 'What do the critical reviews complain about most?'],
      ['How does it compare to [competitor/alternative] on price and quality?', 'How does it compare to the alternatives on price and quality?'],
    ],
    amazonIn: [
      ['What exactly do I get with [product]?', 'What exactly do I get with this product?'],
      ['How does [key feature] work in practice?', 'How does its main feature work in practice?'],
      ['What do the critical reviews complain about most?', 'What do the critical reviews complain about most?'],
      ['Is there a better price for [product] with bank offers, exchange, or on Flipkart?', 'Is there a better price with bank offers, exchange, or on Flipkart?'],
    ],
    linkedinJob: [
      ['What does this [role] really involve day to day?', 'What does this role really involve day to day?'],
      ['What skills and experience matter most for [role]?', 'What skills and experience matter most here?'],
      ['Any red flags in this posting from [company]?', 'Any red flags in this posting?'],
      ['How should I tailor my application for [role] at [company]?', 'How should I tailor my application for this?'],
    ],
    linkedinProfile: [
      ['Who is [name] and what are they known for?', 'Who is this person and what are they known for?'],
      ['What skills and experience stand out in [name]\'s career?', 'What skills and experience stand out here?'],
      ['Any red flags or overstatements in [name]\'s claims?', 'Any red flags or overstatements in these claims?'],
      ['How should I tailor a message to [name]?', 'How should I tailor a message to this person?'],
    ],
    pinterest: [
      ['What is this [project/idea] and what does it take?', 'What is this idea and what does it take?'],
      ['What materials or steps do I need for [project]?', 'What materials or steps do I need?'],
      ['How hard is [project] really, and what usually goes wrong?', 'How hard is this really, and what usually goes wrong?'],
      ['Where can I find a full guide for [project] or buy [item]?', 'Where can I find a full guide or buy this?'],
    ],
    screenTitle: [
      ['What is [title] about, without spoilers?', 'What is this about, without spoilers?'],
      ['Who stars in [title], and who made it?', 'Who stars in it, and who made it?'],
      ['Is [title] worth watching? What do critics and viewers say?', 'Is it worth watching? What do critics and viewers say?'],
      ['What should I watch if I like [title]?', 'What should I watch if I like this?'],
    ],
    appleProduct: [
      ['What\'s new or different about [product]?', 'What\'s new or different about this product?'],
      ['Which [model/configuration] is right for [typical use]?', 'Which model or configuration is right for me?'],
      ['What are the limitations or trade-offs of [product]?', 'What are its limitations or trade-offs?'],
      ['How does [product] compare to [previous model/rival]?', 'How does it compare to the previous model or rivals?'],
    ],
    appleSupport: [
      ['How do I fix [issue]?', 'How do I fix this issue?'],
      ['What causes [issue]?', 'What causes this issue?'],
      ['What if these steps don\'t fix [issue]?', 'What if these steps don\'t work?'],
      ['When should I contact Apple about [issue]?', 'When should I contact Apple about this?'],
    ],
    espn: [
      ['What happened in [game/story], in short?', 'What happened here, in short?'],
      ['What decided the result in [game], or what is the background to [story]?', 'What decided the result, or what is the background?'],
      ['Which stats back that up, and what\'s being overstated?', 'Which stats back that up, and what\'s being overstated?'],
      ['What does this mean for [team/player] next?', 'What does this mean for the team or player next?'],
    ],
    githubRepo: [
      ['What does [repo] do, and who is it for?', 'What does this repository do, and who is it for?'],
      ['How do I install and run [repo]?', 'How do I install and run it?'],
      ['Is [repo] maintained and production-ready?', 'Is it maintained and production-ready?'],
      ['What are the alternatives to [repo]?', 'What are the alternatives?'],
    ],
    githubIssue: [
      ['What\'s the problem or change in [issue/PR]?', 'What\'s the problem or change here?'],
      ['What\'s the root cause of [problem], or the approach of [change]?', 'What\'s the root cause or the approach?'],
      ['What\'s blocking [issue/PR], and are there risks?', 'What\'s blocking it, and are there risks?'],
      ['Is there a workaround for [problem] now?', 'Is there a workaround now?'],
    ],
    ebay: [
      ['What exactly is being sold in [listing], and in what condition?', 'What exactly is being sold, and in what condition?'],
      ['Is [price] fair for [item] in this condition?', 'Is the price fair for this item in this condition?'],
      ['Any red flags in the listing, seller or photos?', 'Any red flags in the listing, seller or photos?'],
      ['What should I ask the seller about [item] before buying?', 'What should I ask the seller before buying?'],
    ],
    roblox: [
      ['What is [game] and how do you play it?', 'What is this game and how do you play it?'],
      ['What costs Robux in [game], and what\'s free?', 'What costs Robux here, and what\'s free?'],
      ['Is [game] suitable for [age], and are there safety concerns?', 'Is this game suitable for kids, and are there safety concerns?'],
      ['What are games similar to [game]?', 'What are similar games?'],
    ],
    quora: [
      ['What\'s the best answer to [question], in short?', 'What\'s the best answer here, in short?'],
      ['Why does the top answer say [claim]?', 'Why does the top answer say what it says?'],
      ['Are the answerers credible, and do the answers agree?', 'Are the answerers credible, and do the answers agree?'],
      ['What do other sources say about [question]?', 'What do other sources say about this?'],
    ],
    aliexpress: [
      ['What exactly do I get with [product], and what are its real specs?', 'What exactly do I get, and what are the real specs?'],
      ['How long will shipping of [product] take to me, and what does it cost?', 'How long will shipping take to me, and what does it cost?'],
      ['What do reviews with photos say about quality? Is the seller reliable?', 'What do reviews with photos say about quality? Is the seller reliable?'],
      ['Is [product] cheaper or better elsewhere?', 'Is this cheaper or better elsewhere?'],
    ],
    spotify: [
      ['What is [album/episode] about?', 'What is this about?'],
      ['What\'s the story behind [album/artist]?', 'What\'s the story behind this?'],
      ['How was [album/episode] received by critics and listeners?', 'How was it received by critics and listeners?'],
      ['What should I listen to next if I like [artist/show]?', 'What should I listen to next if I like this?'],
    ],
    spotifyPlaylist: [
      ['What\'s the mood of [playlist]?', 'What\'s the mood of this playlist?'],
      ['What\'s the story behind the main artists in [playlist]?', 'Who are the main artists here?'],
      ['How were these tracks received by critics and listeners?', 'How were these tracks received?'],
      ['What should I listen to next if I like [playlist]?', 'What should I listen to next if I like this?'],
    ],
    news: [
      ['What\'s the key news or argument in [story]?', 'What\'s the key news or argument here?'],
      ['What\'s the background to [story], and who are the main people involved?', 'What\'s the background, and who are the main people involved?'],
      ['Is this reporting or opinion, and what\'s the other side of [issue]?', 'Is this reporting or opinion, and what\'s the other side?'],
      ['What happens next with [story], and what should I watch for?', 'What happens next, and what should I watch for?'],
    ],
    flipkart: [
      ['What exactly do I get with [product]?', 'What exactly do I get with this product?'],
      ['Which [variant/storage/size] suits [typical use]?', 'Which variant suits my use?'],
      ['What do the 1–2★ reviews complain about? Is the seller reliable?', 'What do the 1–2★ reviews complain about? Is the seller reliable?'],
      ['Can I get [product] cheaper with bank offers or exchange, or on Amazon?', 'Can I get it cheaper with bank offers or exchange, or on Amazon?'],
    ],
    myntra: [
      ['What is [item] made of, and how does it fit?', 'What is this made of, and how does it fit?'],
      ['Which size should I pick? Do reviews say [item] runs small or large?', 'Which size should I pick? Do reviews say it runs small or large?'],
      ['Any quality complaints about [item] after washing? What\'s the return and exchange policy?', 'Any quality complaints after washing? What\'s the return and exchange policy?'],
      ['What goes well with [item], and are there similar cheaper styles?', 'What goes well with it, and are there similar cheaper styles?'],
    ],
    cricketLive: [
      ['What\'s the match situation right now in [match]?', 'What\'s the match situation right now?'],
      ['What turned [match]: key overs, partnerships, spells?', 'What turned the game: key overs, partnerships, spells?'],
      ['What do the run rate, required rate and pitch say about who\'s ahead?', 'What do the run rate, required rate and pitch say about who\'s ahead?'],
      ['What does [match] mean for the series or points table?', 'What does this mean for the series or points table?'],
    ],
    cricketPlayer: [
      ['Who is [player]?', 'Who is this player?'],
      ['What is [player]\'s playing style, and what are their strengths?', 'What is their playing style, and what are their strengths?'],
      ['How does [player]\'s current form compare with their career stats?', 'How does their current form compare with their career stats?'],
      ['How does [player] compare to [peer]?', 'How do they compare to their peers?'],
    ],
    imdbTitle: [
      ['What is [title] about, without spoilers?', 'What is this about, without spoilers?'],
      ['Who are the director and lead cast of [title], and what are they known for?', 'Who are the director and lead cast, and what are they known for?'],
      ['How do the IMDb rating and critics compare for [title]? What\'s in the parents\' guide?', 'How do the IMDb rating and critics compare? What\'s in the parents\' guide?'],
      ['What\'s similar to [title], and where can I stream it in India?', 'What\'s similar, and where can I stream it in India?'],
    ],
    imdbPerson: [
      ['Who is [name]?', 'Who is this person?'],
      ['What is [name] best known for?', 'What are they best known for?'],
      ['What are the highs and lows of [name]\'s career?', 'What are the highs and lows of their career?'],
      ['What should I watch first from [name]?', 'What should I watch first?'],
    ],
    bookmyshow: [
      ['What is [movie/event]? Language, format and running time?', 'What is this? Language, format and running time?'],
      ['Which format or show of [movie/event] (IMAX, 4DX, Hindi or English) is worth it?', 'Which format or show is worth it?'],
      ['What do reviews say about [movie/event], and is it suitable for [age]?', 'What do reviews say, and is it suitable for kids?'],
      ['What else is playing nearby that\'s similar to [movie/event]?', 'What else is playing nearby that\'s similar?'],
    ],
    pwBatch: [
      ['What does [batch] cover, for which exam and year?', 'What does this batch cover, for which exam and year?'],
      ['What\'s included in [batch]: schedule, teachers, tests, notes?', 'What\'s included: schedule, teachers, tests, notes?'],
      ['What do students say about [batch]? Refund policy and extra costs?', 'What do students say? Refund policy and extra costs?'],
      ['How does [batch] compare to [other batch / Unacademy / Allen]?', 'How does it compare to other batches or platforms?'],
    ],
    pwLecture: [
      ['Explain [concept] simply.', 'Explain this concept simply.'],
      ['Walk me through a worked example of [concept].', 'Walk me through a worked example.'],
      ['What are the common mistakes with [concept]?', 'What are the common mistakes here?'],
      ['Give me practice questions on [concept].', 'Give me practice questions on this.'],
    ],
    finance: [
      ['How is [stock/fund] doing, and why did it move recently?', 'How is it doing, and why did it move recently?'],
      ['What does [company] do, and what are its key numbers (revenue growth, P/E, debt)?', 'What does the company do, and what are its key numbers?'],
      ['What are the risks for [stock/fund], and where do analysts disagree?', 'What are the risks, and where do analysts disagree?'],
      ['How does [stock/fund] compare to [peers/category average]?', 'How does it compare to its peers?'],
    ],
    justdial: [
      ['What does [business] offer? Hours and location?', 'What does this business offer? Hours and location?'],
      ['What do [business]\'s services cost?', 'What do its services cost?'],
      ['Do the reviews of [business] look genuine? What are the common complaints?', 'Do the reviews look genuine? What are the common complaints?'],
      ['What should I ask [business] before calling, and what are the alternatives nearby?', 'What should I ask before calling, and what are the alternatives nearby?'],
    ],
    telegram: [
      ['What is [channel] about, and what\'s been posted lately?', 'What is this channel about, and what\'s been posted lately?'],
      ['Who runs [channel], and how active is it?', 'Who runs it, and how active is it?'],
      ['Any scam warning signs in [channel] (guaranteed returns, urgency, payment requests)?', 'Any scam warning signs (guaranteed returns, urgency, payment requests)?'],
      ['What are trustworthy alternatives for [topic]?', 'What are trustworthy alternatives?'],
    ],
  };

  // Every news site (not only these): pages that describe themselves as news also get the news template.
  const NEWS_HOSTS = ['nytimes.com', 'ndtv.com', 'aajtak.in', 'bhaskar.com', 'oneindia.com', 'indiatimes.com', 'news.yahoo.com',
    'bbc.com', 'bbc.co.uk', 'theguardian.com', 'reuters.com', 'apnews.com', 'cnn.com', 'washingtonpost.com', 'wsj.com', 'ft.com',
    'bloomberg.com', 'economist.com', 'npr.org', 'aljazeera.com', 'thehindu.com', 'hindustantimes.com', 'indianexpress.com',
    'news18.com', 'livemint.com', 'zeenews.india.com', 'abplive.com', 'jagran.com', 'amarujala.com', 'theprint.in', 'scroll.in', 'thewire.in'];

  const on = (host, domain) => host === domain || host.endsWith(`.${domain}`);
  const amazonHost = (host) => /(^|\.)amazon\.(com|in|co\.uk|de|fr|it|es|ca|com\.au|co\.jp|com\.mx|com\.br|ae|sa|sg|nl|se|pl)$/.test(host);

  /**
   * Pure: [template id, slots key] for a URL, or null. `kind` is S.pageKind's kind for the page
   * (news pages anywhere get the news template); `article`: an X post that is a long-form article.
   */
  function matchTemplate(url, { kind = '', article = false } = {}) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
    const path = u.pathname;
    if (on(host, 'youtube.com') && (/^\/watch/.test(path) || /^\/shorts\//.test(path))) return ['youtube', 'youtubeVideo'];
    if ((on(host, 'x.com') || on(host, 'twitter.com')) && /\/status\/\d+/.test(path)) return article ? ['news', 'news'] : ['x', 'xPost'];
    if (on(host, 'reddit.com') && /\/comments\//.test(path)) return ['reddit', 'redditThread'];
    if (on(host, 'wikipedia.org') && /^\/wiki\/(?![^/]*:)/.test(path)) return ['wikipedia', 'wikipedia'];
    if (amazonHost(host) && /\/(dp|gp\/product)\//.test(path)) return host === 'amazon.in' ? ['amazon.in', 'amazonIn'] : ['amazon', 'amazon'];
    if (on(host, 'linkedin.com')) {
      if (/^\/jobs\/view\//.test(path)) return ['linkedin', 'linkedinJob'];
      if (/^\/in\/[^/]+\/?$/.test(path)) return ['linkedin', 'linkedinProfile'];
    }
    if (on(host, 'pinterest.com') || /(^|\.)pinterest\.[a-z.]+$/.test(host)) { if (/^\/pin\//.test(path)) return ['pinterest', 'pinterest']; }
    if (on(host, 'netflix.com') && /\/title\//.test(path)) return ['netflix', 'screenTitle'];
    if (on(host, 'hotstar.com')) {
      if (/\/sports\//.test(path)) return ['hotstar', 'cricketLive'];
      if (/\/(shows|movies|tv)\//.test(path)) return ['hotstar', 'screenTitle'];
    }
    if (host === 'support.apple.com') return ['apple', 'appleSupport'];
    if (host === 'apple.com' && /^\/([a-z]{2}(-[a-z]{2})?\/)?(iphone|ipad|mac|macbook|imac|watch|airpods|apple-vision-pro|tv-home|homepod|airtag)/.test(path)) return ['apple', 'appleProduct'];
    if (on(host, 'espn.com') || on(host, 'espn.in')) { if (/\/(game|match|story|player)\//.test(path)) return ['espn', 'espn']; }
    if (host === 'github.com') {
      if (/^\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(path)) return ['github', 'githubIssue'];
      if (/^\/[^/]+\/[^/]+\/?$/.test(path) && !/^\/(orgs|settings|topics|marketplace|explore|features|login|search|notifications|sponsors)\//.test(path)) return ['github', 'githubRepo'];
    }
    if (/(^|\.)ebay\.[a-z.]+$/.test(host) && /^\/itm\//.test(path)) return ['ebay', 'ebay'];
    if (on(host, 'roblox.com') && /^\/games\/\d+/.test(path)) return ['roblox', 'roblox'];
    if (on(host, 'quora.com') && /^\/[^/]+\/?$/.test(path) && !/^\/(profile|topic|search|answer|spaces|notifications)$/.test(path.replace(/\/$/, '')) && path.length > 12) return ['quora', 'quora'];
    if (on(host, 'aliexpress.com') || on(host, 'aliexpress.us')) { if (/\/item\//.test(path)) return ['aliexpress', 'aliexpress']; }
    if (host === 'open.spotify.com') {
      if (/^\/playlist\//.test(path)) return ['spotify', 'spotifyPlaylist'];
      if (/^\/(album|artist|episode|show|track)\//.test(path)) return ['spotify', 'spotify'];
    }
    if (on(host, 'flipkart.com') && /\/p\/itm/.test(path)) return ['flipkart', 'flipkart'];
    if (on(host, 'myntra.com') && /\/buy\/?$/.test(path)) return ['myntra', 'myntra'];
    if (on(host, 'cricbuzz.com')) {
      if (/^\/(live-cricket-scores|live-cricket-scorecard|cricket-scores|live-cricket-full-commentary)\//.test(path)) return ['cricket', 'cricketLive'];
      if (/^\/profiles\//.test(path)) return ['cricket', 'cricketPlayer'];
      if (/^\/cricket-news\//.test(path)) return ['news', 'news'];
    }
    if (on(host, 'espncricinfo.com') || on(host, 'cricinfo.com')) {
      if (/(live-cricket-score|full-scorecard|ball-by-ball-commentary|match-report)/.test(path)) return ['cricket', 'cricketLive'];
      if (/^\/cricketers\//.test(path)) return ['cricket', 'cricketPlayer'];
      if (/^\/story\//.test(path)) return ['news', 'news'];
    }
    if (on(host, 'imdb.com')) {
      if (/^\/title\/tt\d+/.test(path)) return ['imdb', 'imdbTitle'];
      if (/^\/name\/nm\d+/.test(path)) return ['imdb', 'imdbPerson'];
    }
    if (on(host, 'bookmyshow.com') && /\/(movies|events|plays|sports|activities)\//.test(path) && !/buytickets|booking|payment/i.test(path)) return ['bookmyshow', 'bookmyshow'];
    if (on(host, 'pw.live')) {
      if (/\/(lecture|video|notes|watch|chapter)/i.test(path)) return ['pw', 'pwLecture'];
      if (/\/batches?\b/i.test(path)) return ['pw', 'pwBatch'];
    }
    if (on(host, 'moneycontrol.com') && /\/(stockpricequote|mutual-funds|news|markets)\b/.test(path)) return ['finance', 'finance'];
    if (host === 'finance.yahoo.com' || (on(host, 'yahoo.com') && /^\/(quote|finance)\//.test(path))) return ['finance', 'finance'];
    if (on(host, 'justdial.com') && /BZDET/i.test(path)) return ['justdial', 'justdial'];
    if (host === 't.me' && /^\/(s\/)?[A-Za-z0-9_]{4,}\/?$/.test(path)) return ['telegram', 'telegram'];
    if (kind === 'news' || NEWS_HOSTS.some((d) => on(host, d)) || (on(host, 'yahoo.com') && /^\/news\//.test(path))) {
      // News sites: their articles, not their home and section pages (those keep the generic questions).
      if (kind === 'news' || /\d{4,}|\/(story|article|news)\//.test(path) || path.split('/').filter(Boolean).length >= 2) return ['news', 'news'];
    }
    return null;
  }

  /**
   * Pure: the question template for a page: { id, slots: [{ slot, pattern, plain }] } (always 4
   * slots: Gist, Understand, Check, Next); the generic template when no site template matches.
   */
  function questionTemplate(url, opts = {}) {
    const hit = matchTemplate(url, opts);
    const [id, key] = hit || ['default', 'default'];
    return { id, slots: T[key].map(([pattern, plain], i) => ({ slot: SLOTS[i], pattern, plain })) };
  }

  /** Pure: the template as text for the questions prompt ({{slots}}). */
  function slotsText(template) {
    return template.slots.map((s, i) => `${i + 1}. ${s.slot}: ${s.pattern}`).join('\n');
  }

  /** Pure: the plain questions of a template, as { ask, label, slot } (shown without a model). */
  function plainQuestions(template) {
    return template.slots.map((s) => ({ ask: s.plain, label: s.plain, slot: s.slot }));
  }

  /**
   * Pure: the model's four questions, one per slot in order. A slot whose question is missing or
   * unusable keeps its plain question, so the labels always line up.
   */
  function parseSlotQuestions(text, template) {
    const json = soroagent.parseJsonLoose ? soroagent.parseJsonLoose(text) : null;
    const list = Array.isArray(json) ? json : json && Array.isArray(json.questions) ? json.questions : [];
    return template.slots.map((s, i) => {
      const item = list[i];
      let q = String((item && (item.question || item.q)) || item || '').replace(/\s+/g, ' ').replace(/^(?:\d+[.)]\s+|[-*•]\s*)/, '').replace(/^(?:gist|understand|check|next)\s*[:—–-]\s*/i, '').replace(/^["']+|["']+$/g, '').trim();
      if (q.length < 8 || q.length > 140 || /\[[^\]]+\]/.test(q)) q = s.plain; // unfilled [brackets] read badly
      else if (!/[?.!।]$/.test(q)) q += '?';
      return { ask: q, label: q, slot: s.slot };
    });
  }

  Object.assign(soroagent, { QUESTION_SLOTS: SLOTS, matchTemplate, questionTemplate, slotsText, plainQuestions, parseSlotQuestions, QUESTION_TEMPLATES: T });
})(globalThis);

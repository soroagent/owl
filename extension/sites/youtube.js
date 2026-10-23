// Site profile for YouTube. A video page is read as its title, channel, description, chapters
// (from the timestamps in the description), the comments that have loaded, with their likes, and
// the timed transcript when there is one. Its prompts (chapters) are in prompts/youtube.js.
//
// Transcripts: YouTube's caption URLs (captionTracks) now need a token only its player has, and its
// transcript API rejects other callers, so soroagent reads the transcript panel YouTube shows under
// the description. When you ask (Summarize, a question), ensure() opens that panel, reads it and
// closes it again; automatic preparing only uses a panel that's already open.
(function (root) {
  'use strict';

  const soroagent = root.soroagent;
  const MAX_COMMENTS = 40;

  // ---------------------------------------------------------------------------
  // Pure helpers (unit tested)
  // ---------------------------------------------------------------------------

  function pageInfo(location) {
    if (location.pathname === '/watch' || location.pathname.startsWith('/shorts/')) {
      return {
        type: 'video',
        label: 'YouTube · Chapters & comments',
        context: 'This is a YouTube video page: title, channel, description, chapters, the comments that have loaded and, when there is one, the timed transcript of what is said. Without a transcript, what is said in the video is not included unless the description covers it.',
      };
    }
    return { type: 'page', label: 'YouTube', context: '' };
  }

  /** Pure: chapters from a description: lines like "0:00 Intro" or "1:02:03 - Q&A". */
  function parseChapters(description) {
    const chapters = [];
    for (const line of String(description || '').split('\n')) {
      const m = line.trim().match(/^(?:[-•*]\s*)?((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—:|)]?\s*(.{2,100})$/);
      if (m) chapters.push({ time: m[1], title: m[2].trim() });
    }
    // A real chapter list starts at 0:00 and has at least three entries.
    return chapters.length >= 3 && /^0?0:00$/.test(chapters[0].time) ? chapters : [];
  }

  /**
   * Pure: the description without the panels YouTube shows after it (music, transcript, channel
   * links), with the "Video details" numbers pulled out: { description, views, date }.
   */
  function cleanDescription(raw) {
    const text = String(raw || '');
    const details = text.match(/Video details\s*Date\s*([^\n]*?)\s*Views\s*([\d,.]+)/i);
    const description = text
      .split(/\n(?:Music|Transcript|Show transcript|Chapters|People mentioned|Explore the podcast|Video details|Featured places|Games)\n/)[0]
      .replace(/\s*(…more|\.\.\.more|Show less)\s*(more)?\s*$/i, '')
      .trim()
      .slice(0, 4000);
    return { description, views: details ? `${details[2]} views` : '', date: details ? details[1].trim() : '' };
  }

  /**
   * Pure: transcript lines → paragraphs of about 30 seconds, each starting with its timestamp, so
   * long transcripts condense well (paragraph by paragraph) and answers can cite times.
   * segments: [{ time: '1:02', text }]
   */
  function formatTranscript(segments, { seconds = 30 } = {}) {
    const toSec = (t) => String(t).split(':').reduce((acc, n) => acc * 60 + Number(n), 0);
    const paragraphs = [];
    let current = null;
    for (const s of segments || []) {
      const text = String(s.text || '').replace(/\s+/g, ' ').trim();
      if (!text || !/^\d{1,2}(:\d{2}){1,2}$/.test(String(s.time || ''))) continue;
      if (!current || toSec(s.time) - current.start >= seconds) {
        current = { start: toSec(s.time), time: s.time, parts: [] };
        paragraphs.push(current);
      }
      current.parts.push(text);
    }
    return paragraphs.map((p) => `[${p.time}] ${p.parts.join(' ')}`).join('\n\n');
  }

  /** Pure: video → text. video: { title, channel, views, date, description, chapters, comments: [{ author, likes, text }], transcript } */
  function formatVideo({ title, channel, views, date, description, chapters, comments, transcript = '' }) {
    return [
      `VIDEO: ${title}`,
      [channel && `Channel: ${channel}`, views, date].filter(Boolean).join(' · '),
      chapters.length ? `CHAPTERS:\n${chapters.map((c) => `${c.time} ${c.title}`).join('\n')}` : 'CHAPTERS: none listed',
      description ? `DESCRIPTION:\n${description}` : '',
      transcript ? `TRANSCRIPT ([m:ss] = time in the video):\n\n${transcript}` : '',
      comments.length ? `TOP COMMENTS (${comments.length} loaded):\n${comments.map((c) => `• ${c.author || 'someone'}${c.likes ? ` (${c.likes} likes)` : ''}: ${c.text}`).join('\n')}` : 'COMMENTS: none loaded yet (scroll down to load them).',
    ].filter(Boolean).join('\n\n');
  }

  // ---------------------------------------------------------------------------
  // Reading the page
  // ---------------------------------------------------------------------------

  const text = (el) => ((el && el.textContent) || '').replace(/[ \t]+/g, ' ').trim();
  const videoId = (location) => new URLSearchParams(location.search).get('v') || (location.pathname.match(/^\/shorts\/([\w-]+)/) || [])[1] || '';
  const transcripts = new Map(); // video id -> formatted transcript ('' = the video has none)

  // The transcript lines YouTube's panel shows (current and older markup).
  function readTranscriptPanel(doc) {
    const segments = [];
    for (const seg of doc.querySelectorAll('transcript-segment-view-model, ytd-transcript-segment-renderer')) {
      const time = text(seg.querySelector('[class*="Timestamp"]:not([class*="A11y"]), .segment-timestamp'));
      const line = text(seg.querySelector('[role="text"], .segment-text, yt-formatted-string'));
      if (time && line) segments.push({ time, text: line });
    }
    return segments;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Makes the transcript available to extract(). interactive: may open YouTube's transcript panel
   * (after a click on Summarize or a question); otherwise only reads a panel that's already open.
   * Resolves with true when a transcript is known for this video.
   */
  async function ensure(doc, location, { interactive = false } = {}) {
    const id = videoId(location);
    if (!id || pageInfo(location).type !== 'video') return false;
    if (transcripts.has(id)) return Boolean(transcripts.get(id));
    let segments = readTranscriptPanel(doc);
    let opened = false;
    if (!segments.length && interactive) {
      const expand = doc.querySelector('ytd-watch-metadata #expand, ytd-text-inline-expander #expand');
      if (expand) expand.click();
      await wait(400);
      const button = doc.querySelector('ytd-video-description-transcript-section-renderer button, button[aria-label="Show transcript"]');
      if (!button) {
        transcripts.set(id, '');
        return false;
      }
      button.click();
      opened = true;
      for (let i = 0; i < 25 && !segments.length; i++) {
        await wait(300);
        segments = readTranscriptPanel(doc);
      }
    }
    if (opened) {
      // Put the page back as it was: close the panel and the expanded description.
      const panel = doc.querySelector('ytd-engagement-panel-section-list-renderer[target-id*="transcript"]');
      const close = panel && panel.querySelector('#visibility-button button, button[aria-label*="Close"]');
      if (close) close.click();
      const collapse = doc.querySelector('ytd-watch-metadata #collapse, ytd-text-inline-expander #collapse');
      if (collapse) collapse.click();
    }
    if (!segments.length && !interactive) return false; // maybe later, when asked
    transcripts.set(id, formatTranscript(segments));
    return segments.length > 0;
  }

  function extract(doc, location) {
    if (pageInfo(location).type !== 'video') return null;
    const title = text(doc.querySelector('h1.ytd-watch-metadata, ytd-watch-metadata h1, #title h1')) || ((doc.querySelector('meta[name="title"]') || {}).content || doc.title.replace(/ - YouTube$/, ''));
    // The first non-empty description inside the video's own details (YouTube renders several).
    const candidates = ['ytd-watch-metadata #description-inline-expander', 'ytd-watch-metadata #description', 'ytd-watch-metadata ytd-text-inline-expander'];
    const descText = candidates.map((s) => soroagent.squashText((doc.querySelector(s) || {}).textContent || '')).find((t) => t.length > 20);
    const raw = descText || ((doc.querySelector('meta[name="description"]') || {}).content || '');
    const { description, views, date } = cleanDescription(raw);
    const comments = [...doc.querySelectorAll('ytd-comment-thread-renderer')].slice(0, MAX_COMMENTS).map((c) => ({
      author: text(c.querySelector('#author-text')),
      likes: text(c.querySelector('#vote-count-middle')),
      text: text(c.querySelector('#content-text')).slice(0, 500),
    })).filter((c) => c.text);
    return {
      title,
      text: formatVideo({
        title,
        channel: text(doc.querySelector('ytd-watch-metadata #channel-name a, #owner #channel-name a, ytd-channel-name a')),
        views,
        date,
        description,
        chapters: parseChapters(description),
        comments,
        transcript: transcripts.get(videoId(location)) || '',
      }),
    };
  }

  soroagent.registerSite({ id: 'youtube', name: 'YouTube', matches: (location) => /(^|\.)youtube\.com$/i.test(location.hostname), pageInfo, extract, ensure });
  soroagent.siteHelpers = { ...(soroagent.siteHelpers || {}), youtube: { pageInfo, parseChapters, cleanDescription, formatVideo, formatTranscript, readTranscriptPanel } };
})(globalThis);

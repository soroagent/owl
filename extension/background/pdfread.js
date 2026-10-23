// PDFs: browsers show them in their own viewer, where extensions can't run, so the side panel (or
// the right-click menu) asks the background to read them. The PDF is downloaded here and its text
// read with pdf.js (vendor/pdfjs, shipped with the extension: it's code). pdf.js is an ES module
// with a Worker, so in Chrome it runs in the offscreen document (beside WebLLM) and in Firefox in
// the background page. Turning pdf.js text items into paragraphs is pure and unit tested.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});
  const MAX_BYTES = 60 * 1024 * 1024;
  const MAX_PAGES = 400;

  /** Pure: whether a URL or content type is a PDF. */
  function isPdf(url, contentType = '') {
    if (/application\/pdf/i.test(contentType)) return true;
    try {
      const u = new URL(url);
      return /\.pdf$/i.test(u.pathname) || (/(^|\.)arxiv\.org$/i.test(u.hostname) && /^\/pdf\//.test(u.pathname));
    } catch {
      return false;
    }
  }

  /**
   * Pure: one page's pdf.js text items ({ str, hasEOL, transform: [a, b, c, d, x, y], height })
   * as text: lines where items end a line, a blank line (new paragraph) where the vertical gap is
   * clearly bigger than the line spacing, and words broken at a line-end hyphen joined again.
   */
  function pdfItemsToText(items) {
    const lines = [];
    let line = '';
    let lastY = null;
    let gaps = [];
    const ys = [];
    for (const it of items || []) {
      const y = it.transform ? it.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(lastY - y) > 1 && line) {
        lines.push({ text: line, y: lastY });
        line = '';
      }
      line += it.str || '';
      if (y !== null) lastY = y;
      if (it.hasEOL) {
        lines.push({ text: line, y: lastY });
        line = '';
      }
    }
    if (line) lines.push({ text: line, y: lastY });
    for (let i = 1; i < lines.length; i++) if (lines[i].y !== null && lines[i - 1].y !== null) ys.push(Math.abs(lines[i - 1].y - lines[i].y));
    gaps = [...ys].filter((g) => g > 0).sort((a, b) => a - b);
    const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    let out = '';
    lines.forEach((l, i) => {
      const t = l.text.replace(/\s+/g, ' ').trim();
      if (!t) return;
      if (!out) {
        out = t;
        return;
      }
      const gap = i > 0 && l.y !== null && lines[i - 1].y !== null ? Math.abs(lines[i - 1].y - l.y) : 0;
      if (typical && gap > typical * 1.6) out += `\n\n${t}`;
      else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(t)) out = out.slice(0, -1) + t; // hyphen-
      else out += ` ${t}`;
    });
    return out;
  }

  /** The reader: in Chrome's offscreen document or Firefox's background page. */
  function createPdfReader(ext) {
    let lib = null;
    const load = async () => {
      if (lib) return lib;
      lib = await import(ext.runtime.getURL('vendor/pdfjs/pdf.min.mjs'));
      lib.GlobalWorkerOptions.workerSrc = ext.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');
      return lib;
    };

    /** Resolves with { title, text, pages, truncated }. */
    async function read(url) {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`Couldn't download the PDF (error ${res.status}).`);
      const size = Number(res.headers.get('content-length') || 0);
      if (size > MAX_BYTES) throw new Error('This PDF is too large to read (over 60 MB).');
      const data = new Uint8Array(await res.arrayBuffer());
      if (data.byteLength > MAX_BYTES) throw new Error('This PDF is too large to read (over 60 MB).');
      const pdfjs = await load();
      const task = pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
      const doc = await task.promise;
      try {
        const meta = await doc.getMetadata().catch(() => null);
        const pages = [];
        const count = Math.min(doc.numPages, MAX_PAGES);
        for (let n = 1; n <= count; n++) {
          const page = await doc.getPage(n);
          const content = await page.getTextContent();
          pages.push(pdfItemsToText(content.items));
          page.cleanup();
        }
        const fileName = decodeURIComponent((new URL(url).pathname.split('/').pop() || 'document.pdf'));
        const title = ((meta && meta.info && meta.info.Title) || '').trim() || fileName;
        return { title, text: pages.filter(Boolean).join('\n\n'), pages: doc.numPages, truncated: doc.numPages > MAX_PAGES };
      } finally {
        await task.destroy().catch(() => {}); // frees the document and its worker
      }
    }

    // Requests from Chrome's worker arrive as messages.
    function listen() {
      ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg || msg.type !== 'pdf:extract' || sender.id !== ext.runtime.id) return false;
        read(String(msg.url)).then((r) => sendResponse({ ok: true, ...r }), (err) => sendResponse({ ok: false, error: err.message || String(err) }));
        return true;
      });
    }

    return { read, listen };
  }

  Object.assign(soroagent, { isPdf, pdfItemsToText, createPdfReader });
})(globalThis);

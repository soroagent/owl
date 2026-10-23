// Hidden helper for Chrome's background worker, which can't create blob URLs or import ES modules
// itself: turns the automatic backup's JSON into a URL the downloads API can save, and hosts the
// optional in-browser AI (WebLLM on WebGPU; see background/browserai.js) and the PDF reader
// (pdf.js; see background/pdfread.js), each loaded only when used.
(function () {
  'use strict';

  const ext = globalThis.chrome;
  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== ext.runtime.id || !msg) return false;
    if (msg.type === 'offscreen:blob') {
      sendResponse({ url: URL.createObjectURL(new Blob([msg.json], { type: 'application/json' })) });
    } else if (msg.type === 'offscreen:revoke') {
      URL.revokeObjectURL(msg.url);
      sendResponse({ ok: true });
    }
    return false;
  });
  globalThis.soroagent.createWebLLMHost(ext).listen();
  globalThis.soroagent.createPdfReader(ext).listen();
})();

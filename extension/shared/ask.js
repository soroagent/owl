// One answer from the model (local or cloud, whichever is set up) for soroagent's own pages:
// research topics on the Snippets page, prompt optimizing in settings.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  /**
   * Resolves with the model's full reply. `json` asks for a JSON reply where supported; `onToken`
   * receives the reply as it streams; `signal` stops it.
   */
  function askModel(messages, { json = false, onToken, signal } = {}) {
    return new Promise((resolve, reject) => {
      const port = soroagent.ext.runtime.connect({ name: 'llm' });
      let settled = false;
      // Slow first answers (a local model loading) keep the background worker awake.
      const ping = setInterval(() => {
        try {
          port.postMessage({ type: 'ping' });
        } catch {
          // closed; finish() stops this
        }
      }, 15000);
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearInterval(ping);
        try {
          port.disconnect();
        } catch {
          // already closed
        }
        fn(value);
      };
      port.onMessage.addListener((msg) => {
        if (msg.type === 'token' && onToken) onToken(msg.text);
        else if (msg.type === 'done') finish(resolve, msg.text || '');
        else if (msg.type === 'error') finish(reject, Object.assign(new Error(msg.error || 'The model did not answer.'), { hint: msg.hint || '' }));
      });
      port.onDisconnect.addListener(() => finish(reject, new Error('Lost the connection to the extension.')));
      if (signal) signal.addEventListener('abort', () => finish(reject, Object.assign(new Error('Stopped.'), { name: 'AbortError' })), { once: true });
      port.postMessage({ type: 'chat', messages, json });
    });
  }

  soroagent.askModel = askModel;
})(globalThis);

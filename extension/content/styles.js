// Styles for the assistant. They live inside a shadow root, so pages can't restyle the
// assistant and the assistant can't leak styles into pages.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  soroagent.ASSISTANT_CSS = `
:host {
  all: initial;
  /* Brand: the owl's green and orange. Text-safe shades are used for words, the bright ones for
     marks, rings and small highlights. */
  --brand: #34D399;
  --spark: #F59E0B;
  --bg: #ffffff;
  --bg-soft: #f6f7f7;
  --bg-hover: #eef0ef;
  --fg: #111613;
  --fg-muted: #5f6763;
  --border: #e3e7e5;
  --accent: #047857;
  --accent-strong: #065f46;
  --accent-fg: #ffffff;
  --accent-soft: #ecfdf5;
  --spark-fg: #b45309;
  --spark-soft: #fff7ed;
  --ok: #059669;
  --warn: #d97706;
  --err: #dc2626;
  --shadow: 0 24px 60px rgba(10, 30, 20, 0.18), 0 2px 8px rgba(10, 30, 20, 0.08);
  --owl-bg: #FFFFFF;
  --owl-border: #E3E7E5;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  :host {
    --spark: #FBBF24;
    --bg: #151716;
    --bg-soft: #1d201f;
    --bg-hover: #262a28;
    --fg: #eef2f0;
    --fg-muted: #9aa39f;
    --border: #2e3330;
    --accent: #34d399;
    --accent-strong: #6ee7b7;
    --accent-fg: #03261a;
    --accent-soft: #11291f;
    --spark-fg: #fbbf24;
    --spark-soft: #2a2213;
    --ok: #34d399;
    --shadow: 0 24px 60px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.35);
    --owl-bg: #111312;
    --owl-border: #2A2E2C;
  }
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: 0.5; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
svg { width: 18px; height: 18px; flex: none; }

.launcher {
  position: fixed; right: 16px; bottom: 20px; z-index: 2147483647;
  width: 50px; height: 50px; border-radius: 50%; padding: 0; overflow: hidden;
  display: grid; place-items: center; touch-action: none;
  /* Follows the browser theme: white in light mode, near-black in dark mode. */
  background: var(--owl-bg); border: 1px solid var(--owl-border);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: transform 0.15s ease, box-shadow 0.15s ease, top 0.25s ease, left 0.25s ease, right 0.25s ease;
}
.launcher:hover { box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 35%, transparent), 0 10px 24px rgba(0, 0, 0, 0.22); }
.launcher.open { box-shadow: 0 0 0 2px var(--brand), 0 8px 22px rgba(0, 0, 0, 0.2); }
.launcher:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--brand), 0 8px 22px rgba(0, 0, 0, 0.2); }
.launcher.dragging { transition: none; cursor: grabbing; }
/* Something to offer on this page (X bookmarks): a small orange dot; the question waits in the panel. */
.launcher.offer:not(.open)::before {
  content: ""; position: absolute; top: 6px; right: 6px; width: 11px; height: 11px; border-radius: 50%; box-sizing: border-box;
  background: var(--spark); border: 2px solid var(--owl-bg); z-index: 1;
}
.launcher.busy::after {
  content: ""; position: absolute; inset: -1px; border-radius: 50%;
  border: 2px solid transparent; border-top-color: var(--brand); border-right-color: var(--spark); animation: spin 0.9s linear infinite;
}

/* The owl: still, apart from a spinner ring while it works. */
.owl { width: 100%; height: 100%; display: block; overflow: visible; }

.panel {
  position: fixed; right: 16px; bottom: 80px; z-index: 2147483647;
  width: min(var(--panel-w, 400px), calc(100vw - 24px)); height: min(600px, calc(100vh - 100px));
  transition: width 0.18s ease, height 0.18s ease;
  display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--border); border-radius: 16px;
  box-shadow: var(--shadow); overflow: hidden;
  animation: pop 0.16s ease-out;
}
/* A thin green-to-orange line along the top: the owl's colours, quietly. */
.panel::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 2px; z-index: 3; background: linear-gradient(90deg, var(--brand), var(--spark)); }

header {
  position: relative; display: flex; align-items: center; gap: 8px;
  padding: 12px 10px 10px 14px; border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: center; gap: 8px; flex: none; }
.wordmark { font-size: 15px; font-weight: 700; letter-spacing: -0.03em; color: var(--fg); }
.wordmark span { color: var(--accent); }
.brand-mark {
  width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; overflow: hidden;
  background: var(--owl-bg); border: 1px solid var(--owl-border);
}
.status {
  min-width: 0; display: flex; align-items: center; gap: 6px; padding: 0 2px;
}
/* Everything after the status sits on the right: Home, History, ⋯, close */
.home-btn { margin-left: auto; }
.dot { cursor: help; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-muted); flex: none; }
.dot.ready { background: var(--ok); }
.dot.connecting { background: var(--warn); animation: pulse 1s ease-in-out infinite; }
.dot.offline { background: var(--err); }
.status-text { font-size: 12px; color: var(--fg-muted); white-space: nowrap; }
.where {
  font-size: 11px; font-weight: 600; color: var(--spark-fg); background: var(--spark-soft);
  padding: 1px 7px; border-radius: 999px; white-space: nowrap;
}
.model {
  max-width: 150px; min-width: 0; border: none; background: transparent; font-size: 12px;
  padding: 2px 2px; text-overflow: ellipsis; border-radius: 6px;
}
.model:hover { background: var(--bg-hover); }
.icon-btn {
  width: 30px; height: 30px; border-radius: 8px; border: none; background: transparent;
  display: grid; place-items: center; color: var(--fg-muted); flex: none;
}
.icon-btn:hover { background: var(--bg-hover); color: var(--fg); }
.refresh-btn { position: relative; }
.refresh-btn .new-count {
  position: absolute; top: -3px; right: -5px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 8px;
  background: var(--spark); color: #1a1205; font-size: 9.5px; font-weight: 700; line-height: 15px; text-align: center;
}
.refresh-btn.spin svg { animation: soro-spin 0.9s linear infinite; }
@keyframes soro-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .refresh-btn.spin svg { animation: none; opacity: .5; } }
.panel.resizing { transition: none; user-select: none; }

/* Resize handles on the panel's free edges (set by launcher.js as data-edge-x / data-edge-y) */
.resize { position: absolute; z-index: 4; touch-action: none; outline: none; }
.resize-x { top: 14px; bottom: 14px; width: 8px; cursor: ew-resize; }
.resize-y { left: 14px; right: 14px; height: 8px; cursor: ns-resize; }
.resize-xy { width: 16px; height: 16px; }
.panel[data-edge-x="left"] .resize-x { left: -3px; }
.panel[data-edge-x="right"] .resize-x { right: -3px; }
.panel[data-edge-x=""] .resize-x, .panel[data-edge-x=""] .resize-xy { display: none; }
.panel[data-edge-y="top"] .resize-y { top: -3px; }
.panel[data-edge-y="bottom"] .resize-y { bottom: -3px; }
.panel[data-edge-y="top"][data-edge-x="left"] .resize-xy { top: -3px; left: -3px; cursor: nwse-resize; }
.panel[data-edge-y="top"][data-edge-x="right"] .resize-xy { top: -3px; right: -3px; cursor: nesw-resize; }
.panel[data-edge-y="bottom"][data-edge-x="left"] .resize-xy { bottom: -3px; left: -3px; cursor: nesw-resize; }
.panel[data-edge-y="bottom"][data-edge-x="right"] .resize-xy { bottom: -3px; right: -3px; cursor: nwse-resize; }
/* A soft green line shows the edge you're about to drag */
.resize-x::after, .resize-y::after { content: ""; position: absolute; border-radius: 2px; background: var(--brand); opacity: 0; transition: opacity .12s ease; }
.resize-x::after { top: 30%; bottom: 30%; left: 3px; width: 2px; }
.resize-y::after { left: 30%; right: 30%; top: 3px; height: 2px; }
.resize:hover::after, .resize:focus-visible::after, .panel.resizing .resize::after { opacity: 0.9; }
.resize-xy::after { content: ""; position: absolute; inset: 4px; border-radius: 50%; background: var(--spark); opacity: 0; transition: opacity .12s ease; }
.resize-xy:hover::after, .resize-xy:focus-visible::after { opacity: 0.9; }
.status { overflow: hidden; }

/* Snippets saved from this page */
.page-snips { display: grid; gap: 6px; margin-top: 8px; }
.page-snip { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; align-items: center; text-align: left; width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--fg); font: inherit; cursor: pointer; }
.page-snip:hover { border-color: var(--accent); }
.page-snip img { grid-row: span 2; width: 56px; height: 36px; object-fit: cover; object-position: top; border-radius: 5px; }
.page-snip .snip-title { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-snip .snip-meta { grid-column: 2; font-size: 11.5px; color: var(--fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-snip .snip-kind { grid-row: span 2; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 2px 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }

.menu {
  position: absolute; top: 44px; right: 10px; z-index: 2; min-width: 210px; padding: 5px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow);
}
.menu button {
  display: block; width: 100%; text-align: left; border: none; background: none;
  padding: 7px 10px; border-radius: 6px;
}
.menu button:hover { background: var(--bg-soft); }

.actions { display: flex; flex-wrap: wrap; gap: 5px; padding: 9px 12px; border-bottom: 1px solid var(--border); }
.chip {
  display: inline-flex; align-items: center; gap: 5px; height: 29px; padding: 0 10px;
  border: 1px solid var(--border); border-radius: 999px; background: var(--bg); font-size: 12px; font-weight: 550;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.chip svg { width: 14px; height: 14px; color: var(--brand); } /* icons are mint everywhere */
.icon-btn:not(.menu-btn):not(.close-btn) svg, .card-title svg { color: var(--brand); }
.chip:hover:not(:disabled) { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }

/* Home: the opening screen over the conversation, which stays underneath */
.thread.home > :not(.empty) { display: none; }
/* In a conversation, the opening screen stays on top as a compact block of suggested questions. */
.home-offer { width: 100%; text-align: left; }
.home-offer:empty { display: none; }
.home-offer .card { margin: 4px 0 8px; }
/* Feeds (X timelines, bookmarks, likes; LinkedIn): the feed actions instead of suggested questions. */
.feed-home { display: grid; gap: 6px; width: 100%; max-width: 300px; margin: 8px auto 2px; }
.feed-title { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); text-align: center; }
.feed-home button {
  display: flex; align-items: center; gap: 8px; padding: 9px 12px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--bg); color: var(--fg); font-size: 13px; font-weight: 600; text-align: left;
}
.feed-home button svg { width: 15px; height: 15px; flex: none; color: var(--brand); }
.feed-home button:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-soft); }
.feed-home button:disabled { opacity: .55; cursor: default; }
.feed-home button.toggle-action[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.feed-note { margin: 0; font-size: 11.5px; color: var(--fg-muted); text-align: center; }
.thread.chatting > .empty { margin: 0; padding: 2px 12px 14px; border-bottom: 1px solid var(--border); }
.thread.chatting > .empty .empty-mark, .thread.chatting > .empty .empty-note, .thread.chatting > .empty .empty-hint { display: none; }
.thread.chatting > .empty strong { font-size: 13.5px; }

.thread { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.empty { margin: auto 0; display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--fg-muted); font-size: 13px; text-align: center; padding: 0 12px; }
.empty-mark { width: 52px; height: 52px; border-radius: 16px; overflow: hidden; border: 1px solid var(--owl-border); background: var(--owl-bg); margin-bottom: 6px; }
.empty strong { color: var(--fg); font-size: 16px; font-weight: 650; letter-spacing: -0.015em; }
.empty-note { max-width: 300px; }
.suggest { display: grid; gap: 6px; width: 100%; max-width: 300px; margin-top: 12px; }
.suggest button {
  text-align: left; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg);
  color: var(--fg); font-size: 12.5px; transition: border-color 0.12s ease, background 0.12s ease;
}
.suggest button::before { content: "→"; color: var(--spark); margin-right: 8px; }
.suggest button:hover { border-color: var(--accent); background: var(--accent-soft); }
/* Template questions: the slot (Gist, Understand, Check, Next) above each question. */
.suggest button.slotted { display: grid; gap: 1px; }
.suggest button.slotted::before, .suggest button.slotted.asked::before { content: none; }
.suggest .slot { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
.suggest button.asked .slot::after { content: " ✓"; color: var(--ok); }
.suggest button.asked, .follow-ups button.asked { color: var(--fg-muted); }
.suggest button.asked::before, .follow-ups button.asked::before { content: "✓"; color: var(--ok); }
/* Follow-up questions under an answer */
.follow-ups { display: grid; gap: 6px; }
.follow-label { font-size: 11.5px; font-weight: 600; color: var(--fg-muted); }
.follow-ups button {
  text-align: left; padding: 7px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg);
  color: var(--fg); font-size: 12.5px; transition: border-color 0.12s ease, background 0.12s ease;
}
.follow-ups button::before { content: "→"; color: var(--spark); margin-right: 8px; }
.follow-ups button:hover { border-color: var(--accent); background: var(--accent-soft); }
.follow-ups .ghost { height: 32px; border-radius: 10px; border: 1px solid var(--border); background: linear-gradient(90deg, var(--bg-soft) 0%, var(--border) 50%, var(--bg-soft) 100%); background-size: 200% 100%; animation: soro-shimmer 1.4s linear infinite; }
@media (prefers-reduced-motion: reduce) { .follow-ups .ghost { animation: none; } }
.suggest-head { display: flex; align-items: center; justify-content: space-between; width: 100%; max-width: 300px; margin-top: 12px; font-size: 11.5px; }
.suggest-head + .suggest { margin-top: 6px; }
.suggest-head button { border: none; background: none; padding: 0; color: var(--accent); font-size: 11.5px; font-weight: 600; cursor: pointer; }
.suggest-head button:hover { text-decoration: underline; }
.suggest .ghost { height: 34px; border-radius: 10px; border: 1px solid var(--border); background: linear-gradient(90deg, var(--bg-soft) 0%, var(--border) 50%, var(--bg-soft) 100%); background-size: 200% 100%; animation: soro-shimmer 1.4s linear infinite; }
@keyframes soro-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .suggest .ghost { animation: none; } }
.empty-hint { margin: 10px 0 0; font-size: 12px; }

.msg { max-width: 100%; overflow-wrap: anywhere; }
.msg.user {
  align-self: flex-end; max-width: 85%; padding: 8px 12px; border-radius: 14px 14px 4px 14px;
  background: var(--accent); color: var(--accent-fg); white-space: pre-wrap;
}
.msg.assistant { align-self: stretch; }
.msg.assistant > :first-child { margin-top: 0; }
.msg.assistant > :last-child { margin-bottom: 0; }
.msg p, .msg ul, .msg ol, .msg pre { margin: 0 0 8px; }
.msg ul, .msg ol { padding-left: 20px; }
.msg li { margin: 2px 0; }
.msg h3, .msg h4, .msg h5, .msg h6 { margin: 12px 0 4px; font-size: 14px; }
.msg code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--bg-soft); padding: 1px 4px; border-radius: 4px; }
.msg pre { background: var(--bg-soft); padding: 10px; border-radius: 8px; overflow-x: auto; }
.msg pre code { background: none; padding: 0; }
.msg a { color: var(--accent); }
.typing { color: var(--fg-muted); font-size: 13px; display: inline-flex; gap: 6px; align-items: center; }
.typing::before {
  content: ""; width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--brand); border-right-color: var(--spark); animation: spin 0.8s linear infinite;
}

.card { border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; background: var(--bg-soft); font-size: 13px; }
.card.error { border-color: color-mix(in srgb, var(--err) 45%, var(--border)); }
.card-title { font-weight: 600; display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.card-title svg { width: 16px; height: 16px; }
.card.error .card-title svg { color: var(--err); }
.card.ok .card-title svg { color: var(--ok); }
.card p { margin: 4px 0 0; color: var(--fg-muted); }
.card pre { margin: 8px 0 0; white-space: pre-wrap; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--fg); }
.card-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.card-actions button { border: 1px solid var(--border); background: var(--bg); border-radius: 8px; padding: 3px 9px; font-size: 11.5px; }

/* Research: pick a topic first */
.topics-status { margin: 4px 0 8px; }
.topics { display: flex; flex-wrap: wrap; gap: 5px; }
.topic { border: 1px solid var(--border); background: var(--bg); border-radius: 999px; padding: 4px 10px; font-size: 11.5px; text-align: left; }
.topic:hover { border-color: var(--accent); background: var(--accent-soft); }
.topic.all { border-style: dashed; color: var(--fg-muted); }
.topic-own { display: flex; gap: 6px; margin-top: 8px; }
.topic-own input { flex: 1; min-width: 0; padding: 5px 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--fg); font: inherit; font-size: 12px; outline: none; }
.topic-own input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.topic-own .primary, .card-actions .primary { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); border-radius: 8px; padding: 4px 10px; font-size: 11.5px; font-weight: 600; }
.card-actions button:hover { border-color: var(--accent); }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.tag { font-size: 11.5px; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
/* Next steps under the latest answer: one compact row, redrawn in place */
.next-steps { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 10px; padding: 6px 8px 6px 10px; border: 1px solid var(--border); border-radius: 10px; font-size: 12px; color: var(--fg-muted); }
.next-status { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.next-check { color: var(--ok); font-weight: 700; }
.next-note::before { content: "·"; margin-right: 6px; }
.next-status .link { border: none; background: none; padding: 0; color: var(--accent); font-size: 12px; font-weight: 600; }
.next-status .link:hover { text-decoration: underline; }
.next-actions { display: flex; align-items: center; gap: 5px; margin-left: auto; }
.next-actions button { border: 1px solid var(--border); background: var(--bg); border-radius: 8px; padding: 3px 9px; font-size: 11.5px; font-weight: 550; }
.next-actions button:hover { border-color: var(--accent); }
.next-actions .primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.next-actions .primary:hover { background: var(--accent-strong); }
.next-actions .dismiss { border: none; background: none; color: var(--fg-muted); font-size: 15px; line-height: 1; padding: 2px 5px; }
.next-actions .dismiss:hover { color: var(--fg); background: var(--bg-hover); }
.onboarding .card-title { font-size: 13.5px; }
.onboard-frame { display: block; width: 100%; height: 300px; margin-top: 10px; border: 0; border-radius: 10px; background: var(--bg); color-scheme: normal; }
/* Related saved notes: a slim bar under the actions */
.related { margin: 8px 12px 0; padding: 6px 8px 6px 10px; border-radius: 10px; background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border)); font-size: 12px; }
.related-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.related-text { font-weight: 600; color: var(--fg); }
.related .link { border: none; background: none; padding: 0; color: var(--accent); font-weight: 600; font-size: 12px; text-align: left; }
.related .link:hover { text-decoration: underline; }
.related-actions { margin-left: auto; display: flex; align-items: center; gap: 4px; }
.related-actions button { border: 1px solid var(--border); background: var(--bg); border-radius: 8px; padding: 2px 8px; font-size: 11.5px; font-weight: 600; }
.related-actions .primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.related-actions .quiet { background: none; }
.related-actions .dismiss { border: none; background: none; color: var(--fg-muted); font-size: 15px; line-height: 1; padding: 0 4px; }
.related-list { list-style: none; margin: 6px 0 6px; padding: 0; display: grid; gap: 3px; }
.related-list li { display: flex; align-items: baseline; gap: 6px; }
.related-list .n { font-size: 10.5px; font-weight: 700; color: var(--accent); }
.related-list small { margin-left: auto; color: var(--fg-muted); white-space: nowrap; }
.progress { height: 4px; border-radius: 4px; background: var(--border); margin-top: 8px; overflow: hidden; }
.progress > div { height: 100%; background: linear-gradient(90deg, var(--brand), var(--spark)); width: 0; transition: width 0.2s ease; }

/* Site toolbar (e.g. X): page label and option toggles */
.site-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg-soft); font-size: 12.5px; }
.site-label { font-weight: 600; margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; }
.toggle { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px 3px 4px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg); font-size: 11.5px; font-weight: 500; }
.toggle::before { content: ""; width: 22px; height: 13px; border-radius: 999px; background: var(--border); box-shadow: inset -9px 0 0 2px var(--bg); transition: background 0.15s, box-shadow 0.15s; }
.toggle[aria-pressed="true"] { border-color: var(--accent); }
.toggle[aria-pressed="true"]::before { background: var(--accent); box-shadow: inset 9px 0 0 2px var(--bg); }

/* Research sources */
.sources { margin: 6px 0 0; padding-left: 20px; font-size: 13px; }
.sources li { margin: 3px 0; }
.sources a { color: var(--accent); text-decoration: none; }
.sources a:hover { text-decoration: underline; }
.sources small { color: var(--fg-muted); }

/* Model suggestions */
.recs { display: grid; gap: 6px; margin-top: 8px; }
.rec { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); }
.rec b { font-size: 12.5px; }
.rec small { display: block; color: var(--fg-muted); font-size: 11.5px; }
.rec button { margin-left: auto; border: 1px solid var(--border); background: var(--bg-soft); border-radius: 7px; padding: 3px 9px; font-size: 11.5px; }
.rec button:hover { border-color: var(--accent); }
.cached { font-size: 12px; color: var(--fg-muted); display: flex; align-items: center; gap: 8px; }
.cached button { border: none; background: none; color: var(--accent); padding: 0; font-size: 12px; text-decoration: underline; }

.composer { display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid var(--border); }
.composer textarea {
  flex: 1; resize: none; min-height: 38px; max-height: 140px; padding: 8px 12px;
  border: 1px solid var(--border); border-radius: 12px; background: var(--bg-soft); outline: none;
}
.composer textarea:focus { border-color: var(--accent); background: var(--bg); box-shadow: 0 0 0 3px var(--accent-soft); }
.send {
  width: 38px; height: 38px; border-radius: 12px; border: none; display: grid; place-items: center;
  background: var(--accent); color: var(--accent-fg);
}
.send:hover:not(:disabled) { background: var(--accent-strong); }
.send.stop { background: var(--spark); color: #1a1205; }


@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 50% { opacity: 0.35; } }
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;

  // Applied to the page itself (outside the shadow root): site filters such as X's "Verified only".
  soroagent.PAGE_CSS = `
[data-soroagent-filtered] { display: none !important; }
[data-soroagent-offtopic] { display: none !important; }
[data-soroagent-clutter] { display: none !important; }
[data-soroagent-new]::before { content: "●"; color: #34D399; margin-right: .35em; font-size: .8em; vertical-align: .1em; }
`;
})(globalThis);

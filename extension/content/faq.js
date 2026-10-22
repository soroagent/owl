// Questions that could be about soroagent itself or about the website ("where is my data
// stored?", "is this open source?"). The panel asks which one is meant; questions about soroagent
// get these fixed, accurate answers instead of a model's guess. Pure and unit tested.
(function (root) {
  'use strict';

  const soroagent = (root.soroagent = root.soroagent || {});

  const TOPICS = [
    { id: 'opensource', re: /\b(open[- ]?source|source code|github|licen[cs]e|who (made|built|created|develops)|is (this|it) free)\b/i },
    { id: 'keys', re: /\b(api ?key|my key|keys?)\b.*\b(safe|secure|stored|store|encrypt|see|leak|share)|\b(safe|secure)\b.*\bapi ?key/i },
    { id: 'tracking', re: /\b(track(ing|s)?|analytics|telemetry|cookies?|spy|watch(ing)? me|sell (my )?data|ads? (profile|targeting))\b/i },
    {
      id: 'data',
      re: /\b(save|saves|saving|store|stores|stored|storing|keep|keeps|collect|collects|upload|send|sends|share|shares)\b[^?]{0,40}\b(data|info|information|history|pages?|questions?|chats?|conversations?|anything|messages?)\b|\bwhere\b[^?]{0,30}\b(data|information|info|history|snippets?)\b[^?]{0,20}\b(stored|saved|kept|go|live)\b|\b(cloud|server|servers)\b[^?]{0,30}\b(data|info|information|save|store)\b|\b(privacy|private|personal (data|info))\b/i,
    },
  ];

  /** The topic of a question that could be about soroagent ('data' | 'keys' | 'tracking' | 'opensource'), or ''. */
  function ownTopic(question) {
    const q = String(question || '');
    if (q.length > 240) return ''; // long questions are about the page
    const topic = TOPICS.find((t) => t.re.test(q));
    return topic ? topic.id : '';
  }

  /**
   * Markdown answer about soroagent. ctx: { cloud, providerLabel, autoBackup, autoCapture }.
   */
  function ownAnswer(topic, ctx = {}) {
    const model = ctx.cloud
      ? `**Your AI model:** you're using **${ctx.providerLabel || 'a cloud AI'}** with your own key. When you summarize, ask or research, the page text and your question go to ${ctx.providerLabel || 'that provider'} to get an answer, and their privacy policy applies. Nothing goes to soroagent.`
      : '**Your AI model:** you\'re using a model on your own computer, so page text and your questions never leave this machine.';
    const local = [
      'Everything soroagent keeps (your snippets, screenshots, summary history and settings) is stored **in this browser on your computer**.',
      ctx.autoBackup === false ? '' : 'A backup copy is also kept in your Downloads folder (`Downloads/soroagent/`).',
      ctx.autoCapture === 'on' ? 'Passive capture is on, so pages you actually read are saved too (never mail, chat, banking, logins or checkouts).' : '',
      'There are **no soroagent accounts, servers or cloud storage**. Sync across browsers and the Markdown folder export are optional, and only go where you point them.',
    ].filter(Boolean).join(' ');
    switch (topic) {
      case 'opensource':
        return [
          '**About soroagent:** its code is on GitHub at [github.com/soroagent/owl](https://github.com/soroagent/owl), so anyone can read every line of what it does.',
          'Yes, it\'s **open source under the MIT license**: free to use, change and share. It\'s made by [soroagent.com](https://soroagent.com), and contributions are welcome.',
        ].join('\n\n');
      case 'keys':
        return [
          '**Your API keys:** they\'re encrypted (AES-256) with a key the browser keeps and nothing can export. They live in soroagent\'s private storage, which websites and other extensions can\'t open.',
          'soroagent sends each key only to its own AI provider. Keys are never put in backups, and the settings page only ever shows the last four characters.',
          'Tip: give the key a spending limit in your provider\'s account, and revoke it if a device is lost.',
        ].join('\n\n');
      case 'tracking':
        return [
          '**Tracking:** soroagent has **no analytics, no tracking and no ads**. It doesn\'t report what you browse to anyone.',
          model,
        ].join('\n\n');
      default:
        return [local, model, 'You can export or delete everything any time: Snippets → More, and Settings → Backup & restore.'].join('\n\n');
    }
  }

  Object.assign(soroagent, { ownTopic, ownAnswer });
})(globalThis);

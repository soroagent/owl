// The header shared by Snippets and Settings: the version next to the logo.
(function () {
  'use strict';

  const ext = globalThis.soroagent && globalThis.soroagent.ext;
  const sup = document.getElementById('appVersion');
  if (ext && sup) sup.textContent = `v${ext.runtime.getManifest().version}`;
})();

# Readability (vendored)

Mozilla's article parser (the one behind Firefox Reader View). soroagent uses it as the fallback when
a site profile's selectors find nothing (sites change their markup): `readFallback()` in
`content/extract.js` runs it on a copy of the page. Loaded as a content script before `extract.js`.

| File | Source | SHA-256 |
|---|---|---|
| `Readability.js` | `@mozilla/readability@0.6.0` from npm, unchanged | `34dcab3d0832d0019f02990eed6b6124e029e8c32b9f0c6f2550544ff8dff174` |
| `LICENSE.md` | Apache License 2.0, from the npm package | |

Reproduce or verify: `npm run vendor` (downloads the pinned npm release, checks the tarball's
integrity hash and the SHA-256 above) or `npm run vendor:check` (offline).

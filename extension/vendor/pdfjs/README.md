# pdf.js (vendored)

Reads the text of PDFs for the side panel and the "Summarize this PDF" menu item. Loaded on demand by
`background/pdfread.js`, in the offscreen document (Chrome) or the background page (Firefox).

| File | Source | SHA-256 |
|---|---|---|
| `pdf.min.mjs` | `pdfjs-dist@6.4.299`, `build/pdf.min.mjs` from npm | `57456c8e0c81e46be31174b499ef77f2b9f5ee46d04412ba627320a36755d4c2` |
| `pdf.worker.min.mjs` | `pdfjs-dist@6.4.299`, `build/pdf.worker.min.mjs` from npm | `9536359f1b8367850d485731ca1d5e45c159a7b7a0912325e539937aa21ceb18` |
| `LICENSE` | Apache License 2.0, from the npm package | |

Only text is extracted (no rendering, no fonts, `isEvalSupported: false`). Scanned PDFs (images
only) have no text to read. To update: replace both files from one pdfjs-dist release, update the
table, and read a PDF from the side panel in Chrome and Firefox.

Reproduce or verify: `npm run vendor` (downloads the pinned npm release, checks the tarball's
integrity hash and the SHA-256 above) or `npm run vendor:check` (offline).

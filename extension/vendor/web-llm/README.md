# WebLLM (vendored)

Runs the optional in-browser AI (Qwen2.5-1.5B on WebGPU). Used only when the reader picks
"In-browser AI"; loaded on demand by `background/browserai.js` in the offscreen document (Chrome)
or the background page (Firefox).

| File | Source | SHA-256 |
|---|---|---|
| `index.js` | `@mlc-ai/web-llm@0.2.86`, `lib/index.js` from npm, unmodified | `ae2642e73a4a9896c21efb3a067c4666446f8b49cbe2012f4b576f5d83d5f206` |
| `Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm` | `github.com/mlc-ai/binary-mlc-llm-libs` at commit `00fe7a40e57e5e8eb9fef87526a4bf28ad5846c0`, `web-llm-models/v0_2_86/base/` | `436462adad407e0914d2350fd452a5a3d983e0031d77c940c43ea351c8cd3000` |
| `LICENSE` | Apache License 2.0, from the npm package | |

Both are code, so they ship inside the extension (extensions may not run code fetched from the
web). The model weights are data: they download from
`huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC` (about 880 MB) the first time and stay
in the browser's cache.

Reproduce or verify: `npm run vendor` downloads both again (the npm tarball is checked against the
registry's integrity hash) and checks the SHA-256 above; `npm run vendor:check` verifies offline.
To update: change the pins in `scripts/vendor.mjs`, run `npm run vendor`, update this table, and
test a reply in Chrome.

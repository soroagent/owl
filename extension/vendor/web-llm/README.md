# WebLLM (vendored)

Runs the optional in-browser AI (Qwen2.5-1.5B on WebGPU). Used only when the reader picks
"In-browser AI"; loaded on demand by `background/browserai.js` in the offscreen document (Chrome)
or the background page (Firefox).

| File | Source | SHA-256 |
|---|---|---|
| `index.js` | `@mlc-ai/web-llm@0.2.86`, `lib/index.js` from npm (source-map comment removed) | `7f388c5eb13f9216c0785458e1b70644d22d6c9c2ed2124002ace8f51f0e51ee` |
| `Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm` | `github.com/mlc-ai/binary-mlc-llm-libs`, `web-llm-models/v0_2_86/base/` | `436462adad407e0914d2350fd452a5a3d983e0031d77c940c43ea351c8cd3000` |
| `LICENSE` | Apache License 2.0, from the npm package | |

Both are code, so they ship inside the extension (extensions may not run code fetched from the
web). The model weights are data: they download from
`huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC` (about 880 MB) the first time and stay
in the browser's cache.

To update: replace both files with a matching WebLLM release and model library version, update
the table, and test a reply in Chrome.

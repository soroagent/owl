// Third-party files in extension/vendor/, reproducibly: each comes unmodified from a pinned npm
// release (its tarball checked against the registry's integrity hash) or a pinned git commit, and
// must match the SHA-256 below. Store reviewers can run this to confirm the shipped files are the
// official ones.
//
//   npm run vendor          download everything again and verify it (needs the network)
//   npm run vendor:check    verify the files already in extension/vendor/ (offline; also run by the tests)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VENDOR = join(ROOT, 'extension/vendor');

export const PACKAGES = [
  {
    name: '@mlc-ai/web-llm',
    version: '0.2.86',
    tarball: 'https://registry.npmjs.org/@mlc-ai/web-llm/-/web-llm-0.2.86.tgz',
    integrity: 'sha512-plciXBCYtY7iTKHzEcsqOfSO+s5u8NqMYFPnHmRbsN8CEdKcolgXIoGLPbzO6FtJHV43m7YP00x6qQ6Kb8CJJw==',
    files: { 'package/lib/index.js': 'web-llm/index.js', 'package/LICENSE': 'web-llm/LICENSE' },
  },
  {
    name: 'pdfjs-dist',
    version: '6.4.299',
    tarball: 'https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz',
    integrity: 'sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==',
    files: { 'package/build/pdf.min.mjs': 'pdfjs/pdf.min.mjs', 'package/build/pdf.worker.min.mjs': 'pdfjs/pdf.worker.min.mjs', 'package/LICENSE': 'pdfjs/LICENSE' },
  },
  {
    name: '@mozilla/readability',
    version: '0.6.0',
    tarball: 'https://registry.npmjs.org/@mozilla/readability/-/readability-0.6.0.tgz',
    integrity: 'sha512-juG5VWh4qAivzTAeMzvY9xs9HY5rAcr2E4I7tiSSCokRFi7XIZCAu92ZkSTsIj1OPceCifL3cpfteP3pDT9/QQ==',
    files: { 'package/Readability.js': 'readability/Readability.js', 'package/LICENSE.md': 'readability/LICENSE.md' },
  },
];

// WebLLM's compiled model library for Qwen2.5-1.5B (the version WebLLM 0.2.86 expects), at a pinned commit.
export const DOWNLOADS = [
  {
    url: 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/00fe7a40e57e5e8eb9fef87526a4bf28ad5846c0/web-llm-models/v0_2_86/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm',
    to: 'web-llm/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm',
  },
];

// SHA-256 of every vendored file, as shipped.
export const SHA256 = {
  'web-llm/index.js': 'ae2642e73a4a9896c21efb3a067c4666446f8b49cbe2012f4b576f5d83d5f206',
  'web-llm/LICENSE': '87935f332472db09253871326ef23d5d6a45f4fd2e6c96772f72052866dfab0d',
  'web-llm/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm': '436462adad407e0914d2350fd452a5a3d983e0031d77c940c43ea351c8cd3000',
  'pdfjs/pdf.min.mjs': '57456c8e0c81e46be31174b499ef77f2b9f5ee46d04412ba627320a36755d4c2',
  'pdfjs/pdf.worker.min.mjs': '9536359f1b8367850d485731ca1d5e45c159a7b7a0912325e539937aa21ceb18',
  'pdfjs/LICENSE': '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594',
  'readability/Readability.js': '34dcab3d0832d0019f02990eed6b6124e029e8c32b9f0c6f2550544ff8dff174',
  'readability/LICENSE.md': 'a5b1e8181751ce05b85b7bfaa832b785e87086250a5148e679d17ca9bdcfa958',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** The files of a .tar buffer: { path: Buffer }. (POSIX/ustar, as npm packs them.) */
export function untar(buf) {
  const files = {};
  for (let offset = 0; offset + 512 <= buf.length; ) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '');
    const prefix = field(345, 155);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    offset += 512;
    if (type === '0' || type === '') files[name] = buf.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Verifies the files in extension/vendor/. Returns a list of problems (empty = all good). */
export function check() {
  const problems = [];
  for (const [file, expected] of Object.entries(SHA256)) {
    const path = join(VENDOR, file);
    if (!existsSync(path)) {
      problems.push(`${file}: missing`);
      continue;
    }
    if (expected && sha256(readFileSync(path)) !== expected) problems.push(`${file}: SHA-256 differs from the pinned release`);
  }
  return problems;
}

async function download() {
  for (const pkg of PACKAGES) {
    const tgz = await fetchBuffer(pkg.tarball);
    const [algo, b64] = pkg.integrity.split('-');
    if (createHash(algo).update(tgz).digest('base64') !== b64) throw new Error(`${pkg.name}@${pkg.version}: tarball integrity mismatch`);
    const files = untar(gunzipSync(tgz));
    for (const [from, to] of Object.entries(pkg.files)) {
      if (!files[from]) throw new Error(`${pkg.name}: ${from} not in the tarball`);
      mkdirSync(dirname(join(VENDOR, to)), { recursive: true });
      writeFileSync(join(VENDOR, to), files[from]);
      console.log(`${to}  ←  ${pkg.name}@${pkg.version} ${from}  sha256 ${sha256(files[from])}`);
    }
  }
  for (const d of DOWNLOADS) {
    const buf = await fetchBuffer(d.url);
    writeFileSync(join(VENDOR, d.to), buf);
    console.log(`${d.to}  ←  ${d.url}  sha256 ${sha256(buf)}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv.includes('--check')) await download();
  const problems = check();
  if (problems.length) {
    console.error(`Vendored files don't match:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`All ${Object.keys(SHA256).length} vendored files match their pinned releases.`);
}

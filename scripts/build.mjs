// Builds browser-specific copies of the extension. Pure Node, so it runs the same on macOS and Windows.
//
//   node scripts/build.mjs            -> dist/chrome and dist/firefox
//   node scripts/build.mjs chrome     -> dist/chrome only
//   node scripts/build.mjs --zip      -> also dist/soroagent-<browser>-<version>.zip
//   node scripts/build.mjs --downloads -> also downloads/soroagent-<browser>-<version>.zip (committed) and
//                                        updates the README's download links to that version
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { expandScripts } from './manifest-utils.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'extension');
const DIST = join(ROOT, 'dist');
const BROWSERS = ['chrome', 'firefox'];

const args = process.argv.slice(2);
const downloads = args.includes('--downloads');
// --store: a Chrome Web Store upload (no "key"; the store assigns the extension ID).
const store = args.includes('--store');
const zip = downloads || args.includes('--zip');
const targets = args.filter((a) => BROWSERS.includes(a));
const unknown = args.filter((a) => !['--zip', '--downloads', '--store'].includes(a) && !BROWSERS.includes(a));
if (unknown.length) {
  console.error(`Unknown argument(s): ${unknown.join(', ')}. Use: chrome, firefox, --zip, --downloads`);
  process.exit(1);
}

const base = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));

function manifestFor(browser) {
  const manifest = structuredClone(base);
  for (const script of manifest.content_scripts) script.js = expandScripts(script.js, SRC);
  if (browser === 'chrome') {
    manifest.background = { service_worker: base.background.service_worker };
    delete manifest.browser_specific_settings;
    // A fixed public key pins the extension ID, so updates keep their storage (see keys/README.md).
    const keyFile = join(ROOT, 'keys/chrome-public-key.txt');
    if (!store && existsSync(keyFile)) manifest.key = readFileSync(keyFile, 'utf8').trim();
  } else {
    // Firefox runs background scripts as an event page and rewrites the Origin header with webRequest.
    manifest.background = { scripts: base.background.scripts };
    // Firefox picks the icon for the toolbar's theme itself ("light" = icon for dark themes).
    manifest.action.theme_icons = [16, 32].map((size) => ({ light: `icons/dark/icon-${size}.png`, dark: `icons/icon-${size}.png`, size }));
    manifest.permissions = manifest.permissions
      // Chrome-only: DNR Origin rewrite, the offscreen backup helper, quiet downloads, the side panel.
      .filter((p) => !['declarativeNetRequestWithHostAccess', 'offscreen', 'downloads.ui', 'sidePanel'].includes(p))
      .concat(['webRequest', 'webRequestBlocking']);
    // Firefox's sidebar hosts the same page as Chrome's side panel.
    delete manifest.side_panel;
    manifest.sidebar_action = { default_panel: base.side_panel.default_path, default_title: 'soroagent', default_icon: base.action.default_icon, open_at_install: false };
  }
  return manifest;
}

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

// Minimal ZIP writer (deflate, no external tools).
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeZip(outFile, dir) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of listFiles(dir)) {
    const name = Buffer.from(relative(dir, file).split(sep).join('/'));
    const data = readFileSync(file);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(outFile, Buffer.concat([...locals, centralDir, end]));
}

for (const browser of store ? ['chrome'] : targets.length ? targets : BROWSERS) {
  const out = join(DIST, store ? 'chrome-store' : browser);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // Ship only what the extension needs: no docs, samples or "_template" files, and our generated
  // manifest. Third-party licenses always ship (LICENSE.md included). Firefox gets no WebLLM: AMO
  // can't parse its 6.8 MB bundle (FILE_TOO_LARGE), and Firefox has no Gemini Nano and WebGPU only
  // on some systems, so the in-browser model is Chrome-only.
  const isLicense = (src) => /[\\/]vendor[\\/].*[\\/]LICENSE[^\\/]*$/.test(src);
  cpSync(SRC, out, {
    recursive: true,
    filter: (src) =>
      src !== join(SRC, 'manifest.json') &&
      !/(^|[\\/])_[^\\/]*$/.test(src) &&
      (!src.endsWith('.md') || isLicense(src)) &&
      !/[\\/]samples([\\/]|$)/.test(src) &&
      !(browser === 'firefox' && /[\\/]vendor[\\/]web-llm([\\/]|$)/.test(src)),
  });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifestFor(browser), null, 2) + '\n');
  console.log(`Built ${relative(ROOT, out)}`);

  if (zip) {
    const zipFile = join(DIST, `soroagent-${browser}${store ? '-store' : ''}-${base.version}.zip`);
    writeZip(zipFile, out);
    console.log(`Packed ${relative(ROOT, zipFile)}`);
    if (downloads) {
      const dir = join(ROOT, 'downloads');
      mkdirSync(dir, { recursive: true });
      // Keep only the current version in downloads/; earlier versions stay in git history.
      for (const old of readdirSync(dir)) {
        if (new RegExp(`^soroagent-${browser}(-[\\d.]+)?\\.zip$`).test(old) && old !== `soroagent-${browser}-${base.version}.zip`) {
          rmSync(join(dir, old));
        }
      }
      const published = join(dir, `soroagent-${browser}-${base.version}.zip`);
      copyFileSync(zipFile, published);
      console.log(`Copied to ${relative(ROOT, published)}`);
    }
  }
}

// Point the README's download links and version line at the version just packaged.
if (downloads) {
  const readme = join(ROOT, 'README.md');
  if (existsSync(readme)) {
    const before = readFileSync(readme, 'utf8');
    const after = before
      .replace(/soroagent-(chrome|firefox)(?:-\d+\.\d+\.\d+)?\.zip/g, `soroagent-$1-${base.version}.zip`)
      .replace(/Current version: \*\*v[\d.]+\*\*/g, `Current version: **v${base.version}**`);
    if (after !== before) {
      writeFileSync(readme, after);
      console.log(`Updated README download links to v${base.version}`);
    }
  }
}

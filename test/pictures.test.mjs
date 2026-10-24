import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('shared/config.js', 'content/extract.js');

const shown = { shownWidth: 800, shownHeight: 600 };

test('srcset candidates are read widest first, relative to the page', () => {
  const list = S.parseSrcset('a.jpg 640w, https://cdn.example/b.jpg 2400w, c.jpg 1200w', 'https://site.example/p/');
  assert.deepEqual(list.map((c) => [c.url, c.w]), [
    ['https://cdn.example/b.jpg', 2400],
    ['https://site.example/p/c.jpg', 1200],
    ['https://site.example/p/a.jpg', 640],
  ]);
  assert.deepEqual(S.parseSrcset('photo.jpg, photo@2x.jpg 2x', 'https://s.example/').map((c) => c.x), [2, 1]);
  assert.deepEqual(S.parseSrcset(''), []);
});

test('only genuinely high-resolution pictures shown on the page are offered', () => {
  const picked = S.pickPictures([
    { url: 'https://i.example/photo.jpg', width: 4000, height: 3000, ...shown, alt: '  A  snowy owl ' },
    { url: 'https://i.example/icon.png', width: 64, height: 64, shownWidth: 32, shownHeight: 32 },
    { url: 'https://i.example/medium.jpg', width: 1200, height: 800, ...shown },
    { url: 'https://i.example/photo.jpg?w=2', width: 4000, height: 3000, ...shown }, // same picture
    { url: 'data:image/png;base64,AAAA', width: 3000, height: 3000, ...shown },
    { url: 'https://i.example/logo.svg', width: 3000, height: 3000, ...shown },
    { url: 'https://i.example/hidden.jpg', width: 3000, height: 2000, shownWidth: 0, shownHeight: 0 },
    { url: 'https://i.example/pano.jpg', width: 6000, height: 800, shownWidth: 900, shownHeight: 120 }, // 4.8 MP
    { url: 'https://i.example/tall.jpg', width: 1000, height: 1800, ...shown },
  ]);
  assert.deepEqual(picked.map((p) => p.url), ['https://i.example/photo.jpg', 'https://i.example/pano.jpg', 'https://i.example/tall.jpg']);
  assert.equal(picked[0].alt, 'A snowy owl');
});

test('at most a set number of pictures are offered, largest first', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ url: `https://i.example/${i}.jpg`, width: 2000 + i, height: 1500, ...shown }));
  const picked = S.pickPictures(many, { max: 5 });
  assert.equal(picked.length, 5);
  assert.equal(picked[0].url, 'https://i.example/49.jpg');
});

test('downloaded pictures get readable, safe file names', () => {
  assert.equal(S.pictureFileName('https://upload.example/x/Snowy_Owl_%28240866707%29.jpeg'), 'Snowy_Owl_(240866707).jpg');
  assert.equal(S.pictureFileName('https://cdn.example/3f2a9c1b7d6e5f4a3b2c1d0e9f8a7b6c.png', { alt: 'Owl: in flight?' }), 'Owl in flight.png');
  assert.equal(S.pictureFileName('https://img.example/photo-1501?fm=jpg&format=webp', { host: 'unsplash.com', index: 3 }), 'unsplash.com-3.webp');
  assert.equal(S.pictureFileName('https://img.example/a/', { host: 'example.com', index: 2 }), 'example.com-2.jpg');
});

test('download paths stay inside Downloads/soroagent/pictures', () => {
  assert.equal(S.pictureFolder('www.Example.com'), 'soroagent/pictures/example.com');
  assert.equal(S.pictureFolder('../../etc'), 'soroagent/pictures/etc');
  assert.equal(S.pictureFolder(''), 'soroagent/pictures/pages');
  assert.equal(S.safeFileName('../../.bashrc'), 'bashrc');
  assert.equal(S.safeFileName('a/b\\c:d.jpg'), 'a b c d.jpg');
  assert.equal(S.safeFileName(''), 'picture.jpg');
});

test('the picture offer and follow-up questions are on by default', () => {
  assert.equal(S.DEFAULT_SETTINGS.offerPictures, true);
  assert.deepEqual(S.DEFAULT_SETTINGS.pictureNeverSites, []);
  assert.equal(S.DEFAULT_SETTINGS.followUps, true);
});

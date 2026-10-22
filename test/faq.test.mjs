import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const S = await load('content/faq.js');

test('questions that could be about soroagent are recognized', () => {
  assert.equal(S.ownTopic('Do you save my information on the cloud?'), 'data');
  assert.equal(S.ownTopic('where is my data stored?'), 'data');
  assert.equal(S.ownTopic('Is this an open source project?'), 'opensource');
  assert.equal(S.ownTopic('is my API key safe?'), 'keys');
  assert.equal(S.ownTopic('Do you track me?'), 'tracking');
  assert.equal(S.ownTopic('What are the key points of this article?'), '');
  assert.equal(S.ownTopic('Summarize the main argument'), '');
});

test('answers about soroagent reflect the actual setup', () => {
  const local = S.ownAnswer('data', { cloud: false, autoBackup: true });
  assert.match(local, /in this browser on your computer/);
  assert.match(local, /never leave this machine/);
  assert.match(local, /Downloads\/soroagent/);
  const cloud = S.ownAnswer('data', { cloud: true, providerLabel: 'Anthropic (Claude)', autoBackup: false });
  assert.match(cloud, /go to Anthropic \(Claude\)/);
  assert.doesNotMatch(cloud, /Downloads/);
  assert.match(S.ownAnswer('opensource'), /github\.com\/soroagent\/owl/);
  assert.match(S.ownAnswer('opensource'), /MIT license/);
});

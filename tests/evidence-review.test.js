const test = require('node:test');
const assert = require('node:assert/strict');
const {normalize,compare} = require('../evidence-review.js');

test('keeps a current open-ground observation distinct from historic tree cover', () => {
  const result=compare('Древесная растительность',{kind:'open',source:'map',recordedAt:'2026-10-30'});
  assert.equal(result.status,'conflict');
  assert.equal(result.observation.source,'map');
  assert.equal(result.coverKind,'trees');
});

test('does not claim a comparison without an observation or comparable class', () => {
  assert.equal(compare('Древесная растительность',null).status,'unreviewed');
  assert.equal(compare(null,{kind:'open',source:'field'}).status,'uncomparable');
  assert.equal(compare('Травяной покров',{kind:'open',source:'field'}).status,'match');
});

test('normalizes invalid imported observation values', () => {
  assert.deepEqual(normalize({kind:'verified',source:'satellite',recordedAt:'today'}),{kind:'unknown',source:'map',recordedAt:null});
});

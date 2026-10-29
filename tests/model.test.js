const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../mvp-model.js');

const model = globalThis.ZhasylModel;
const baseline = {base: .75, waterGap: 0, soilPrep: 0, saline: 0, road: 0, shadeMismatch: 0};

test('synthetic model is reproducible and bounded', () => {
  assert.equal(model.trainingRows, 336);
  assert.equal(model.validationRows, 84);
  assert.ok(model.syntheticMae > 0 && model.syntheticMae < .08);
  assert.ok(model.predict(baseline) >= .30 && model.predict(baseline) <= .90);
});

test('more watering improves estimated survival', () => {
  assert.ok(model.predict({...baseline, waterGap: 1}) > model.predict({...baseline, waterGap: -1}));
});

test('saline soil and road pressure reduce estimated survival', () => {
  assert.ok(model.predict({...baseline, saline: 1}) < model.predict(baseline));
  assert.ok(model.predict({...baseline, road: 1}) < model.predict(baseline));
});

const test=require('node:test');
const assert=require('node:assert/strict');
const {parsePoint}=require('../coordinate-input.js');

test('parses the Pavlodar point from a plain pair or labeled coordinates',()=>{
  assert.deepEqual(parsePoint('52.28201, 76.97125'),{coordinates:[76.97125,52.28201],outsidePavlodar:false});
  assert.deepEqual(parsePoint('52.28201° N, 76.97125° E'),{coordinates:[76.97125,52.28201],outsidePavlodar:false});
});

test('flags reversed coordinates instead of adding a wrong point',()=>{
  assert.match(parsePoint('76.97125, 52.28201').error,/перепутаны/);
});

test('rejects missing or out-of-range values and flags other cities',()=>{
  assert.ok(parsePoint('52.28201').error);
  assert.ok(parsePoint('95, 76.97125').error);
  assert.equal(parsePoint('51.1694, 71.4491').outsidePavlodar,true);
});

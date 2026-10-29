const test = require('node:test');
const assert = require('node:assert/strict');
const {plan} = require('../planting-layout.js');

const origin = [76.95, 52.29];
const metresToLon = metres => origin[0] + metres / (111320 * Math.cos(origin[1] * Math.PI / 180));
const metresToLat = metres => origin[1] + metres / 111320;
const polygon = points => ({type:'Polygon',coordinates:[points.map(([x,y])=>[metresToLon(x),metresToLat(y)])]});

test('places requested points inside a polygon at the chosen spacing', () => {
  const square = polygon([[0,0],[40,0],[40,40],[0,40],[0,0]]);
  const result = plan(square, 10, 10);
  assert.equal(result.capacity, 16);
  assert.equal(result.points.length, 10);
  for (const [lon,lat] of result.points) {
    const x = (lon-origin[0]) * 111320 * Math.cos(origin[1]*Math.PI/180);
    const y = (lat-origin[1]) * 111320;
    assert.ok(x >= 4.95 && x <= 35.05 && y >= 4.95 && y <= 35.05);
  }
  for(let i=0;i<result.points.length;i++)for(let j=i+1;j<result.points.length;j++){
    const dx=(result.points[i][0]-result.points[j][0])*111320*Math.cos(origin[1]*Math.PI/180);
    const dy=(result.points[i][1]-result.points[j][1])*111320;
    assert.ok(Math.hypot(dx,dy) >= 9.99);
  }
});

test('reports too few places in a narrow zone without inventing points', () => {
  const narrow = polygon([[0,0],[8,0],[8,40],[0,40],[0,0]]);
  const result = plan(narrow, 4, 10);
  assert.equal(result.capacity, 0);
  assert.deepEqual(result.points, []);
});

test('rejects a point or an unclosed contour', () => {
  assert.match(plan({type:'Point',coordinates:origin}, 5, 8).error,/полигон/);
  assert.match(plan(polygon([[0,0],[20,0],[20,20],[0,20]]), 5, 8).error,/не замкнут/);
});

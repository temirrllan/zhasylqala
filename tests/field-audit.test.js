const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluate,normalize,queueBlocker,planningCandidates}=require('../field-audit.js');

const complete=()=>({
  demo:false,
  geometry:{type:'Polygon',coordinates:[[[76.97,52.28],[76.971,52.28],[76.971,52.281],[76.97,52.28]]]},
  observation:{kind:'open',source:'field'},
  inspection:{visitDate:'2026-10-29',evidenceRef:'Акт 24',notes:'Есть свободный грунт'},
  checks:{soil:'ok',water:'yes',utilities:'clear',overhead:'clear',land:'yes'},
  mvp:{source:'manual',purpose:'courtyard',soil:'loam',light:'sun',road:'no',clearance:9,greenShare:.24},
});

test('real surveyed polygon can move only to expert review',()=>{
  const result=evaluate(complete(),'2026-10-30');
  assert.equal(result.status,'review');
  assert.equal(result.missing.length,0);
  assert.equal(result.blocked.length,0);
  assert.equal(queueBlocker(complete(),'2026-10-30'),null);
});

test('a map guess or missing evidence produces field actions',()=>{
  const site=complete();site.observation.source='map';site.inspection.evidenceRef='';
  const result=evaluate(site,'2026-10-30');
  assert.equal(result.status,'visit');
  assert.ok(result.missing.some(item=>item.includes('Осмотрите')));
  assert.ok(result.missing.some(item=>item.includes('акта')));
  assert.match(queueBlocker(site,'2026-10-30'),/полевое обследование/);
});

test('known utility conflict blocks the site even when other fields are complete',()=>{
  const site=complete();site.checks.overhead='conflict';
  const result=evaluate(site,'2026-10-30');
  assert.equal(result.status,'blocked');
  assert.ok(result.blocked.some(item=>item.includes('воздушными')));
});

test('unknown purpose and unmeasured width stay in the visit queue',()=>{
  const site=complete();site.mvp.purpose='unknown';site.mvp.clearance=null;
  const result=evaluate(site,'2026-10-30');
  assert.equal(result.status,'visit');
  assert.ok(result.missing.some(item=>item.includes('назначение')));
  assert.ok(result.missing.some(item=>item.includes('ширину')));
});

test('demo zones never become real work and future dates are not accepted',()=>{
  const site=complete();site.demo=true;
  assert.equal(evaluate(site,'2026-10-30').status,'demo');
  assert.equal(queueBlocker(site,'2026-10-30'),null);
  site.demo=false;site.inspection.visitDate='2026-11-01';
  assert.equal(evaluate(site,'2026-10-30').status,'visit');
  assert.equal(normalize({visitDate:'2026-02-31',evidenceRef:'  A ',notes:'  B '}).visitDate,null);
});

test('budget queue never mixes real sites with synthetic demonstration zones',()=>{
  const demo={...complete(),id:'demo',demo:true};
  const real={...complete(),id:'real'};
  assert.deepEqual(planningCandidates([demo]),{mode:'demo',sites:[demo]});
  assert.deepEqual(planningCandidates([demo,real]),{mode:'real',sites:[real]});
});

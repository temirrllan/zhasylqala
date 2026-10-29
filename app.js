/* ZhasylQala: transparent demonstration model. No coefficient below is a validated field estimate. */
const STORAGE_KEY = 'zhasylqala-pavlodar-v1';
const LEGACY_STORAGE_KEY = 'qalagreen-pavlodar-v1';
const CITY = [76.9674, 52.2873];
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const LANDCOVER_WMS = 'https://titiler.terrascope.be/wms?service=WMS&version=1.3.0&request=GetMap&layers=esa-worldcover-map-10m-2021-v2_map&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}&time=2021-01-01';
const NDVI_WMS = 'https://titiler.terrascope.be/wms?service=WMS&version=1.3.0&request=GetMap&layers=esa-worldcover-ndvi-10m-2021-v2_ndvi&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}&time=2021-01-01';

const SPECIES = {
  linden: {name:'Липа мелколистная', seedling:22000, planting:12000, careBase:5000, crown:5.2, survival:.73, waterNeed:3},
  poplar: {name:'Тополь белый', seedling:15000, planting:10000, careBase:4200, crown:7.4, survival:.78, waterNeed:2},
  willow: {name:'Ива', seedling:18000, planting:11000, careBase:5000, crown:7.1, survival:.75, waterNeed:3},
  pine: {name:'Сосна', seedling:28000, planting:14000, careBase:6000, crown:4.1, survival:.70, waterNeed:2},
  maple: {name:'Клён', seedling:20000, planting:11000, careBase:4800, crown:5.5, survival:.73, waterNeed:2},
  ash: {name:'Ясень', seedling:21000, planting:12000, careBase:4700, crown:5.6, survival:.74, waterNeed:2},
};
const COVER_CLASSES = {
  '0,100,0': 'Древесная растительность',
  '255,187,34': 'Кустарники',
  '255,255,76': 'Травяной покров',
  '240,150,255': 'Пашня',
  '250,0,0': 'Застройка',
  '180,180,180': 'Открытый грунт',
  '240,240,240': 'Снег и лёд',
  '0,100,200': 'Вода',
  '0,150,160': 'Заболоченная территория',
  '0,207,117': 'Мангры',
  '250,230,160': 'Мхи и лишайники',
};
const CHECK_DEFAULTS = {soil:'unknown',water:'unknown',utilities:'unknown',land:'unknown'};

function defaultScenario(species='linden', count=12, need=2) {
  const tree = SPECIES[species];
  const watering = 2;
  return {species, count, budget:900000, need, watering, seedlingCost:tree.seedling, plantingCost:tree.planting, annualCare:tree.careBase + watering*1500};
}

const DEMO_SITES = [
  {id:'demo-a', name:'Демо-участок A', geometry:{type:'Point',coordinates:[76.9615,52.2893]}, demo:true, scenario:defaultScenario('linden',12,3)},
  {id:'demo-b', name:'Демо-участок B', geometry:{type:'Point',coordinates:[76.9864,52.2805]}, demo:true, scenario:defaultScenario('maple',9,2)},
  {id:'demo-c', name:'Демо-участок C', geometry:{type:'Point',coordinates:[76.9483,52.2747]}, demo:true, scenario:defaultScenario('poplar',15,1)},
];

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('ru-RU', {maximumFractionDigits:0});
const clone = (value) => JSON.parse(JSON.stringify(value));
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
const money = (n) => `${nf.format(Math.round(n))} ₸`;
const sanitizeNumber = (value, fallback, min=0, max=1e10) => Number.isFinite(Number(value)) ? clamp(Number(value),min,max) : fallback;

let state;
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY));
  state = stored && Array.isArray(stored.sites) && stored.sites.length ? stored : null;
} catch { state = null; }
if (!state) state = {sites:clone(DEMO_SITES), selectedId:'demo-a', cityBudget:2000000};
state.sites = state.sites.filter(s => s && s.geometry && ['Point','Polygon'].includes(s.geometry.type)).slice(0,100);
if (!state.sites.length) state.sites = clone(DEMO_SITES);
if (!state.sites.some(s => s.id === state.selectedId)) state.selectedId = state.sites[0].id;
state.cityBudget = sanitizeNumber(state.cityBudget,2000000,0);

let map = null;
let mode = 'select';
let draft = [];
let toastTimer;
const climateCache = new Map();
const coverCache = new Map();
let lastPlan = null;

function save() { try { localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); } catch { /* private browsing */ } }
function selected() { return state.sites.find(s => s.id === state.selectedId) || state.sites[0]; }
function checksFor(site) {
  const raw={...CHECK_DEFAULTS,...(site.checks || {})};
  return {
    soil:['unknown','ok','prep'].includes(raw.soil)?raw.soil:'unknown',
    water:['unknown','yes','no'].includes(raw.water)?raw.water:'unknown',
    utilities:['unknown','clear','conflict'].includes(raw.utilities)?raw.utilities:'unknown',
    land:['unknown','yes','no'].includes(raw.land)?raw.land:'unknown',
  };
}
function checkIssues(site) {
  const c=checksFor(site), issues=[], blockers=[];
  if(c.soil==='unknown') issues.push('почва');
  if(c.soil==='prep') issues.push('подготовка почвы');
  if(c.water==='unknown') issues.push('источник воды');
  if(c.water==='no') blockers.push('нет подтверждённого источника воды для ухода');
  if(c.utilities==='unknown') issues.push('подземные сети');
  if(c.utilities==='conflict') blockers.push('конфликт с подземными сетями');
  if(c.land==='unknown') issues.push('право на участок');
  if(c.land==='no') blockers.push('посадка на участке не согласована');
  const review=EvidenceReview.compare(site.coverClass,site.observation);
  if(review.status==='conflict') {
    const message='WorldCover 2021 расходится с ручной отметкой поверхности';
    if(review.observation.source==='map') blockers.push(`${message}: нужен осмотр на месте`);
    else issues.push(`${message}: проверьте границы участка и сохраните полевое подтверждение`);
  } else {
    if(site.coverClass==='Древесная растительность') issues.push('свободное место: WorldCover 2021 помечает центральную ячейку как древесный покров');
    if(site.coverClass==='Застройка') issues.push('доступный грунт: WorldCover 2021 помечает центральную ячейку как застройку');
    if(site.coverClass==='Вода') issues.push('актуальное состояние: WorldCover 2021 помечает центральную ячейку как воду');
  }
  if(review.observation.source==='field' && ['built','water'].includes(review.observation.kind)) blockers.push('по ручной отметке осмотра нет доступного грунта для посадки');
  return {issues,blockers};
}
function centroid(geometry) {
  if (geometry.type === 'Point') return geometry.coordinates;
  const ring = geometry.coordinates?.[0] || [];
  const points = ring.length > 1 && ring[0][0] === ring[ring.length-1][0] ? ring.slice(0,-1) : ring;
  if (!points.length) return CITY;
  return [points.reduce((s,p)=>s+p[0],0)/points.length,points.reduce((s,p)=>s+p[1],0)/points.length];
}
function toast(message) { const box=$('toast'); box.textContent=message; box.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>box.classList.remove('show'),3300); }
function scenarioFor(site) {
  const s = {...defaultScenario(),...(site.scenario || {})};
  if (!SPECIES[s.species]) s.species='linden';
  s.count=Math.round(sanitizeNumber(s.count,12,1,5000));
  s.watering=Math.round(sanitizeNumber(s.watering,2,0,4));
  s.need=Math.round(sanitizeNumber(s.need,2,1,3));
  s.seedlingCost=sanitizeNumber(s.seedlingCost,22000,0);
  s.plantingCost=sanitizeNumber(s.plantingCost,12000,0);
  s.annualCare=sanitizeNumber(s.annualCare,8000,0);
  s.budget=sanitizeNumber(s.budget,900000,0);
  return s;
}
function calculate(site) {
  const s=scenarioFor(site), tree=SPECIES[s.species];
  const probability=clamp(tree.survival+(s.watering-tree.waterNeed)*.07,.30,.90);
  const surviving=s.count*probability;
  const replacement=s.count*(1-probability)*(s.seedlingCost+s.plantingCost);
  const total=s.count*(s.seedlingCost+s.plantingCost+s.annualCare*3)+replacement;
  const canopy=surviving*tree.crown;
  return {s,probability,surviving,replacement,total,canopy};
}

function renderChecks(site) {
  const c=checksFor(site), result=checkIssues(site), box=$('checkStatus');
  site.checks=c;
  $('soilCheck').value=c.soil;
  $('waterCheck').value=c.water;
  $('utilityCheck').value=c.utilities;
  $('landCheck').value=c.land;
  box.className='check-status'+(result.blockers.length?' blocked':result.issues.length?'':' ready');
  if(result.blockers.length) box.textContent=`Не включать в план: ${result.blockers.join('; ')}.`;
  else if(result.issues.length) box.textContent=`Предварительный сценарий. Проверить: ${result.issues.join(', ')}.`;
  else box.textContent='Базовые проверки отмечены. Породу и место посадки должен подтвердить специалист.';
}
function renderEvidenceReview(site) {
  const review=EvidenceReview.compare(site.coverClass,site.observation),o=review.observation;
  $('surfaceObservation').value=o.kind;
  $('observationSource').value=o.source;
  $('observationDate').textContent=o.recordedAt?`Отмечено ${o.recordedAt} · ${EvidenceReview.SOURCES[o.source]}.`:'';
  const box=$('evidenceComparison');
  box.className='evidence-comparison '+review.status;
  if(review.status==='unreviewed') box.textContent='Укажите, что видно сейчас. Это ваша отметка, приложение её не проверяет.';
  else if(review.status==='uncomparable') box.textContent='Отметка сохранена. Нет сопоставимого класса WorldCover для этой точки.';
  else if(review.status==='match') box.textContent='Отметка совпадает с классом WorldCover 2021. Точное место посадки всё равно нужно проверить на месте.';
  else if(o.source==='map') box.textContent='Расхождение с WorldCover 2021. Зона не войдёт в бюджетный план до осмотра на месте.';
  else box.textContent='Расхождение с WorldCover 2021 сохранено. Полевую отметку ввёл пользователь; границы и место посадки нужно подтвердить.';
}

function comparisonOptions(site) {
  const current=scenarioFor(site);
  return Object.entries(SPECIES).map(([id,tree])=>{
    const scenario={...current,species:id,seedlingCost:tree.seedling,plantingCost:tree.planting,annualCare:tree.careBase+current.watering*1500};
    return {id,tree,result:calculate({scenario})};
  });
}
function renderRecommendations(site) {
  const blockers=checkIssues(site).blockers;
  if(blockers.length) {
    $('recommendationList').innerHTML=`<div class="recommend-blocked">Сначала устраните ограничение: ${esc(blockers.join('; '))}.</div>`;
    return;
  }
  const goal=$('compareGoal').value;
  const options=comparisonOptions(site);
  options.sort((a,b)=>{
    if(goal==='cost') return a.result.total-b.result.total;
    if(goal==='survival') return b.result.surviving-a.result.surviving || a.result.total-b.result.total;
    if(goal==='canopy') return b.result.canopy-a.result.canopy || a.result.total-b.result.total;
    return b.result.canopy/Math.max(b.result.total,1)-a.result.canopy/Math.max(a.result.total,1);
  });
  $('recommendationList').innerHTML=options.slice(0,3).map((option,index)=>{
    const r=option.result, waterGap=r.s.watering<option.tree.waterNeed;
    return `<article class="recommend-card"><div class="recommend-title"><span>${index+1}</span><strong>${esc(option.tree.name)}</strong><button type="button" data-apply-species="${option.id}">Выбрать</button></div><div class="recommend-metrics"><span>${money(r.total)}</span><span>≈ ${nf.format(r.surviving)} живых</span><span>≈ ${nf.format(r.canopy)} м² кроны</span></div><p>${waterGap?'Выбранный полив ниже условной потребности этой породы.':'Полив соответствует условному уровню в модели.'} Совместимость с почвой требует проверки.</p></article>`;
  }).join('');
  $('recommendationList').querySelectorAll('[data-apply-species]').forEach(btn=>btn.addEventListener('click',()=>{
    const tree=SPECIES[btn.dataset.applySpecies];
    $('speciesSelect').value=btn.dataset.applySpecies;
    $('seedlingCost').value=tree.seedling;
    $('plantingCost').value=tree.planting;
    $('annualCare').value=tree.careBase+Number($('watering').value)*1500;
    readForm();toast(`${tree.name}: сценарий применён. Проверьте условия участка.`);
  }));
}

function coverInfoUrl(coord) {
  const [lon,lat]=coord, radius=6378137;
  const x=radius*lon*Math.PI/180, y=radius*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
  const query=new URLSearchParams({service:'WMS',version:'1.3.0',request:'GetFeatureInfo',layers:'esa-worldcover-map-10m-2021-v2_map',query_layers:'esa-worldcover-map-10m-2021-v2_map',styles:'',crs:'EPSG:3857',bbox:`${y-128},${x-128},${y+128},${x+128}`,width:'256',height:'256',i:'128',j:'128',format:'image/png',info_format:'application/geo+json',time:'2021-01-01'});
  return `https://titiler.terrascope.be/wms?${query}`;
}
async function coverSample(coord) {
  const response=await fetch(coverInfoUrl(coord),{signal:AbortSignal.timeout(12000)});
  if(!response.ok) throw new Error(`WorldCover HTTP ${response.status}`);
  const data=await response.json(), feature=data.features?.[0];
  const returned=feature?.geometry?.coordinates;
  if(!returned || Math.abs(returned[0]-coord[0])>.002 || Math.abs(returned[1]-coord[1])>.002) throw new Error('Координаты ответа WorldCover не совпали');
  const p=feature.properties || {}, rgb=[p.band_1,p.band_2,p.band_3].map(Number).join(',');
  return COVER_CLASSES[rgb] || 'Класс не определён';
}
async function loadCoverContext(site) {
  const center=centroid(site.geometry), key=center.map(n=>n.toFixed(5)).join(',');
  $('coverBadge').textContent='ESA · ЗАГРУЗКА';
  $('coverClass').textContent='Загружаем…';
  $('coverDetails').textContent='Проверяем классификацию для точки и рядом с ней.';
  if(!coverCache.has(key)) {
    const lat=center[1], dLat=40/111320, dLon=40/(111320*Math.cos(lat*Math.PI/180));
    const points=[center,[center[0]+dLon,lat],[center[0]-dLon,lat],[center[0],lat+dLat],[center[0],lat-dLat]];
    coverCache.set(key,Promise.allSettled(points.map(coverSample)).then(results=>results.map(r=>r.status==='fulfilled'?r.value:null)));
  }
  try {
    const labels=await coverCache.get(key);
    if(selected().id!==site.id) return;
    const valid=labels.filter(Boolean), counts=new Map();
    valid.forEach(label=>counts.set(label,(counts.get(label)||0)+1));
    $('coverBadge').textContent='ESA · 2021';
    $('coverClass').textContent=labels[0] || 'В центральной точке нет данных';
    const previousClass=site.coverClass;
    site.coverClass=labels[0] || null;
    site.coverGreenSample=valid.length?valid.filter(label=>['Древесная растительность','Кустарники','Травяной покров'].includes(label)).length/valid.length:null;
    site.coverSampleCount=valid.length;
    $('coverDetails').textContent=valid.length?`Из ${valid.length} ответов WorldCover: ${[...counts.entries()].map(([label,n])=>`${label.toLowerCase()} — ${n}`).join(' · ')}. Это классы ячеек 2021 года, а не подсчёт деревьев или подтверждение текущего состояния.${site.coverClass==='Древесная растительность'?' Проверьте, есть ли сейчас свободное место.':''}`:'Сервис сейчас не вернул класс поверхности. Проверьте участок вручную.';
    renderEvidenceReview(site);renderChecks(site);renderRecommendations(site);
    if(previousClass!==site.coverClass)invalidatePlan();
    save();
    window.onCoverContextLoaded?.(site);
  } catch {
    coverCache.delete(key);
    if(selected().id===site.id){
      const previousClass=site.coverClass;
      site.coverClass=null;
      $('coverBadge').textContent='НЕТ ДАННЫХ';$('coverClass').textContent='WorldCover недоступен';$('coverDetails').textContent='Проверьте поверхность на местности.';
      renderEvidenceReview(site);renderChecks(site);renderRecommendations(site);
      if(previousClass!==null)invalidatePlan();
      save();window.onCoverContextLoaded?.(site);
    }
  }
}

function renderSites() {
  $('siteCount').textContent=String(state.sites.length).padStart(2,'0');
  $('planCount').textContent=`${String(state.sites.length).padStart(2,'0')} / ${String(state.sites.length).padStart(2,'0')}`;
  $('sitesList').innerHTML=state.sites.map((site,i)=>{
    const active=site.id===state.selectedId;
    const c=centroid(site.geometry);
    return `<button type="button" class="site-card ${active?'active':''}" data-site="${esc(site.id)}" aria-current="${active?'true':'false'}"><span class="site-index">${String(i+1).padStart(2,'0')}</span><span class="site-info"><strong>${esc(site.name)}</strong><small>${site.geometry.type==='Polygon'?(site.demo?'Демо-зона':'Нарисованный участок'):(site.demo?'Демонстрационная точка':'Добавленная точка')} · ${c[1].toFixed(3)}° N</small></span><span class="site-arrow">↗</span></button>`;
  }).join('');
  $('sitesList').querySelectorAll('[data-site]').forEach(btn=>btn.addEventListener('click',()=>chooseSite(btn.dataset.site,true)));
}

function renderScenario() {
  const site=selected(), c=centroid(site.geometry), result=calculate(site), s=result.s;
  site.scenario=s;
  $('selectedName').textContent=site.name;
  $('siteName').value=site.name;
  document.querySelector('.demo-pill').hidden=!site.demo;
  $('deleteSiteBtn').hidden=Boolean(site.demo);
  $('selectedMeta').textContent=site.geometry.type==='Polygon'?(site.demo?'Синтетическая зона · осмотр не проведён':'Участок отмечен вручную · осмотр не проведён'):(site.demo?'Примерная точка на карте · осмотр не проведён':'Точка отмечена вручную · осмотр не проведён');
  $('selectedCoords').textContent=`${c[1].toFixed(5)}° N, ${c[0].toFixed(5)}° E`;
  $('speciesSelect').value=s.species;
  $('treeCount').value=s.count;
  $('budget').value=s.budget;
  $('watering').value=s.watering;
  $('wateringValue').textContent=s.watering===0?'нет':`${s.watering} ${s.watering===1?'раз':'раза'} / неделю`;
  $('seedlingCost').value=s.seedlingCost;
  $('plantingCost').value=s.plantingCost;
  $('annualCare').value=s.annualCare;
  $('survivingTrees').textContent=`≈ ${nf.format(result.surviving)}`;
  $('survivalRate').textContent=`из ${s.count} · ${Math.round(result.probability*100)}%`;
  $('totalCost').textContent=money(result.total);
  $('canopyArea').textContent=`≈ ${nf.format(result.canopy)} м²`;
  const budget=$('budgetState');
  budget.classList.toggle('over',result.total>s.budget);
  if (result.total>s.budget) {
    const perTree=result.total/s.count;
    budget.textContent=`Превышение: ${money(result.total-s.budget)} · в лимит поместится около ${nf.format(Math.floor(s.budget/perTree))} деревьев`;
  } else budget.textContent=`В пределах лимита · остаток ${money(s.budget-result.total)}`;
  renderEvidenceReview(site);
  renderChecks(site);
  renderRecommendations(site);
  save();
  loadClimate(c);
  loadCoverContext(site);
}
function chooseSite(id,fly=false) {
  if (!state.sites.some(s=>s.id===id)) return;
  state.selectedId=id;
  renderSites(); renderScenario(); refreshMapData();
  if (fly) focusSite();
}
function focusSite() {
  if (!map) return;
  const site=selected();
  if (site.geometry.type==='Polygon') {
    const ring=site.geometry.coordinates[0];
    const bounds=ring.reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds(ring[0],ring[0]));
    map.fitBounds(bounds,{padding:80,maxZoom:16,duration:500});
  } else map.flyTo({center:site.geometry.coordinates,zoom:14.5,duration:550});
}

function readForm() {
  const site=selected(); if (!site) return;
  const s=site.scenario || defaultScenario();
  s.species=$('speciesSelect').value in SPECIES?$('speciesSelect').value:'linden';
  s.count=Math.round(sanitizeNumber($('treeCount').value,s.count,1,5000));
  s.budget=sanitizeNumber($('budget').value,s.budget,0);
  s.watering=Math.round(sanitizeNumber($('watering').value,s.watering,0,4));
  s.seedlingCost=sanitizeNumber($('seedlingCost').value,s.seedlingCost,0);
  s.plantingCost=sanitizeNumber($('plantingCost').value,s.plantingCost,0);
  s.annualCare=sanitizeNumber($('annualCare').value,s.annualCare,0);
  site.scenario=s; renderScenario();invalidatePlan();
}

function setMode(next) {
  mode=next; draft=[]; updateDraft();
  document.querySelectorAll('.tool-btn').forEach(btn=>{const active=btn.dataset.mode===mode;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',String(active));});
  document.querySelector('.map-stage').classList.toggle('mode-point',mode==='point');
  document.querySelector('.map-stage').classList.toggle('mode-polygon',mode==='polygon');
  $('toolHint').textContent=mode==='point'?'Нажмите на карту, чтобы поставить новую точку.':mode==='polygon'?'Нажимайте для вершин. Двойной щелчок завершит участок; Esc отменит.':'Выберите точку на карте или участок в списке.';
}
function addSite(geometry) {
  if(state.sites.length>=100){toast('В локальном плане максимум 100 участков.');return false;}
  const n=state.sites.filter(s=>!s.demo).length+1;
  const site={id:`site-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,name:`Участок ${n}`,geometry,demo:false,scenario:defaultScenario('linden',10,2),checks:clone(CHECK_DEFAULTS)};
  state.sites.push(site); chooseSite(site.id,false); setMode('select'); focusSite(); invalidatePlan();toast('Участок добавлен. Он сохранён в этом браузере.');
  return true;
}
function updateDraft() {
  if (!map?.getSource('draft')) return;
  const features=[];
  if (draft.length) features.push({type:'Feature',geometry:{type:'LineString',coordinates:draft},properties:{}});
  for (const coord of draft) features.push({type:'Feature',geometry:{type:'Point',coordinates:coord},properties:{}});
  map.getSource('draft').setData({type:'FeatureCollection',features});
}
function finishPolygon() {
  const unique=draft.filter((p,i,a)=>i===0 || Math.abs(p[0]-a[i-1][0])>1e-7 || Math.abs(p[1]-a[i-1][1])>1e-7);
  if (unique.length<3) { toast('Для участка нужны минимум три разные точки.'); return; }
  addSite({type:'Polygon',coordinates:[[...unique,unique[0]]]});
}
function geojson() {
  return {type:'FeatureCollection',name:'ZhasylQala Pavlodar plan',features:state.sites.map(site=>({type:'Feature',id:site.id,geometry:site.geometry,properties:{name:site.name,demo:site.demo,scenario:scenarioFor(site),checks:checksFor(site),observation:site.observation?EvidenceReview.normalize(site.observation):null,mvp:site.mvp||null,model:'synthetic-expert-logistic-v1'}}))};
}
function exportGeoJSON() {
  const blob=new Blob([JSON.stringify(geojson(),null,2)],{type:'application/geo+json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='zhasylqala-pavlodar-plan.geojson';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('План GeoJSON скачан.');
}
function validCoordinate(c) { return Array.isArray(c)&&c.length>=2&&Number.isFinite(c[0])&&Number.isFinite(c[1])&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90; }
function validGeometry(g) {
  return g?.type==='Point'?validCoordinate(g.coordinates):g?.type==='Polygon'&&Array.isArray(g.coordinates?.[0])&&g.coordinates[0].length>=4&&g.coordinates[0].every(validCoordinate);
}
function segmentsCross(a,b,c,d) {
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const x=cross(a,b,c),y=cross(a,b,d),u=cross(c,d,a),v=cross(c,d,b);
  return x*y<0&&u*v<0;
}
function polygonSelfIntersects(ring) {
  for(let i=0;i<ring.length-1;i++)for(let j=i+2;j<ring.length-1;j++){
    if(i===0&&j===ring.length-2)continue;
    if(segmentsCross(ring[i],ring[i+1],ring[j],ring[j+1]))return true;
  }
  return false;
}
function geometryError(g) {
  if(!validGeometry(g))return 'неверный тип или координаты';
  if(g.type==='Polygon'){
    if(g.coordinates.length!==1)return 'полигоны с отверстиями пока не поддерживаются';
    const ring=g.coordinates[0],start=ring[0],end=ring[ring.length-1];
    if(Math.abs(start[0]-end[0])>1e-9||Math.abs(start[1]-end[1])>1e-9)return 'контур полигона не замкнут';
    if(new Set(ring.slice(0,-1).map(p=>p.join(','))).size<3)return 'меньше трёх разных вершин';
    if(polygonSelfIntersects(ring))return 'самопересечение полигона';
  }
  return null;
}
async function importGeoJSON(file) {
  if (!file) return;
  if (file.size>2e6) { toast('Файл слишком большой: максимум 2 МБ.'); return; }
  try {
    const parsed=JSON.parse(await file.text());
    const crs=parsed.crs?.properties?.name;
    if(crs&&!/^(EPSG:4326|urn:ogc:def:crs:OGC::CRS84)$/i.test(crs))throw new Error(`ожидаются координаты WGS84, указан ${crs}`);
    const features=parsed.type==='FeatureCollection'?parsed.features:parsed.type==='Feature'?[parsed]:[];
    if(!Array.isArray(features))throw new Error('ожидается FeatureCollection или Feature');
    const bad=features.map((f,i)=>({i,error:geometryError(f?.geometry)})).filter(row=>row.error);
    const valid=features.filter(f=>!geometryError(f?.geometry)).slice(0,Math.max(0,Math.min(50,100-state.sites.length)));
    if (!valid.length) throw new Error('Нет подходящих точек или полигонов');
    for (const f of valid) {
      const id=`import-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const name=typeof f.properties?.name==='string'?f.properties.name.slice(0,70):`Импорт ${state.sites.length+1}`;
      const raw=f.properties?.scenario;
      const scenario=raw && typeof raw==='object'?{...defaultScenario(),...raw}:defaultScenario();
      const checks=f.properties?.checks && typeof f.properties.checks==='object'?f.properties.checks:CHECK_DEFAULTS;
      const observation=f.properties?.observation&&typeof f.properties.observation==='object'?EvidenceReview.normalize(f.properties.observation):null;
      state.sites.push({id,name,geometry:f.geometry,demo:false,scenario,checks,observation,mvp:f.properties?.mvp&&typeof f.properties.mvp==='object'?f.properties.mvp:null});
    }
    chooseSite(state.sites[state.sites.length-valid.length].id,true);
    invalidatePlan();
    const warning=bad.length?` Пропущено ${bad.length}: ${bad.slice(0,3).map(row=>`№${row.i+1} — ${row.error}`).join('; ')}.`:'';
    const outside=valid.filter(f=>{const c=centroid(f.geometry);return c[0]<75.5||c[0]>78||c[1]<51.5||c[1]>53;}).length;
    $('importQuality').textContent=`Импортировано ${valid.length} из ${features.length}. ${warning}${outside?` ${outside} объектов вне района Павлодара — проверьте координаты.`:''} Данные не считаются проверенными.`;
    toast(`Загружено участков: ${valid.length}.${bad.length?` Пропущено: ${bad.length}.`:''}`);
  } catch (error) { $('importQuality').textContent=`Ошибка импорта: ${error.message}`;toast(`Не удалось загрузить GeoJSON: ${error.message}`); }
  $('geojsonFile').value='';
}

function refreshMapData() {
  if (!map?.getSource('sites')) return;
  const data=geojson();
  data.features.forEach(f=>f.properties.selected=f.id===state.selectedId);
  map.getSource('sites').setData(data);
}
function addOverlay(id,url,before) {
  if (map.getSource(id)) return;
  map.addSource(id,{type:'raster',tiles:[url],tileSize:256,maxzoom:17,attribution:'© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium'});
  map.addLayer({id,type:'raster',source:id,layout:{visibility:'none'},paint:{'raster-opacity':id==='landcover'?.42:.56}},before);
}
function toggleLayer(id,checked) {
  if (!map?.getLayer(id)) { toast('Карта ещё загружается.'); return; }
  if (checked) {
    const other=id==='landcover'?'ndvi':'landcover';
    $(other+'Toggle').checked=false;
    map.setLayoutProperty(other,'visibility','none');
  }
  map.setLayoutProperty(id,'visibility',checked?'visible':'none');
  $('coverLegend').hidden=!(id==='landcover'&&checked);
  $('layerStatus').textContent=checked?`${id==='landcover'?'Покров земли':'NDVI'}: открытый слой ESA за 2021 год. Это обзорный контекст, не проверка места посадки.`:'Спутниковые слои показывают районный контекст, а не пригодность конкретной ямы.';
}

function initMap() {
  if (!window.maplibregl) { $('mapLoading').classList.add('error'); $('mapLoading').innerHTML='Не загрузилась библиотека карты. Проверьте интернет и обновите страницу.'; return; }
  map=new maplibregl.Map({container:'map',style:MAP_STYLE,center:CITY,zoom:12.4,attributionControl:true});
  map.dragRotate.disable();map.touchZoomRotate.disableRotation();map.doubleClickZoom.disable();
  map.on('load',()=>{
    $('mapLoading').classList.add('hidden');
    const firstSymbol=map.getStyle().layers.find(layer=>layer.type==='symbol')?.id;
    addOverlay('landcover',LANDCOVER_WMS,firstSymbol);
    addOverlay('ndvi',NDVI_WMS,firstSymbol);
    map.addSource('sites',{type:'geojson',data:geojson()});
    map.addLayer({id:'site-fill',type:'fill',source:'sites',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['case',['get','selected'],'#2d8154','#78a178'],'fill-opacity':.34}});
    map.addLayer({id:'site-outline',type:'line',source:'sites',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':['case',['get','selected'],'#175838','#457b55'],'line-width':3}});
    map.addLayer({id:'site-halo',type:'circle',source:'sites',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':['case',['get','selected'],17,14],'circle-color':'#ffffff','circle-opacity':.88}});
    map.addLayer({id:'site-points',type:'circle',source:'sites',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':['case',['get','selected'],10,8],'circle-color':['case',['get','selected'],'#1e6b45','#52916a'],'circle-stroke-color':'#fff','circle-stroke-width':2}});
    map.addSource('draft',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'draft-line',type:'line',source:'draft',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#185d40','line-width':3,'line-dasharray':[2,2]}});
    map.addLayer({id:'draft-points',type:'circle',source:'draft',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':5,'circle-color':'#185d40','circle-stroke-color':'#fff','circle-stroke-width':2}});
    refreshMapData();
    for (const layer of ['site-points','site-fill']) map.on('click',layer,(e)=>{if (mode==='select'&&e.features?.[0]) chooseSite(String(e.features[0].id || e.features[0].properties.id),false);});
    map.on('click',(e)=>{
      if (mode==='point') addSite({type:'Point',coordinates:[e.lngLat.lng,e.lngLat.lat]});
      if (mode==='polygon') { const p=[e.lngLat.lng,e.lngLat.lat];if(!draft.length||Math.abs(p[0]-draft[draft.length-1][0])>1e-7||Math.abs(p[1]-draft[draft.length-1][1])>1e-7){draft.push(p);updateDraft();} }
    });
    map.on('dblclick',(e)=>{if(mode==='polygon'){e.preventDefault();finishPolygon();}});
    map.on('mousemove',(e)=>{$('mapCoordinate').textContent=`${e.lngLat.lat.toFixed(4)}° N · ${e.lngLat.lng.toFixed(4)}° E`;});
  });
  map.on('error',e=>{
    if (e.sourceId==='landcover'||e.sourceId==='ndvi') $('layerStatus').textContent='Слой ESA сейчас недоступен. Основная карта и расчёт продолжают работать.';
    if (!map.loaded() && e.error) $('mapLoading').innerHTML='Не удалось загрузить картографическую подложку. Проверьте интернет и обновите страницу.';
  });
}

async function loadClimate(coord) {
  const key=`${coord[1].toFixed(2)},${coord[0].toFixed(2)}`;
  const isCurrent=()=>{const current=centroid(selected().geometry);return `${current[1].toFixed(2)},${current[0].toFixed(2)}`===key;};
  if (climateCache.has(key)) { if(isCurrent()) showClimate(climateCache.get(key)); return; }
  $('climateBadge').textContent='ЗАГРУЗКА';
  $('climateContent').textContent='Получаем исторические данные Open-Meteo…';
  const url=new URL('https://archive-api.open-meteo.com/v1/archive');
  url.search=new URLSearchParams({latitude:coord[1].toFixed(4),longitude:coord[0].toFixed(4),start_date:'2023-01-01',end_date:'2025-12-31',daily:'temperature_2m_max,precipitation_sum',timezone:'Asia/Almaty',models:'era5'}).toString();
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json=await response.json();
    const dates=json.daily?.time||[], temp=json.daily?.temperature_2m_max||[], rain=json.daily?.precipitation_sum||[];
    if (!dates.length) throw new Error('нет данных');
    let summerSum=0,summerN=0,totalRain=0,rainYears=new Set();
    dates.forEach((date,i)=>{const month=Number(date.slice(5,7)); if(month>=6&&month<=8&&Number.isFinite(temp[i])){summerSum+=temp[i];summerN++;} if(Number.isFinite(rain[i])){totalRain+=rain[i];rainYears.add(date.slice(0,4));}});
    const result={summerMax:summerN?summerSum/summerN:null,annualRain:rainYears.size?totalRain/rainYears.size:null};
    climateCache.set(key,result);if(isCurrent()) showClimate(result);
  } catch { if(isCurrent()){$('climateBadge').textContent='НЕТ ДАННЫХ';$('climateContent').innerHTML='<span class="climate-error">Open-Meteo сейчас недоступен. Прогноз в демо рассчитывается по заданным допущениям.</span>'; } }
}
function showClimate(data) {
  $('climateBadge').textContent='OPEN-METEO';
  $('climateContent').innerHTML=`<div class="climate-metric"><strong>${data.summerMax===null?'—':data.summerMax.toFixed(1)+' °C'}</strong><span>средний дневной максимум летом · 2023–25</span></div><div class="climate-metric"><strong>${data.annualRain===null?'—':Math.round(data.annualRain)+' мм'}</strong><span>средние осадки в год · 2023–25</span></div>`;
}

function planCity() {
  state.cityBudget=sanitizeNumber($('cityBudget').value,state.cityBudget,0);
  $('cityBudget').value=state.cityBudget;
  const all=state.sites.map(site=>({site,result:calculate(site),blockers:checkIssues(site).blockers}));
  const excluded=all.filter(row=>row.blockers.length || row.result.total>row.result.s.budget);
  const rows=all.filter(row=>!excluded.includes(row));
  let picked=[];
  if(rows.length<=18) {
    let bestScore=0,bestSpent=0,bestMask=0;
    for(let mask=1;mask<(1<<rows.length);mask++) {
      let spent=0,score=0;
      for(let i=0;i<rows.length;i++) if(mask&(1<<i)) {
        spent+=rows[i].result.total;
        if(spent>state.cityBudget) break;
        score+=rows[i].result.s.need*rows[i].result.canopy;
      }
      if(spent<=state.cityBudget && (score>bestScore || score===bestScore&&spent<bestSpent)) {bestScore=score;bestSpent=spent;bestMask=mask;}
    }
    picked=rows.filter((_,i)=>bestMask&(1<<i));
  } else {
    rows.sort((a,b)=>(b.result.s.need*b.result.canopy/Math.max(b.result.total,1))-(a.result.s.need*a.result.canopy/Math.max(a.result.total,1)));
    let spent=0;
    for(const row of rows) if(spent+row.result.total<=state.cityBudget){picked.push(row);spent+=row.result.total;}
  }
  picked.sort((a,b)=>b.result.s.need-a.result.s.need);
  const spent=picked.reduce((sum,row)=>sum+row.result.total,0);
  lastPlan={picked,excluded,spent,exact:rows.length<=18};
  const box=$('priorityResult');
  if (!picked.length) box.textContent=rows.length?'В этот бюджет не помещается ни один полный сценарий. Уменьшите количество деревьев или измените смету.':'Все участки имеют ограничения или превышают свой лимит. Сначала измените сценарии.';
  else box.innerHTML=`<strong>${picked.length} из ${state.sites.length} участков · ${money(spent)}</strong><ol>${picked.map(r=>`<li>${esc(r.site.name)} — ${money(r.result.total)}</li>`).join('')}</ol><span>${excluded.length?`Исключено: ${excluded.map(row=>`${esc(row.site.name)} (${esc(row.blockers[0] || 'превышен лимит участка')})`).join(', ')}. `:''}Цель: максимум суммы «потребность × ожидаемая крона» при общем бюджете. ${rows.length<=18?'Набор найден точным перебором полных сценариев.':'Для более 18 участков применена приближённая сортировка.'} Непроверенные условия остаются предварительными.</span>`;
  save();
}

function invalidatePlan() { lastPlan=null;$('priorityResult').textContent='Параметры изменились. Нажмите «Составить план», чтобы обновить очередь.'; }
function readChecks() {
  const site=selected();
  site.checks={soil:$('soilCheck').value,water:$('waterCheck').value,utilities:$('utilityCheck').value,land:$('landCheck').value};
  renderChecks(site);renderRecommendations(site);invalidatePlan();save();
}
function downloadReport() {
  planCity();
  const rows=state.sites.map(site=>({site,r:calculate(site),check:checkIssues(site)}));
  const date=new Intl.DateTimeFormat('ru-RU',{dateStyle:'long'}).format(new Date());
  const planSummary=lastPlan.picked.length?`<h2>Очередь в общем бюджете</h2><p>Выбрано ${lastPlan.picked.length} из ${state.sites.length} участков; стоимость ${money(lastPlan.spent)} из ${money(state.cityBudget)}. ${lastPlan.exact?'Набор найден точным перебором полных сценариев.':'Набор найден приближённой сортировкой.'}</p><ol>${lastPlan.picked.map(row=>`<li>${esc(row.site.name)} — ${money(row.result.total)}</li>`).join('')}</ol>`:'<h2>Очередь в общем бюджете</h2><p>Нет полного сценария, который проходит ограничения и помещается в бюджет.</p>';
  const body=rows.map(({site,r,check},i)=>{
    const c=centroid(site.geometry);
    const status=check.blockers.length?`Ограничение: ${check.blockers.join('; ')}`:check.issues.length?`Проверить: ${check.issues.join(', ')}`:'Базовые проверки отмечены; требуется оценка агронома';
    return `<tr><td>${i+1}</td><td>${esc(site.name)}${site.demo?' (демо)':''}<small>${c[1].toFixed(5)}° N, ${c[0].toFixed(5)}° E</small><small>WorldCover 2021: ${esc(site.coverClass || 'нет данных')}</small></td><td>${esc(SPECIES[r.s.species].name)} × ${r.s.count}</td><td>${money(r.total)}</td><td>≈ ${nf.format(r.surviving)} (${Math.round(r.probability*100)}%)</td><td>≈ ${nf.format(r.canopy)} м²</td><td>${esc(status)}</td></tr>`;
  }).join('');
  const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>ZhasylQala — предварительный отчёт</title><style>body{font:14px/1.5 Arial,sans-serif;color:#173c2b;max-width:1200px;margin:36px auto;padding:0 24px}h1{font-size:28px;margin-bottom:4px}p{color:#54655a}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{border:1px solid #d4ded3;padding:9px;vertical-align:top;text-align:left}th{background:#eaf3e8;font-size:12px}td small{display:block;color:#698274;margin-top:4px}.warning{padding:12px;background:#fff3df;border-left:4px solid #c88a35}li{margin:5px 0}@media print{body{margin:0;padding:0}table{font-size:11px}}</style></head><body><h1>Предварительный план озеленения</h1><p>ZhasylQala · Павлодар · ${date} · ${rows.length} участков · общий лимит ${money(state.cityBudget)}</p><p class="warning">Демонстрационный расчёт. Начальные точки, цены, коэффициенты приживаемости и кроны условные. Ни один участок нельзя считать согласованным только на основе этого отчёта.</p>${planSummary}<h2>Все участки</h2><table><thead><tr><th>№</th><th>Участок</th><th>Сценарий</th><th>3 года</th><th>Ожидаемо живых</th><th>Крона</th><th>Проверка</th></tr></thead><tbody>${body}</tbody></table><h2>Метод и источники</h2><ul><li>Стоимость: саженцы + посадка + уход за 3 года + ожидаемая одна замена погибших деревьев.</li><li>Приживаемость: условный коэффициент породы с поправкой на частоту полива; требует калибровки.</li><li>Покров земли: ESA WorldCover 2021, обзорный контекст; https://esa-worldcover.org/en/data-access</li><li>Климат: Open-Meteo Historical Weather API, сеточные данные; https://open-meteo.com/en/docs/historical-weather-api</li><li>Карта: OpenFreeMap / OpenStreetMap; https://openfreemap.org/</li></ul><p>Перед реализацией обязательны выезд, проверка почвы, воды, сетей, права на участок, местной сметы и согласование агронома.</p></body></html>`;
  const blob=new Blob([html],{type:'text/html;charset=utf-8'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='zhasylqala-preliminary-report.html';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  toast('Предварительный отчёт скачан.');
}

function bindUI() {
  $('speciesSelect').innerHTML=Object.entries(SPECIES).map(([id,s])=>`<option value="${id}">${s.name}</option>`).join('');
  document.querySelectorAll('.tool-btn').forEach(btn=>btn.addEventListener('click',()=>setMode(btn.dataset.mode)));
  $('coordinateForm').addEventListener('submit',event=>{
    event.preventDefault();
    const result=CoordinateInput.parsePoint($('coordinateInput').value),status=$('coordinateStatus');
    if(result.error){status.textContent=result.error;status.className='error';return;}
    if(!addSite({type:'Point',coordinates:result.coordinates})){status.textContent='Локальный план заполнен: максимум 100 участков.';status.className='error';return;}
    status.textContent=result.outsidePavlodar?'Точка добавлена вне района Павлодара. Проверьте широту и долготу.':'Точка добавлена точно по указанным координатам.';
    status.className=result.outsidePavlodar?'warning':'success';
  });
  for (const id of ['treeCount','budget','seedlingCost','plantingCost','annualCare']) $(id).addEventListener('change',readForm);
  $('watering').addEventListener('input',()=>{
    const tree=SPECIES[$('speciesSelect').value];
    $('annualCare').value=tree.careBase+Number($('watering').value)*1500;
    readForm();
  });
  $('speciesSelect').addEventListener('change',()=>{
    const tree=SPECIES[$('speciesSelect').value];
    $('seedlingCost').value=tree.seedling;$('plantingCost').value=tree.planting;$('annualCare').value=tree.careBase+Number($('watering').value)*1500;
    readForm();
  });
  $('landcoverToggle').addEventListener('change',e=>toggleLayer('landcover',e.target.checked));
  $('ndviToggle').addEventListener('change',e=>toggleLayer('ndvi',e.target.checked));
  $('homeBtn').addEventListener('click',()=>map?.flyTo({center:CITY,zoom:12.4,duration:550}));
  $('zoomInBtn').addEventListener('click',()=>map?.zoomIn());
  $('zoomOutBtn').addEventListener('click',()=>map?.zoomOut());
  $('focusBtn').addEventListener('click',focusSite);
  $('importBtn').addEventListener('click',()=>$('geojsonFile').click());
  $('geojsonFile').addEventListener('change',e=>importGeoJSON(e.target.files[0]));
  $('exportBtn').addEventListener('click',exportGeoJSON);
  $('planBtn').addEventListener('click',planCity);
  $('reportBtn').addEventListener('click',downloadReport);
  $('compareGoal').addEventListener('change',()=>renderRecommendations(selected()));
  for(const id of ['soilCheck','waterCheck','utilityCheck','landCheck']) $(id).addEventListener('change',readChecks);
  for(const id of ['surfaceObservation','observationSource']) $(id).addEventListener('change',()=>{
    const site=selected(),kind=$('surfaceObservation').value;
    site.observation=kind==='unknown'?null:EvidenceReview.normalize({kind,source:$('observationSource').value,recordedAt:new Date().toISOString().slice(0,10)});
    renderEvidenceReview(site);renderChecks(site);renderRecommendations(site);
    window.onObservationChanged?.(site);
    invalidatePlan();save();
  });
  $('siteName').addEventListener('change',()=>{
    const name=$('siteName').value.trim().slice(0,70);
    if(!name){$('siteName').value=selected().name;return;}
    selected().name=name;renderSites();renderScenario();invalidatePlan();
  });
  $('deleteSiteBtn').addEventListener('click',()=>{
    const site=selected();
    if(site.demo || state.sites.length<=1 || !window.confirm(`Удалить «${site.name}» из локального плана?`)) return;
    state.sites=state.sites.filter(item=>item.id!==site.id);
    state.selectedId=state.sites[0].id;
    renderSites();renderScenario();refreshMapData();invalidatePlan();toast('Участок удалён из локального плана.');
  });
  $('cityBudget').value=state.cityBudget;
  $('aboutBtn').addEventListener('click',()=>$('aboutDialog').showModal());
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mode==='polygon'){setMode('select');toast('Рисование отменено.');}});
}

bindUI();renderSites();renderScenario();initMap();

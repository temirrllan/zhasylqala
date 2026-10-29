/* ZhasylQala MVP extension. Demo zones and all local coefficients are illustrative. */
const MVP_SPECIES = {
  linden:{width:9,drought:1,salt:0,shade:2,road:1,soil:['loam']},
  poplar:{width:12,drought:2,salt:1,shade:0,road:2,soil:['loam','sand']},
  willow:{width:10,drought:0,salt:0,shade:1,road:1,soil:['loam']},
  pine:{width:7,drought:2,salt:1,shade:0,road:1,soil:['sand']},
  maple:{width:8,drought:1,salt:0,shade:1,road:1,soil:['loam']},
  ash:{width:9,drought:2,salt:1,shade:1,road:2,soil:['loam','sand']},
};
const MVP_DEFAULTS={purpose:'courtyard',soil:'unknown',light:'unknown',road:'unknown',clearance:12,greenShare:null,source:'manual'};
const MVP_WEIGHTS={green:35,social:25,pressure:20,effect:20};
const MVP_DEMO_ZONES=[
  {id:'mvp-zone-1',name:'Демо-зона 1 · дефицит зелени',center:[76.954,52.294],mvp:{purpose:'school',soil:'loam',light:'sun',road:'yes',clearance:9,greenShare:.16,source:'synthetic'}},
  {id:'mvp-zone-2',name:'Демо-зона 2 · у дороги',center:[76.988,52.277],species:'pine',mvp:{purpose:'street',soil:'sand',light:'sun',road:'yes',clearance:7,greenShare:.31,source:'synthetic'}},
  {id:'mvp-zone-3',name:'Демо-зона 3 · двор',center:[76.938,52.273],mvp:{purpose:'courtyard',soil:'loam',light:'shade',road:'no',clearance:10,greenShare:.48,source:'synthetic'}},
];
const PURPOSE_LABELS={park:'Парк / сквер',courtyard:'Двор',street:'Улица',school:'Школа / детсад',hospital:'Больница'};
const SOIL_LABELS={unknown:'нет данных',loam:'суглинок',sand:'песчаная',saline:'засоленная'};
const ECO_COEFFICIENTS={co2KgPerCanopyM2Year:.6,rainM3PerCanopyM2Year:.02,annualRetention:.98};
let currentPlantingLayout=null;

function mvpPolygon(center) {
  const [x,y]=center,dx=.0017,dy=.00115;
  return {type:'Polygon',coordinates:[[[x-dx,y-dy],[x+dx,y-dy],[x+dx,y+dy],[x-dx,y+dy],[x-dx,y-dy]]]};
}
function zoneFor(site) {
  const raw={...MVP_DEFAULTS,...(site?.mvp||{})};
  return {
    purpose:Object.hasOwn(PURPOSE_LABELS,raw.purpose)?raw.purpose:'courtyard',
    soil:Object.hasOwn(SOIL_LABELS,raw.soil)?raw.soil:'unknown',
    light:['unknown','sun','shade'].includes(raw.light)?raw.light:'unknown',
    road:['unknown','yes','no'].includes(raw.road)?raw.road:'unknown',
    clearance:sanitizeNumber(raw.clearance,12,0,50),
    greenShare:raw.greenShare===null||raw.greenShare===''?null:sanitizeNumber(raw.greenShare,0,0,1),
    source:raw.source==='synthetic'?'synthetic':'manual',
  };
}
function upgradeMvpState() {
  if (!state.mvpVersion) {
    for (const zone of MVP_DEMO_ZONES) if (!state.sites.some(site=>site.id===zone.id)) {
      state.sites.push({id:zone.id,name:zone.name,geometry:mvpPolygon(zone.center),demo:true,scenario:defaultScenario(zone.species||'linden',10,2),checks:clone(CHECK_DEFAULTS),mvp:clone(zone.mvp)});
    }
    state.mvpVersion=1;
    state.selectedId='mvp-zone-1';
  }
  if(state.mvpVersion<2){
    const street=state.sites.find(site=>site.id==='mvp-zone-2');
    if(street?.scenario?.species==='linden'&&street.scenario.count===10)street.scenario=defaultScenario('pine',10,2);
    state.mvpVersion=2;
  }
  state.mvpWeights={...MVP_WEIGHTS,...(state.mvpWeights||{})};
  save();
}
function zoneArea(geometry) {
  if (geometry?.type!=='Polygon') return null;
  const ring=geometry.coordinates?.[0];
  if (!ring || ring.length<4) return null;
  const lat=ring.reduce((sum,p)=>sum+p[1],0)/ring.length*Math.PI/180;
  const scaleX=111320*Math.cos(lat),scaleY=111320;
  let twice=0;
  for(let i=0;i<ring.length-1;i++) twice+=(ring[i][0]*scaleX)*(ring[i+1][1]*scaleY)-(ring[i+1][0]*scaleX)*(ring[i][1]*scaleY);
  return Math.abs(twice)/2;
}
function plantingLayoutFor(site, speciesIds, count) {
  const spacing=Math.max(...speciesIds.map(id=>MVP_SPECIES[id]?.width||0));
  return PlantingLayout.plan(site.geometry,count,spacing);
}
function inputFeatures(site,speciesId,wateringOverride) {
  const m=zoneFor(site), s=scenarioFor(site), tree=SPECIES[speciesId], meta=MVP_SPECIES[speciesId];
  return {
    base:tree.survival,
    waterGap:(wateringOverride??s.watering)-tree.waterNeed,
    soilPrep:site.checks?.soil==='prep'?1:0,
    saline:m.soil==='saline'?1:0,
    road:m.road==='yes'?1:0,
    shadeMismatch:m.light==='shade'&&meta.shade===0?1:0,
  };
}
function suitability(site,speciesId) {
  const m=zoneFor(site), s=scenarioFor(site), tree=SPECIES[speciesId], meta=MVP_SPECIES[speciesId];
  const blocks=[]; const reasons=[];
  if(m.clearance>0 && meta.width>m.clearance) blocks.push(`крона до ${meta.width} м шире свободного места ${m.clearance} м`);
  if(m.soil==='saline' && meta.salt===0) blocks.push('засоление: устойчивость вида не подтверждена');
  if(checkIssues(site).blockers.length) blocks.push(...checkIssues(site).blockers);
  if(site.geometry.type==='Polygon'){
    const layout=plantingLayoutFor(site,[speciesId],s.count);
    if(layout.error) blocks.push(layout.error);
    else if(layout.capacity<s.count) blocks.push(`в контуре помещается не более ${layout.capacity} деревьев при шаге ${meta.width} м; задано ${s.count}`);
  }
  let score=72;
  if(m.soil==='unknown') reasons.push('почва не проверена');
  else if(meta.soil.includes(m.soil)){score+=9;reasons.push('условная совместимость с указанной почвой');}
  else {score-=15;reasons.push('тип почвы требует проверки для вида');}
  if(m.road==='yes'){score+=meta.road*5-8;reasons.push(meta.road>=2?'в демонстрационном каталоге отмечена городская устойчивость':'у дороги требуется подтверждение устойчивости');}
  if(m.light==='shade'){score+=meta.shade*5-10;reasons.push(meta.shade>0?'переносимость затенения в демо-каталоге':'затенение может ухудшить рост');}
  if(m.light==='sun'&&meta.shade===0) score+=4;
  if(s.watering<tree.waterNeed){score-=Math.min(18,(tree.waterNeed-s.watering)*9);reasons.push('полив ниже условной потребности');}
  else reasons.push('заданный полив соответствует сценарию');
  if(m.soil==='saline') score-=12;
  if(m.clearance>0&&meta.width<=m.clearance) score+=5;
  return {score:clamp(Math.round(score),0,100),blocks,reasons};
}

function mvpCalculate(site) {
  const s=scenarioFor(site), m=zoneFor(site);
  const preparationCost=sanitizeNumber(s.preparationCost,3000,0,1e7);
  const deliveryCost=sanitizeNumber(s.deliveryCost,1500,0,1e7);
  const careYears=Math.round(sanitizeNumber(s.careYears,3,1,3));
  s.preparationCost=preparationCost;s.deliveryCost=deliveryCost;s.careYears=careYears;
  const hasMix=s.plantingScheme==='mixed'&&SPECIES[s.secondarySpecies]&&s.secondarySpecies!==s.species&&!suitability(site,s.secondarySpecies).blocks.length;
  if(s.plantingScheme==='mixed'&&!hasMix)s.plantingScheme='single';
  const primaryCount=hasMix?Math.ceil(s.count*.7):s.count;
  const components=[{id:s.species,count:primaryCount,seedling:s.seedlingCost,planting:s.plantingCost,care:s.annualCare}];
  if(hasMix){const other=SPECIES[s.secondarySpecies];components.push({id:s.secondarySpecies,count:s.count-primaryCount,seedling:other.seedling,planting:other.planting,care:other.careBase+s.watering*1500});}
  const breakdown={material:0,preparation:0,delivery:0,planting:0,care:0,replacement:0};
  let surviving=0,canopy=0,weightedProbability=0;
  for(const item of components){
    item.features=inputFeatures({...site,scenario:s},item.id);
    item.probability=ZhasylModel.predict(item.features);
    weightedProbability+=item.probability*item.count;
    surviving+=item.probability*item.count;
    canopy+=item.probability*item.count*SPECIES[item.id].crown;
    breakdown.material+=item.count*item.seedling;
    breakdown.preparation+=item.count*preparationCost;
    breakdown.delivery+=item.count*deliveryCost;
    breakdown.planting+=item.count*item.planting;
    breakdown.care+=item.count*item.care*careYears;
    breakdown.replacement+=item.count*(1-item.probability)*(item.seedling+item.planting+preparationCost+deliveryCost);
  }
  const probability=weightedProbability/s.count;
  const yearly=[1,2,3].map(year=>components.reduce((sum,item)=>sum+item.count*clamp(item.probability+(3-year)*.055,.3,.95),0)/s.count);
  const total=Object.values(breakdown).reduce((sum,value)=>sum+value,0);
  const eco=[5,10,20].map(year=>{
    const growth=year===5?1.4:year===10?2:2.6;
    const area=canopy*growth*Math.pow(ECO_COEFFICIENTS.annualRetention,year-3);
    return {year,canopy:area,co2Kg:area*ECO_COEFFICIENTS.co2KgPerCanopyM2Year,rainM3:area*ECO_COEFFICIENTS.rainM3PerCanopyM2Year};
  });
  const missing=[m.soil==='unknown'?'тип почвы':null,m.light==='unknown'?'освещённость':null,m.road==='unknown'?'близость дороги':null,m.greenShare===null?'доля зелени':null,site.checks?.water!=='yes'?'доступность воды':null].filter(Boolean);
  return {s,probability,yearly,surviving,replacement:breakdown.replacement,total,canopy,breakdown,features:components[0].features,components,hasMix,eco,confidence:missing.length?'низкая':'предварительная',missing};
}

function problemsFor(site) {
  const m=zoneFor(site), items=[];
  if(m.greenShare!==null && m.greenShare<.3) items.push({cause:'Дефицит зелени',detail:`введённая доля зелени ${Math.round(m.greenShare*100)}%`,action:'проверить свободные места и добавить посадки',severity:m.greenShare<.2?'high':'medium'});
  if(m.soil==='saline') items.push({cause:'Засолённая почва',detail:'указана вручную',action:'подтвердить анализом почвы и подобрать устойчивые виды',severity:'high'});
  if(m.road==='yes' && (m.greenShare===null||m.greenShare<.45)) items.push({cause:'Нагрузка у дороги',detail:'близость дороги указана вручную',action:'проверить место для защитной зелени',severity:'medium'});
  if(site.coverClass==='Застройка') items.push({cause:'Покрытая поверхность',detail:'WorldCover 2021: застройка в центральной точке',action:'проверить наличие доступного грунта',severity:'medium'});
  if(m.greenShare!==null && m.greenShare>=.3 && m.greenShare<.5 && !items.length) items.push({cause:'Умеренная доля зелени',detail:`введённая доля ${Math.round(m.greenShare*100)}%`,action:'сравнить с соседними зонами',severity:'low'});
  const order={high:3,medium:2,low:1};
  items.sort((a,b)=>order[b.severity]-order[a.severity]);
  return items;
}
function priorityIndex(site) {
  const m=zoneFor(site), weights=state.mvpWeights||MVP_WEIGHTS, cost=mvpCalculate(site);
  const factors={
    green:m.greenShare===null?50:clamp((1-m.greenShare)*100,0,100),
    social:{school:95,hospital:95,courtyard:75,street:65,park:45}[m.purpose]||50,
    pressure:m.road==='yes'?80:m.road==='no'?30:50,
    effect:clamp(cost.canopy/Math.max(cost.total/9000,1)*100,0,100),
  };
  const totalWeight=Object.values(weights).reduce((sum,x)=>sum+Number(x),0)||1;
  const score=Math.round(Object.keys(factors).reduce((sum,key)=>sum+factors[key]*Number(weights[key]||0),0)/totalWeight);
  return {score,factors,preliminary:m.greenShare===null||m.road==='unknown'};
}

upgradeMvpState();
calculate=mvpCalculate;

function renderZoneFacts(site) {
  const m=zoneFor(site), area=zoneArea(site.geometry);
  $('zoneDataBadge').textContent=m.source==='synthetic'?'СИНТЕТИЧЕСКИЕ ДАННЫЕ':'РУЧНОЙ ВВОД';
  $('zoneFacts').innerHTML=`<span>Площадь: <strong>${area===null?'точка · не определена':`${nf.format(area)} м²`}</strong></span><span>Зелень: <strong>${m.greenShare===null?'нет данных':`${Math.round(m.greenShare*100)}% · ${m.source==='synthetic'?'демо':'вручную'}`}</strong></span><span>Почва: <strong>${esc(SOIL_LABELS[m.soil]||SOIL_LABELS.unknown)}</strong></span>`;
  const quality=[];
  if(area===null)quality.push('Для расчёта плотности и площади нужна зона-полигон.');
  if(m.greenShare===null)quality.push('Доля зелени отсутствует; индекс приоритета использует нейтральное значение.');
  if(m.soil==='unknown')quality.push('Нет карты почв; пригодность растения предварительная.');
  if(site.coverSampleCount&&m.greenShare!==null&&Math.abs(site.coverGreenSample-m.greenShare)>.55)quality.push(`Локальные выборки WorldCover: ${Math.round(site.coverGreenSample*100)}% зелёных классов (${site.coverSampleCount} точек), введённая доля зоны: ${Math.round(m.greenShare*100)}%. Масштабы различаются; нужна сверка данных.`);
  $('dataQuality').textContent=quality.length?`Качество данных: ${quality.join(' ')}`:'Качество данных: введённые параметры полны для демонстрации, полевого подтверждения нет.';
  $('zonePurpose').value=m.purpose;
  $('zoneSoil').value=m.soil;
  $('zoneLight').value=m.light;
  $('zoneRoad').value=m.road;
  $('zoneClearance').value=m.clearance;
  $('zoneGreen').value=m.greenShare===null?'':Math.round(m.greenShare*100);
}
function renderScheme(site,result) {
  const eligible=Object.keys(SPECIES).filter(id=>id!==result.s.species&&!suitability(site,id).blocks.length);
  $('secondarySpecies').innerHTML=eligible.map(id=>`<option value="${id}">${esc(SPECIES[id].name)}</option>`).join('')||'<option value="">Нет подходящего вида</option>';
  $('secondarySpecies').disabled=!eligible.length;
  $('plantingScheme').querySelector('option[value="mixed"]').disabled=!eligible.length;
  $('plantingScheme').value=result.hasMix?'mixed':'single';
  if(result.hasMix)$('secondarySpecies').value=result.s.secondarySpecies;
  $('schemeStatus').textContent=result.hasMix?`${result.components[0].count} × ${SPECIES[result.components[0].id].name} + ${result.components[1].count} × ${SPECIES[result.components[1].id].name}. Расчёты учитывают оба вида.`:eligible.length?'Можно выбрать смешанную посадку 70/30 для разнообразия видов.':'По введённым ограничениям второго подходящего вида нет; разнообразие пока недостижимо.';
}
function renderProblems() {
  $('planCount').textContent=`${state.sites.filter(site=>site.geometry.type==='Polygon').length} / ${state.sites.length} зон`;
  const rows=state.sites.flatMap(site=>problemsFor(site).map(item=>({site,...item})));
  const rank={high:3,medium:2,low:1};
  rows.sort((a,b)=>rank[b.severity]-rank[a.severity]||a.site.name.localeCompare(b.site.name,'ru'));
  const filter=$('problemFilter').value;
  const shown=filter==='all'?rows:rows.filter(row=>row.severity===filter);
  $('problemCount').textContent=String(rows.length).padStart(2,'0');
  $('problemList').innerHTML=shown.length?shown.map(row=>`<button type="button" data-problem-site="${esc(row.site.id)}" class="problem-card ${row.severity}"><span class="problem-dot"></span><span><strong>${esc(row.cause)}</strong><small>${esc(row.site.name)} · ${esc(row.detail)}</small><small>Действие: ${esc(row.action)}</small></span><b>${{high:'ВЫСОКАЯ',medium:'СРЕДНЯЯ',low:'НИЗКАЯ'}[row.severity]}</b></button>`).join(''):'<p class="empty-note">Проблем этого уровня нет. Для участков без данных вывод не делается.</p>';
  $('problemList').querySelectorAll('[data-problem-site]').forEach(btn=>btn.addEventListener('click',()=>chooseSite(btn.dataset.problemSite,true)));
  updateMvpMap();
}
function renderPriorityWeights() {
  const labels={green:'Дефицит зелени',social:'Социальная значимость',pressure:'Нагрузка среды',effect:'Эффект на бюджет'};
  $('priorityWeights').innerHTML=Object.keys(labels).map(key=>`<label>${labels[key]} <strong>${Number(state.mvpWeights[key])}</strong><input type="range" data-priority-weight="${key}" min="0" max="100" step="5" value="${Number(state.mvpWeights[key])}" /></label>`).join('');
  $('priorityWeights').querySelectorAll('[data-priority-weight]').forEach(input=>input.addEventListener('input',()=>{
    state.mvpWeights[input.dataset.priorityWeight]=Number(input.value);
    input.parentNode.querySelector('strong').textContent=input.value;
    invalidatePlan();updateMvpMap();save();
  }));
}
function renderSuitability(site) {
  const goal=$('compareGoal').value;
  const options=Object.keys(SPECIES).map(id=>({id,fit:suitability(site,id),result:mvpCalculate({...site,scenario:{...scenarioFor(site),species:id,plantingScheme:'single',seedlingCost:SPECIES[id].seedling,plantingCost:SPECIES[id].planting,annualCare:SPECIES[id].careBase+scenarioFor(site).watering*1500}})}));
  const eligible=options.filter(x=>!x.fit.blocks.length);
  if(goal==='cost') eligible.sort((a,b)=>a.result.total-b.result.total||b.fit.score-a.fit.score);
  else if(goal==='survival') eligible.sort((a,b)=>b.result.probability-a.result.probability||b.fit.score-a.fit.score);
  else if(goal==='canopy') eligible.sort((a,b)=>b.result.canopy-a.result.canopy||b.fit.score-a.fit.score);
  else if(goal==='balanced') eligible.sort((a,b)=>b.result.canopy/b.result.total-a.result.canopy/a.result.total||b.fit.score-a.fit.score);
  else eligible.sort((a,b)=>b.fit.score-a.fit.score||a.result.total-b.result.total);
  const cards=eligible.slice(0,3).map((option,index)=>`<article class="recommend-card"><div class="recommend-title"><span>${index+1}</span><strong>${esc(SPECIES[option.id].name)}</strong><b class="fit-score">${option.fit.score}/100</b><button type="button" data-apply-species="${option.id}">Выбрать</button></div><div class="recommend-metrics"><span>${money(option.result.total)}</span><span>≈ ${Math.round(option.result.probability*100)}% к 3 году</span><span>≈ ${nf.format(option.result.canopy)} м² кроны</span></div><p>${esc(option.fit.reasons.slice(0,2).join('; '))}. Каталог и балл — демонстрационные.</p></article>`).join('');
  const blocked=options.filter(x=>x.fit.blocks.length);
  $('recommendationList').innerHTML=(cards||'<div class="recommend-blocked">Нет вида, проходящего указанные ограничения. Измените условия зоны или согласуйте посадку.</div>')+(blocked.length?`<details class="mvp-details"><summary>Исключено видов: ${blocked.length}</summary>${blocked.map(x=>`<p>${esc(SPECIES[x.id].name)}: ${esc(x.fit.blocks.join('; '))}</p>`).join('')}</details>`:'');
  $('recommendationList').querySelectorAll('[data-apply-species]').forEach(btn=>btn.addEventListener('click',()=>{
    const id=btn.dataset.applySpecies,tree=SPECIES[id];
    $('speciesSelect').value=id;$('seedlingCost').value=tree.seedling;$('plantingCost').value=tree.planting;$('annualCare').value=tree.careBase+Number($('watering').value)*1500;
    readForm();toast(`${tree.name}: вариант применён. Проверьте условия зоны.`);
  }));
}
renderRecommendations=renderSuitability;

function renderCost(result) {
  const rows=[['Саженцы',result.breakdown.material],['Подготовка почвы',result.breakdown.preparation],['Доставка',result.breakdown.delivery],['Посадочные работы',result.breakdown.planting],[`Уход · ${result.s.careYears} г.`,result.breakdown.care],['Резерв замены',result.breakdown.replacement]];
  $('costBreakdown').innerHTML=`<table class="mvp-table"><tbody>${rows.map(([name,value])=>`<tr><th>${name}</th><td>${money(value)}</td></tr>`).join('')}<tr class="total"><th>Итого</th><td>${money(result.total)}</td></tr></tbody></table><p class="field-note">Резерв = количество × (1 − прогноз 3-го года) × (саженец + подготовка + доставка + посадка). Все цены редактируемые, стартовые значения демонстрационные.</p>`;
  $('preparationCost').value=result.s.preparationCost;
  $('deliveryCost').value=result.s.deliveryCost;
  $('careYears').value=result.s.careYears;
}
function renderSurvival(site,result) {
  const x=result.features,risks=[];
  const delta=(key,value)=>Math.max(0,Math.round((ZhasylModel.predict({...x,[key]:value})-result.probability)*100));
  if(x.waterGap<0) risks.push(`Недостаточный полив: до +${delta('waterGap',0)} п.п. при доведении до условной потребности`);
  if(x.saline) risks.push(`Засоление: до +${delta('saline',0)} п.п. после решения проблемы почвы`);
  if(x.soilPrep) risks.push(`Почва требует подготовки: до +${delta('soilPrep',0)} п.п. после подготовки`);
  if(x.road) risks.push(`Дорожная нагрузка: снижение примерно на ${delta('road',0)} п.п.`);
  if(x.shadeMismatch) risks.push(`Затенение для этого вида: снижение примерно на ${delta('shadeMismatch',0)} п.п.`);
  const improved=result.s.watering<4?mvpCalculate({...site,scenario:{...result.s,watering:result.s.watering+1}}):result;
  $('survivalAnalysis').innerHTML=`<div class="year-grid">${result.yearly.map((p,i)=>`<div><small>${i+1}-й год</small><strong>${Math.round(p*100)}%</strong></div>`).join('')}</div><p class="field-note">Уверенность: <strong>${result.confidence}</strong>. ${result.missing.length?`Неизвестно: ${esc(result.missing.join(', '))}.`: 'Условия введены вручную, полевой проверки модели нет.'} Модель обучена на синтетических экспертных метках; ошибка на синтетической проверке ${(ZhasylModel.syntheticMae*100).toFixed(1)} п.п. не означает реальную точность.</p><div class="mvp-list"><strong>Главные риски ${result.hasMix?'основного вида':''}</strong>${(risks.length?risks:['Явных штрафов по введённым признакам нет; нужны реальные почвенные и полевые данные.']).map(item=>`<p>• ${esc(item)}</p>`).join('')}</div><div class="mvp-callout">${result.s.watering<4?`Если увеличить полив на 1 раз в неделю: <strong>${Math.round(improved.probability*100)}%</strong> к 3-му году вместо ${Math.round(result.probability*100)}%. Изменение полной сметы: ${improved.total>=result.total?'+':'−'}${money(Math.abs(improved.total-result.total))} с учётом резерва замены.`:'Полив уже на максимуме текущего сценария.'} Проверьте доступность воды и стоимость ухода.</div>`;
}
function renderCare(site,result) {
  const s=result.s,perVisit=s.count*(s.watering>=3?30:25),water=s.watering?`${s.watering} р./нед. · ≈ ${perVisit} л за выезд`:'полив не задан';
  const rows=[
    ['Январь','Осмотр зимнего состояния и защитных конструкций'],
    ['Февраль','Проверка повреждений и состояния мульчи'],
    ['Март','Санитарная обрезка после осмотра специалистом'],
    ['Апрель','Подготовка почвы, проверка дренажа и воды'],
    ['Май',`Посадка и мульчирование; ${water}`],
    ['Июнь',`Полив ${water}; осмотр вредителей; подкормка только после анализа почвы`],
    ['Июль',`Полив ${water}; контроль подсыхания`],
    ['Август',`Полив ${water}; осмотр приживаемости`],
    ['Сентябрь','Осмотр, корректировка полива и подготовка отчёта'],
    ['Октябрь','Влагозарядный полив по решению специалиста, мульча'],
    ['Ноябрь','Подготовка к зиме, защита молодых растений'],
    ['Декабрь','Контроль укрытий и зимних повреждений'],
  ];
  $('careCalendar').innerHTML=`<table class="mvp-table calendar-table"><tbody>${rows.map(([month,task])=>`<tr><th>${month}</th><td>${esc(task)}</td></tr>`).join('')}</tbody></table><p class="field-note">Объём 25–30 л/дерево/выезд и сроки работ — демонстрационные допущения. Согласуйте календарь, удобрения и защиту с агрономом. Уход включён в смету на ${s.careYears} г.</p>`;
}
function renderEco(site,result) {
  const area=zoneArea(site.geometry), green=zoneFor(site).greenShare;
  const before=area!==null&&green!==null?area*green:null;
  const after=before!==null?Math.min(area,before+result.eco[1].canopy):null;
  $('ecoEffect').innerHTML=`<table class="mvp-table"><thead><tr><th>Горизонт</th><th>Крона</th><th>CO₂/год</th><th>Осадки/год</th></tr></thead><tbody>${result.eco.map(e=>`<tr><th>${e.year} лет</th><td>≈ ${nf.format(e.canopy)} м²</td><td>≈ ${nf.format(e.co2Kg)} кг</td><td>≈ ${e.rainM3.toFixed(1)} м³</td></tr>`).join('')}</tbody></table><p class="mvp-callout">Зелёная площадь «до / после» к 10-му году: <strong>${before===null?'нет данных':`${nf.format(before)} → ${nf.format(after)} м²`}</strong>. Стоимость на 1 м² ожидаемой кроны к 10-му году: <strong>${money(result.total/Math.max(result.eco[1].canopy,1))}</strong>.</p><p class="field-note">CO₂: 0,6 кг/м² кроны/год; задержание осадков: 0,02 м³/м²/год; рост кроны и потери деревьев — <strong>синтетические коэффициенты проекта</strong>, не измерения Павлодара. Пыль, кислород и снижение температуры без локальных коэффициентов не рассчитываются. Крона может пересекаться с существующей зеленью.</p>`;
}
function renderPlantingLayout(site,result) {
  const speciesIds=result.components.map(item=>item.id);
  const layout=plantingLayoutFor(site,speciesIds,result.s.count);
  const fitBlocks=speciesIds.flatMap(id=>suitability(site,id).blocks);
  const ready=!layout.error&&layout.capacity>=result.s.count&&!fitBlocks.length;
  const box=$('plantingLayoutStatus');
  box.className='planting-layout'+(ready?' ready':' blocked');
  if(layout.error)box.textContent=`Схема точек недоступна: ${layout.error}`;
  else box.textContent=`${layout.capacity>=5001?'Более 5000':layout.capacity} расчётных мест при шаге ${layout.spacing} м и отступе ${layout.inset} м от границы; задано ${result.s.count}. ${ready?'Показаны на карте. Выгрузите GeoJSON для выездной проверки.':fitBlocks.length?`План ограничен: ${fitBlocks[0]}.`:'Уменьшите количество или измените контур.'} Точки не проверяют сети, грунт и существующие деревья.`;
  $('downloadPlantingBtn').disabled=!ready;
  currentPlantingLayout={siteId:site.id,siteName:site.name,layout,ready,components:result.components.map(item=>({id:item.id,count:item.count}))};
  updatePlantingMap();
}
function renderMvpPanels() {
  const site=selected();if(!site)return;
  const result=mvpCalculate(site);
  const fit=suitability(site,result.s.species),second=result.hasMix?suitability(site,result.s.secondarySpecies):null;
  $('selectedSuitabilityStatus').className='selection-status'+(fit.blocks.length?' blocked':'');
  $('selectedSuitabilityStatus').textContent=fit.blocks.length?`Выбранный вид исключён из рекомендации: ${fit.blocks.join('; ')}. Выберите подходящий вариант выше.`:result.hasMix?`Смешанная схема 70/30: основной вид ${fit.score}/100, второй вид ${second.score}/100.`:`Пригодность выбранного вида: ${fit.score}/100. ${fit.reasons.slice(0,2).join('; ')}.`;
  renderScheme(site,result);
  renderZoneFacts(site);
  renderCost(result);
  renderSurvival(site,result);
  renderCare(site,result);
  renderEco(site,result);
  renderPlantingLayout(site,result);
  renderProblems();
}

const previousRenderScenario=renderScenario;
renderScenario=function(){ previousRenderScenario();renderMvpPanels(); };
window.onCoverContextLoaded=function(site){if(selected().id===site.id)renderZoneFacts(site);renderProblems();};

function mvpMapFeatures(kind) {
  return {type:'FeatureCollection',features:state.sites.map(site=>{
    const problem=problemsFor(site)[0];
    return {type:'Feature',id:site.id,geometry:site.geometry,properties:{id:site.id,severity:problem?.severity||'none',score:priorityIndex(site).score}};
  })};
}
function updateMvpMap() {
  if(!map?.getSource('mvp-zones'))return;
  map.getSource('mvp-zones').setData(mvpMapFeatures());
}
function updatePlantingMap() {
  if(!map?.getSource('mvp-planting'))return;
  const selectedSite=selected(),current=currentPlantingLayout;
  const visible=current?.siteId===selectedSite?.id&&!current.layout.error;
  const points=visible?current.layout.points:[];
  map.getSource('mvp-planting').setData({type:'FeatureCollection',features:points.map((coordinates,index)=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{number:index+1,siteId:current.siteId,ready:current.ready}}))});
}
function setMvpLayerVisibility() {
  if(!map?.getLayer('mvp-problem-line'))return;
  const problem=$('problemLayerToggle').checked?'visible':'none',priority=$('priorityLayerToggle').checked?'visible':'none';
  for(const id of ['mvp-problem-line','mvp-problem-point'])map.setLayoutProperty(id,'visibility',problem);
  for(const id of ['mvp-priority-fill','mvp-priority-point'])map.setLayoutProperty(id,'visibility',priority);
  if(map.getLayer('mvp-planting-points'))map.setLayoutProperty('mvp-planting-points','visibility',$('plantingLayerToggle').checked?'visible':'none');
}
function initMvpMap() {
  if(!map || map.getSource('mvp-zones'))return;
  map.addSource('mvp-zones',{type:'geojson',data:mvpMapFeatures()});
  map.addLayer({id:'mvp-priority-fill',type:'fill',source:'mvp-zones',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['interpolate',['linear'],['get','score'],0,'#cbd5c9',50,'#e4bc62',100,'#bf624c'],'fill-opacity':.38},layout:{visibility:'none'}},'site-fill');
  map.addLayer({id:'mvp-priority-point',type:'circle',source:'mvp-zones',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':15,'circle-color':['interpolate',['linear'],['get','score'],0,'#cbd5c9',50,'#e4bc62',100,'#bf624c'],'circle-opacity':.45},layout:{visibility:'none'}},'site-halo');
  map.addLayer({id:'mvp-problem-line',type:'line',source:'mvp-zones',filter:['all',['==',['geometry-type'],'Polygon'],['!=',['get','severity'],'none']],paint:{'line-color':['match',['get','severity'],'high','#c65d47','medium','#d99b42','#859f5f'],'line-width':4,'line-dasharray':[2,1]}},'site-outline');
  map.addLayer({id:'mvp-problem-point',type:'circle',source:'mvp-zones',filter:['all',['==',['geometry-type'],'Point'],['!=',['get','severity'],'none']],paint:{'circle-radius':16,'circle-color':['match',['get','severity'],'high','#c65d47','medium','#d99b42','#859f5f'],'circle-opacity':.38}},'site-halo');
  map.addSource('mvp-planting',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'mvp-planting-points',type:'circle',source:'mvp-planting',paint:{'circle-radius':5,'circle-color':['case',['get','ready'],'#1a6441','#bd7e35'],'circle-stroke-color':'#ffffff','circle-stroke-width':1.5,'circle-opacity':.95}});
  setMvpLayerVisibility();
  updatePlantingMap();
}

planCity=function(){
  state.cityBudget=sanitizeNumber($('cityBudget').value,state.cityBudget,0);
  $('cityBudget').value=state.cityBudget;
  const all=state.sites.map(site=>{const result=mvpCalculate(site),s=result.s;return {site,result,priority:priorityIndex(site),blockers:[...(site.geometry.type==='Polygon'?[]:['нужен полигон зоны']),...suitability(site,s.species).blocks,...(result.hasMix?suitability(site,s.secondarySpecies).blocks:[])]};});
  const excluded=all.filter(row=>row.blockers.length||row.result.total>row.result.s.budget);
  const rows=all.filter(row=>!excluded.includes(row));
  let picked=[],exact=rows.length<=18;
  if(exact){
    let bestScore=0,bestSpent=0,bestMask=0;
    for(let mask=1;mask<(1<<rows.length);mask++){
      let spent=0,score=0;
      for(let i=0;i<rows.length;i++)if(mask&(1<<i)){
        spent+=rows[i].result.total;
        if(spent>state.cityBudget)break;
        score+=rows[i].priority.score*rows[i].result.eco[1].canopy;
      }
      if(spent<=state.cityBudget&&(score>bestScore||score===bestScore&&spent<bestSpent)){bestScore=score;bestSpent=spent;bestMask=mask;}
    }
    picked=rows.filter((_,i)=>bestMask&(1<<i));
  }else{
    rows.sort((a,b)=>(b.priority.score*b.result.eco[1].canopy/Math.max(b.result.total,1))-(a.priority.score*a.result.eco[1].canopy/Math.max(a.result.total,1)));
    let spent=0;for(const row of rows)if(spent+row.result.total<=state.cityBudget){picked.push(row);spent+=row.result.total;}
  }
  picked.sort((a,b)=>b.priority.score-a.priority.score);
  const spent=picked.reduce((sum,row)=>sum+row.result.total,0);
  lastPlan={picked,excluded,spent,exact};
  const box=$('priorityResult');
  if(!picked.length)box.textContent=rows.length?'Ни один полный сценарий не помещается в общий бюджет. Уменьшите количество растений или скорректируйте смету.':'Участки ограничены проверками либо превышают собственный лимит.';
  else {
    const pointCount=excluded.filter(row=>row.site.geometry.type==='Point').length;
    const otherExcluded=excluded.filter(row=>row.site.geometry.type!=='Point');
    box.innerHTML=`<strong>${picked.length} из ${state.sites.filter(site=>site.geometry.type==='Polygon').length} зон · ${money(spent)}</strong><ol>${picked.map(row=>`<li>${esc(row.site.name)} · ${row.priority.score}/100 · ${money(row.result.total)}</li>`).join('')}</ol><span>Цель: максимум суммы «индекс приоритета × ожидаемая крона к 10-му году» в пределах бюджета. ${exact?'Точный перебор полных сценариев.':'Приближённый отбор для более 18 зон.'} ${pointCount?`${pointCount} точек без границ не включены. `:''}${otherExcluded.length?`Исключены: ${otherExcluded.map(row=>`${esc(row.site.name)} (${esc(row.blockers[0]||'превышен лимит зоны')})`).join(', ')}. `:''}Результат предварительный.</span>`;
  }
  save();updateMvpMap();
};

function mvpDownload(name,contents,type='text/html;charset=utf-8') {
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([contents],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function downloadPlantingPoints() {
  const current=currentPlantingLayout;
  if(!current?.ready||current.siteId!==selected()?.id)return;
  const secondary=current.components[1]?.count||0,total=current.layout.points.length;
  const data={type:'FeatureCollection',name:`ZhasylQala · ${current.siteName} · расчётные точки`,properties:{status:'illustrative',note:'Точки требуют выездной проверки грунта, коммуникаций, существующих насаждений и права на посадку.',spacingMetres:current.layout.spacing,insetMetres:current.layout.inset},features:current.layout.points.map((coordinates,index)=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{number:index+1,siteId:current.siteId,siteName:current.siteName,species:secondary&&Math.floor((index+1)*secondary/total)>Math.floor(index*secondary/total)?current.components[1].id:current.components[0].id,status:'illustrative'}}))};
  mvpDownload('zhasylqala-planting-points.geojson',JSON.stringify(data,null,2),'application/geo+json');
  toast(`${data.features.length} расчётных точек скачано для проверки на месте.`);
}
downloadReport=function(){
  planCity();
  const site=selected(),result=mvpCalculate(site),m=zoneFor(site),p=priorityIndex(site),area=zoneArea(site.geometry);
  const rows=state.sites.map(z=>{const r=mvpCalculate(z),pr=priorityIndex(z),issue=checkIssues(z),status=[...(z.geometry.type==='Point'?['точка без границ; вне очереди']:[]),...issue.blockers,...suitability(z,r.s.species).blocks,...(r.hasMix?suitability(z,r.s.secondarySpecies).blocks:[])];return `<tr><td>${esc(z.name)}</td><td>${pr.score}/100</td><td>${esc(problemsFor(z).map(x=>x.cause).join(', ')||'Нет выявленных по доступным данным')}</td><td>${r.components.map(item=>`${esc(SPECIES[item.id].name)} × ${item.count}`).join(' + ')}</td><td>${money(r.total)}</td><td>${Math.round(r.probability*100)}%</td><td>${nf.format(r.eco[1].canopy)} м²</td><td>${esc(status.join('; ')||'Проверить на месте')}</td></tr>`;}).join('');
  const body=`<h1>ZhasylQala — предварительный план</h1><p>Павлодар · ${new Intl.DateTimeFormat('ru-RU',{dateStyle:'long'}).format(new Date())} · ${state.sites.length} участков (${state.sites.filter(z=>z.geometry.type==='Polygon').length} зоны) · бюджет ${money(state.cityBudget)}</p><div class="warning">Демонстрационный расчёт. Данные демо-зон, цены, свойства растений, обучающие метки ML-модели и коэффициенты эффекта синтетические. Посадку утверждает специалист после проверки на месте.</div><h2>Очередь работ</h2><p>Выбрано ${lastPlan.picked.length} зон на ${money(lastPlan.spent)}. Цель: индекс приоритета × ожидаемая крона к 10 году.</p><ol>${lastPlan.picked.map(x=>`<li>${esc(x.site.name)} — ${x.priority.score}/100, ${money(x.result.total)}</li>`).join('')}</ol><h2>Сводка по всем участкам</h2><table><thead><tr><th>Зона</th><th>Приоритет</th><th>Проблемы</th><th>Порода</th><th>Смета</th><th>3-й год</th><th>Крона 10 лет</th><th>Ограничения</th></tr></thead><tbody>${rows}</tbody></table><h2>Выбранная зона: ${esc(site.name)}</h2><p>${esc(PURPOSE_LABELS[m.purpose])}; площадь ${area===null?'не определена':nf.format(area)+' м²'}; доля зелени ${m.greenShare===null?'нет данных':Math.round(m.greenShare*100)+'%'}; почва ${esc(SOIL_LABELS[m.soil])}; индекс ${p.score}/100. Источник условий: ${m.source==='synthetic'?'синтетический демо-набор':'ручной ввод'}.</p><p>${esc($('dataQuality').textContent)}</p><h3>Подбор и смета</h3><p>${result.components.map(item=>`${esc(SPECIES[item.id].name)} × ${item.count} (пригодность ${suitability(site,item.id).score}/100)`).join(' + ')}. Срок ухода ${result.s.careYears} г.</p>${$('costBreakdown').innerHTML}<h3>Приживаемость и риски</h3>${$('survivalAnalysis').innerHTML}<h3>Календарь ухода</h3>${$('careCalendar').innerHTML}<h3>Экологический эффект</h3>${$('ecoEffect').innerHTML}<h2>Метод и ограничения</h2><p>Карта OpenFreeMap / OSM; покров ESA WorldCover 2021; климат Open-Meteo 2023–2025. Локальные проверки, свойства каталога, цены и коэффициенты модели и эффекта требуют подтверждения. ML-модель — логистическая регрессия по 336 синтетическим экспертным примерам; она не проверена на реальных посадках. Для почвы, существующих насаждений и населения нет данных организатора. Оценки CO₂/осадков основаны на демонстрационных коэффициентах, остальные эффекты не рассчитывались.</p>`;
  const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>ZhasylQala — отчёт</title><style>body{font:14px/1.55 Arial,sans-serif;color:#18342d;max-width:1180px;margin:36px auto;padding:0 24px}h1{font-size:29px}h2{margin-top:30px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #d8e1d7;padding:8px;text-align:left;vertical-align:top}th{background:#edf4eb}.warning{background:#fff2dc;border-left:4px solid #c88535;padding:12px}.mvp-callout,.field-note{font-size:12px;color:#58705c}.year-grid{display:flex;gap:18px}.year-grid div{display:flex;flex-direction:column}.mvp-list p{margin:3px 0}@media print{body{margin:0;padding:0;font-size:11px}}</style></head><body>${body}</body></html>`;
  mvpDownload('zhasylqala-mvp-report.html',html);
  toast('Полный предварительный отчёт скачан; откройте и распечатайте в PDF.');
};

function bindMvpUI(){
  for(const [id,handler] of [['planBtn',planCity],['reportBtn',downloadReport]]){
    const old=$(id),replacement=old.cloneNode(true);
    old.replaceWith(replacement);
    replacement.addEventListener('click',handler);
  }
  renderPriorityWeights();
  $('problemFilter').addEventListener('change',renderProblems);
  for(const id of ['problemLayerToggle','priorityLayerToggle','plantingLayerToggle'])$(id).addEventListener('change',setMvpLayerVisibility);
  $('downloadPlantingBtn').addEventListener('click',downloadPlantingPoints);
  for(const id of ['zonePurpose','zoneSoil','zoneLight','zoneRoad','zoneClearance','zoneGreen'])$(id).addEventListener('change',()=>{
    const site=selected(),m=zoneFor(site);
    m.purpose=$('zonePurpose').value;m.soil=$('zoneSoil').value;m.light=$('zoneLight').value;m.road=$('zoneRoad').value;
    m.clearance=sanitizeNumber($('zoneClearance').value,m.clearance,0,50);
    m.greenShare=$('zoneGreen').value===''?null:sanitizeNumber($('zoneGreen').value,0,0,100)/100;
    m.source='manual';
    site.mvp=m;renderScenario();invalidatePlan();save();
  });
  for(const id of ['preparationCost','deliveryCost','careYears'])$(id).addEventListener('change',()=>{
    const site=selected(),s=site.scenario||defaultScenario();
    s.preparationCost=sanitizeNumber($('preparationCost').value,3000,0);
    s.deliveryCost=sanitizeNumber($('deliveryCost').value,1500,0);
    s.careYears=sanitizeNumber($('careYears').value,3,1,3);
    site.scenario=s;renderScenario();invalidatePlan();save();
  });
  $('plantingScheme').addEventListener('change',()=>{
    const site=selected(),s=site.scenario||defaultScenario();
    s.plantingScheme=$('plantingScheme').value;
    if(s.plantingScheme==='mixed')s.secondarySpecies=$('secondarySpecies').value;
    site.scenario=s;renderScenario();invalidatePlan();save();
  });
  $('secondarySpecies').addEventListener('change',()=>{
    const site=selected(),s=site.scenario||defaultScenario();
    s.secondarySpecies=$('secondarySpecies').value;
    site.scenario=s;renderScenario();invalidatePlan();save();
  });
  for(const id of ['soilCheck','waterCheck','utilityCheck','landCheck'])$(id).addEventListener('change',renderMvpPanels);
  if(map){if(map.loaded())initMvpMap();else map.on('load',initMvpMap);}
  renderSites();renderScenario();refreshMapData();planCity();
}
bindMvpUI();

/* A field checklist is a workflow gate, not a permit or an agronomic verdict. */
(function(root){
  const LABELS={demo:'Демонстрационная зона',blocked:'Есть препятствие',visit:'Нужно обследование',review:'К экспертной проверке'};
  function validDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const date=new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
  }
  function normalize(raw){
    return {
      visitDate:validDate(raw?.visitDate)?raw.visitDate:null,
      evidenceRef:typeof raw?.evidenceRef==='string'?raw.evidenceRef.trim().slice(0,160):'',
      notes:typeof raw?.notes==='string'?raw.notes.trim().slice(0,600):'',
    };
  }
  function localToday(){
    const d=new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function evaluate(site,today=localToday()){
    const c=site?.checks||{},m=site?.mvp||{},o=site?.observation||{},i=normalize(site?.inspection);
    const blocked=[],missing=[];
    if(site?.demo)return {status:'demo',label:LABELS.demo,blocked,missing:['Замените учебный контур реальными границами участка.'],inspection:i};
    if(site?.geometry?.type!=='Polygon'||!Array.isArray(site.geometry.coordinates?.[0])||site.geometry.coordinates[0].length<4)missing.push('Нарисуйте или загрузите границы участка.');
    if(o.source!=='field'||o.kind==='unknown'||!o.kind)missing.push('Осмотрите поверхность на месте и отметьте свободный грунт.');
    else if(o.kind==='built'||o.kind==='water')blocked.push('На месте отмечены покрытие или вода; свободный грунт не подтверждён.');
    else if(o.kind==='trees')missing.push('Уточните свободную часть участка среди существующих деревьев.');
    if(!i.visitDate)missing.push('Укажите дату выезда.');
    else if(validDate(today)&&i.visitDate>today)missing.push('Дата выезда не может быть в будущем.');
    if(!i.evidenceRef)missing.push('Добавьте номер акта, ссылку на фото или другой проверяемый источник.');
    if(c.soil==='prep')missing.push('Уточните план подготовки грунта и повторно отметьте состояние почвы.');
    else if(c.soil!=='ok')missing.push('Проверьте почву на месте.');
    if(c.water==='no')blocked.push('Нет доступного источника воды для ухода.');
    else if(c.water!=='yes')missing.push('Подтвердите источник воды и полив.');
    if(c.utilities==='conflict')blocked.push('Обнаружен конфликт с подземными сетями.');
    else if(c.utilities!=='clear')missing.push('Сверьте подземные сети с ответственными службами.');
    if(c.overhead==='conflict')blocked.push('Обнаружен конфликт с воздушными коммуникациями.');
    else if(c.overhead!=='clear')missing.push('Проверьте воздушные линии и свободную высоту.');
    if(c.land==='no')blocked.push('Посадка на участке не согласована.');
    else if(c.land!=='yes')missing.push('Подтвердите право или согласование работ на участке.');
    if(m.source!=='manual')missing.push('Замените синтетические условия зоны полевыми данными.');
    if(!['park','courtyard','street','school','hospital'].includes(m.purpose))missing.push('Укажите назначение участка для расчёта общественной пользы.');
    if(!['loam','sand','saline'].includes(m.soil))missing.push('Укажите результат проверки типа почвы.');
    if(!['sun','shade'].includes(m.light))missing.push('Укажите освещённость.');
    if(!['yes','no'].includes(m.road))missing.push('Отметьте влияние дороги.');
    if(!Number.isFinite(Number(m.clearance))||Number(m.clearance)<=0||Number(m.clearance)>50)missing.push('Измерьте свободную ширину для будущей кроны.');
    if(m.greenShare===null||m.greenShare===undefined||!Number.isFinite(Number(m.greenShare))||Number(m.greenShare)<0||Number(m.greenShare)>1)missing.push('Оцените долю существующей зелени в границах зоны.');
    const status=blocked.length?'blocked':missing.length?'visit':'review';
    return {status,label:LABELS[status],blocked,missing,inspection:i};
  }
  function queueBlocker(site,today=localToday()){
    if(site?.demo)return null;
    const audit=evaluate(site,today);
    return audit.status==='review'?null:`полевое обследование: ${audit.blocked[0]||audit.missing[0]||audit.label}`;
  }
  function planningCandidates(sites){
    const real=sites.filter(site=>!site.demo);
    return {mode:real.length?'real':'demo',sites:real.length?real:sites.filter(site=>site.demo)};
  }
  root.FieldAudit={LABELS,normalize,evaluate,queueBlocker,planningCandidates};
  if(typeof module!=='undefined'&&module.exports)module.exports={LABELS,normalize,evaluate,queueBlocker,planningCandidates};
})(typeof window!=='undefined'?window:globalThis);

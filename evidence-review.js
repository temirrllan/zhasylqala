/* User observations remain separate from the historic WorldCover class. */
(function (root) {
  const KINDS = {unknown:'Не проверено',open:'Открытое место без деревьев',trees:'Есть деревья',built:'Застройка или покрытие',water:'Вода'};
  const SOURCES = {map:'по карте или снимку',field:'при осмотре на месте'};
  const COVER_KIND = {
    'Древесная растительность':'trees',
    'Травяной покров':'open',
    'Открытый грунт':'open',
    'Застройка':'built',
    'Вода':'water',
  };

  function normalize(raw) {
    const kind=Object.hasOwn(KINDS,raw?.kind)?raw.kind:'unknown';
    const source=Object.hasOwn(SOURCES,raw?.source)?raw.source:'map';
    const recordedAt=typeof raw?.recordedAt==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw.recordedAt)?raw.recordedAt:null;
    return {kind,source,recordedAt};
  }

  function compare(coverClass,raw) {
    const observation=normalize(raw),coverKind=COVER_KIND[coverClass]||null;
    if(observation.kind==='unknown')return {status:'unreviewed',observation,coverKind};
    if(!coverKind)return {status:'uncomparable',observation,coverKind};
    return {status:coverKind===observation.kind?'match':'conflict',observation,coverKind};
  }

  root.EvidenceReview={KINDS,SOURCES,normalize,compare};
  if(typeof module!=='undefined'&&module.exports)module.exports={KINDS,SOURCES,normalize,compare};
})(typeof window!=='undefined'?window:globalThis);

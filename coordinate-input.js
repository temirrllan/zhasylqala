/* Parse a human-entered latitude, longitude pair without guessing its location. */
(function(root){
  function parsePoint(raw){
    const text=String(raw??'').trim();
    const values=[...text.matchAll(/[-+]?\d+(?:[.,]\d+)?/g)].map(match=>Number(match[0].replace(',','.')));
    if(values.length!==2)return {error:'Введите широту и долготу через пробел или запятую, например 52.28201, 76.97125.'};
    let [lat,lon]=values;
    const upper=text.toUpperCase();
    if(/\bS\b|Ю/.test(upper))lat=-Math.abs(lat);
    if(/\bW\b|З/.test(upper))lon=-Math.abs(lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return {error:'Координаты вне диапазона: широта от −90 до 90, долгота от −180 до 180.'};
    const nearPavlodar=lon>=75.5&&lon<=78&&lat>=51.5&&lat<=53;
    const swapped=lat>=75.5&&lat<=78&&lon>=51.5&&lon<=53;
    if(swapped)return {error:'Похоже, широта и долгота перепутаны. Введите сначала 52…, затем 76….'};
    return {coordinates:[lon,lat],outsidePavlodar:!nearPavlodar};
  }
  root.CoordinateInput={parsePoint};
  if(typeof module!=='undefined'&&module.exports)module.exports={parsePoint};
})(typeof window!=='undefined'?window:globalThis);

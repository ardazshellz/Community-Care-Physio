// Owner-selected postcode zones for the public coverage preview.
export const INCLUDED_DISTRICTS = Object.freeze({
  SW1A:'Westminster', SW1E:'Victoria', SW1H:'Westminster', SW1P:'Westminster',
  SW1V:'Pimlico', SW1W:'Belgravia', SW1X:'Knightsbridge', SW1Y:'St James’s',
  SW2:'Brixton / Streatham Hill', SW3:'Chelsea', SW4:'Clapham', SW5:'Earl’s Court',
  SW6:'Fulham', SW7:'South Kensington', SW8:'Vauxhall', SW9:'Stockwell',
  SW10:'West Brompton', SW11:'Battersea', SW12:'Balham', SW13:'Barnes', SW14:'Mortlake',
  SW15:'Putney', SW16:'Streatham', SW17:'Tooting', SW18:'Southfields / Wandsworth',
  SW19:'Wimbledon / Colliers Wood', SW20:'Raynes Park', SM4:'Morden', CR4:'Mitcham',
  KT2:'Kingston', KT3:'New Malden', TW9:'Richmond', TW10:'Richmond / Ham'
});
export const NEARBY_DISTRICTS = Object.freeze([
  'SE11','SE5','SE24','SE27','SE19','CR7','SM6','SM5','SM1','SM3','KT4','KT5','TW11','TW1',
  'KT1','W6','W14','W8','W2','W4','SE1','SE17','SE21'
]);
export function postcodeDistrict(value) {
  const compact=String(value||'').toUpperCase().replace(/\s/g,'');
  const full=compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$/);
  if(full)return full[1];
  return /^[A-Z]{1,2}\d[A-Z\d]?$/.test(compact)?compact:null;
}
export function isTravelIncluded(value) {
  return Object.hasOwn(INCLUDED_DISTRICTS,postcodeDistrict(value)||'');
}

export const MAPPED_DISTRICTS = Object.freeze(["SM1", "SM3", "SM4", "SM5", "SM6", "KT1", "KT2", "KT3", "KT4", "KT5", "KT6", "KT7", "KT8", "KT9", "KT10", "KT17", "KT19", "TW1", "TW7", "TW8", "TW9", "TW10", "TW11", "SE1", "SE5", "SE11", "SE15", "SE17", "SE19", "SE21", "SE22", "SE24", "SE25", "SE27", "SW1A", "SW1E", "SW1H", "SW1P", "SW1V", "SW1W", "SW1X", "SW1Y", "SW2", "SW3", "SW4", "SW5", "SW6", "SW7", "SW8", "SW9", "SW10", "SW11", "SW12", "SW13", "SW14", "SW15", "SW16", "SW17", "SW18", "SW19", "SW20", "W1D", "W1F", "W1H", "W1J", "W1K", "W1S", "W2", "W3", "W4", "W5", "W6", "W8", "W10", "W11", "W12", "W13", "W14", "CR0", "CR4", "CR7"]);

// Applies to districts displayed on the map; beyond-map visits need an enquiry.
export function coverageBand(value) {
  const code=postcodeDistrict(value);
  if(!code || !MAPPED_DISTRICTS.includes(code))return {tier:'check',fee:null};
  if(isTravelIncluded(code))return {tier:'included',fee:0};
  if(NEARBY_DISTRICTS.includes(code))return {tier:'nearby',fee:15};
  return {tier:'extended',fee:35};
}

export function fullPostcode(value) {
  const compact=String(value||'').toUpperCase().replace(/\s/g,'');
  return /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact)
    ? compact.slice(0,-3)+' '+compact.slice(-3) : null;
}
export function travelQuote(postcode,appointment) {
  const band=coverageBand(postcode);
  const visits={'Starter Programme':4,'Full Programme':6,'Block of 4 Sessions':4,'Block of 6 Sessions':6}[appointment]||1;
  return {...band,visits,total:band.fee===null?null:band.fee*visits};
}

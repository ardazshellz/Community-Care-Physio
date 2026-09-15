import {INCLUDED_DISTRICTS,postcodeDistrict,isTravelIncluded,NEARBY_DISTRICTS,coverageBand,fullPostcode,travelQuote} from './coverage-policy.js';
window.CCPCoverage={INCLUDED_DISTRICTS,postcodeDistrict,isTravelIncluded,NEARBY_DISTRICTS,coverageBand,fullPostcode,travelQuote};
const names={...INCLUDED_DISTRICTS,W6:'Hammersmith',SW1A:'Westminster',KT1:'Kingston',SE1:'London Bridge / Southwark',TW9:'Richmond',CR0:'Croydon',SW2:'Brixton / Streatham Hill',SW3:'Chelsea',SW4:'Clapham',SW5:'Earl’s Court',SW6:'Fulham',SW7:'South Kensington',SW8:'Vauxhall',SW9:'Stockwell',SW10:'West Brompton',SW11:'Battersea',SW12:'Balham',SW13:'Barnes',SW14:'Mortlake',CR4:'Mitcham',CR7:'Thornton Heath',KT2:'Kingston',KT3:'New Malden',KT4:'Worcester Park',SM1:'Sutton',SM3:'Cheam',SM5:'Carshalton',SE19:'Upper Norwood',SE27:'West Norwood',TW10:'Richmond'};
const container=document.getElementById('coverage-map');
const select=document.getElementById('coverage-select');
const heading=document.getElementById('coverage-heading');
const detail=document.getElementById('coverage-detail');
const button=document.getElementById('coverage-book');
let selected='SW19', checkedPostcode='', mapData=null;
const checkForm=document.getElementById('coverage-check-form');
const checkStatus=document.getElementById('coverage-check-status');
function show(code){
  button.disabled=false;
  heading.textContent=code;
  document.getElementById('coverage-place').textContent=names[code]||'London & surrounding areas';
  const band=coverageBand(code);
  detail.textContent=band.fee===0?'Travel included in your appointment price.':`£${band.fee} travel fee per visit${band.tier==='extended'?' · by arrangement':''}.`;
}
function book(code){
  selected=code;select.value=code;show(code);
  window.openM((names[code]||code)+' ('+code+')', checkedPostcode && postcodeDistrict(checkedPostcode)===code ? checkedPostcode : code);
}
button.addEventListener('click',()=>book(selected));
select.addEventListener('change',()=>{
  selected=select.value;show(selected);
  container.querySelector('.coverage-pin')?.remove();
  checkedPostcode='';
  container.querySelectorAll('.coverage-district').forEach(g=>g.classList.toggle('selected',g.dataset.code===selected));
});
const ns='http://www.w3.org/2000/svg';
function svgEl(name,attrs){const el=document.createElementNS(ns,name);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);return el;}
async function loadMap(){
  try{
    const response=await fetch('/assets/coverage-districts.json');
    if(!response.ok)throw new Error('Map unavailable');
    const data=await response.json();mapData=data;
    const svg=svgEl('svg',{viewBox:data.viewBox,role:'group','aria-label':'South West London postcode districts. Green: travel included. Yellow: £15 per visit. Grey: £35 per visit. Select a district to book.'});
    for(const district of data.districts){
      const code=district.code;
      if(!Array.from(select.options).some(o=>o.value===code))select.add(new Option(code+(names[code]?' · '+names[code]:''),code));
      const tier=coverageBand(code).tier;
      const g=svgEl('g',{class:'coverage-district'+(district.small?' small':''),tabindex:'0',role:'button','data-code':code,'data-tier':tier,'aria-label':code+(names[code]?' '+names[code]:'')+({included:', travel included',nearby:', £15 travel per visit',extended:', £35 travel per visit',check:', journey check needed'}[tier])+', book a visit'});
      g.append(svgEl('path',{d:district.path,'fill-rule':'evenodd'}));
      const title=svgEl('title',{});title.textContent=code+(names[code]?' · '+names[code]:'');g.append(title);
      const text=svgEl('text',{x:district.label[0],y:district.label[1]});text.textContent=code;g.append(text);
      if(!district.small && INCLUDED_DISTRICTS[code]){const label=svgEl('text',{x:district.label[0],y:district.label[1]+15,class:'coverage-place'});label.textContent={SW18:'Southfields',SW19:'Wimbledon'}[code]||names[code];g.append(label);}
      g.addEventListener('click',()=>book(code));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();book(code);}});
      svg.append(g);
    }
    if(data.riverPath){
      const river=svgEl('path',{d:data.riverPath,class:'coverage-river','fill-rule':'evenodd','aria-label':'River Thames',role:'img'});
      svg.append(river);
      const riverLabel=svgEl('text',{x:285,y:231,class:'coverage-river-label',transform:'rotate(12 285 231)'});riverLabel.textContent='River Thames';svg.append(riverLabel);
    }
    container.replaceChildren(svg);select.value=selected;show(selected);
  }catch(error){container.textContent='The map could not load. You can still choose an included area from the list to book.';}
}
loadMap();

checkForm.addEventListener('submit',e=>{
  e.preventDefault();
  const value=document.getElementById('coverage-postcode').value;
  const full=fullPostcode(value), code=postcodeDistrict(value);
  const district=mapData?.districts.find(d=>d.code===code);
  container.querySelector('.coverage-pin')?.remove();
  checkedPostcode='';button.disabled=true;
  const contact=document.getElementById('coverage-travel-contact');contact.hidden=true;
  if(!full && value.replace(/\s/g,'').toUpperCase()!==code){checkStatus.textContent='Enter a postcode, for example SW15 1AA, or a district such as SW15.';return;}
  if(!district){contact.hidden=false;contact.href='https://wa.me/447508401627?text='+encodeURIComponent('Hello, I’m interested in a home physiotherapy visit in '+code+'. Could you confirm availability and the travel fee?');checkStatus.textContent=`${code || 'This postcode'} is outside our mapped coverage. Use WhatsApp below to check availability and travel costs.`;return;}
  selected=code;checkedPostcode=full||code;select.value=code;show(code);
  container.querySelectorAll('.coverage-district').forEach(g=>g.classList.toggle('selected',g.dataset.code===code));
  const pin=svgEl('g',{class:'coverage-pin',transform:`translate(${district.label[0]} ${district.label[1]-18})`,role:'img','aria-label':`Approximate ${code} district location`});
  pin.append(svgEl('path',{d:'M0 0 C-4 -6 -12 -13 -12 -21 A12 12 0 1 1 12 -21 C12 -13 4 -6 0 0 Z',fill:'#193f31',stroke:'white','stroke-width':2}),svgEl('circle',{cx:0,cy:-21,r:4,fill:'white'}));
  container.querySelector('svg').append(pin);
  const band=coverageBand(code);
  checkStatus.textContent=`${code}: ${band.fee===0?'travel included':`£${band.fee} travel per visit`}. Pin shows the district approximately, not your exact home.`;
});

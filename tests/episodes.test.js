import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Episode grouping in assets/admin.js: a patient's single bookings drawn as one card.
const src=readFileSync(new URL('../assets/admin.js',import.meta.url),'utf8');
function source(name){
 const start=src.search(new RegExp('function '+name+'\\('));
 assert.ok(start>=0,name);
 return src.slice(start,src.indexOf('\n}',start)+2);
}
const ids=list=>list.map(b=>b.id).join(',');
function setup(bookings){
 const c=vm.createContext({Map,Set,Array,String,Number,RegExp,adminBookings:bookings,cbDismissed:[],PACKAGE_SIZES:{},window:{},
  aIsPackage:b=>Array.isArray(b.customSessions)&&b.customSessions.length>0});
 for(const name of ['patientKey','aEpisodeDone','aEpisodeSingle','aEpisodeKeys','aEpisodes','aEpisodeFor','aEpisodeOpen','aEpisodeVisitOrder','aIsInitialAssessment','aEpisodeFunding'])vm.runInContext(source(name),c);
 return c;
}
// Fictional case: initial assessment booked with an email, treatment sessions created with only a contact phone.
const initial={id:'a',name:'Jordan Fictional',email:'jordan@example.com',phone:'',appointment:'Initial Assessment',bookedDate:'2026-10-08',bookedTime:'11:00',status:'completed',paid:true};
const s1={id:'b',name:'Jordan Fictional',email:'',phone:'07000 000010',appointment:'Extended Session',bookedDate:'2026-10-17',bookedTime:'11:15',status:'completed',paid:false,confirmed:true,bookingFor:'referral'};
const s2={id:'c',name:'Jordan Fictional',email:'',phone:'07000000010',appointment:'Extended Session',bookedDate:'2026-10-22',bookedTime:'17:00',status:'invoiced',paid:false,confirmed:true};
const s3={id:'d',name:'Jordan Fictional',email:'',phone:'+44 7000 000010',appointment:'Extended Session',bookedDate:'2026-10-23',bookedTime:'16:00',status:'invoiced',paid:false,confirmed:true};
const other={id:'e',name:'Pat Other',email:'pat@example.com',phone:'07000 000099',appointment:'Initial Assessment',bookedDate:'2026-10-20',bookedTime:'10:00',status:null,paid:true};

test('visits that share an email, phone or name form one episode',()=>{
 const c=setup([s3,initial,other,s2,s1]);
 const ep=c.aEpisodes(), fam=c.aEpisodeFor(initial,ep);
 assert.equal(ids(fam),'a,b,c,d');
 assert.equal(c.aEpisodeFor(s3,ep),fam,'same shared member array from any visit');
 assert.equal(ids(c.aEpisodeFor(other)),'e');
 assert.equal(ids(c.aEpisodeFor({phone:'07000000010'})),'a,b,c,d','lookup by contact details alone');
});
test('visit rows run newest first, initial assessment last',()=>{
 const c=setup([s3,initial,s2,s1]);
 assert.equal(ids(c.aEpisodeVisitOrder(c.aEpisodeFor(initial))),'d,c,b,a');
});
test('a completed visit stays in the open episode and out of the archive',()=>{
 const c=setup([s3,initial,s2,s1]);
 assert.equal(c.aEpisodeOpen(c.aEpisodeFor(initial)),true);
 const done=[initial,{...s1,status:'completed'},{...s2,status:'completed'},{...s3,status:'dna'}];
 assert.equal(c.aEpisodeOpen(setup(done).aEpisodeFor(initial)),false,'all visits done: episode closes');
});
test('a completed visit counts even when its payment flags look like an unpaid checkout',()=>{
 const c=setup([{...initial,paid:false,confirmed:false},s1]);
 assert.equal(c.aEpisodeFor(s1).length,2);
 assert.equal(c.aEpisodeSingle({...initial,status:null,paid:false,confirmed:false}),false,'a pending unpaid checkout is not a visit');
});
test('case managed episode reports booked and used sessions against the authorised allowance',()=>{
 const c=setup([s3,initial,s2,s1]);
 c.window.CCPPractice={referralFor:()=>({ref:'R-DEMO03',funder:'Example Case Management',authorised:8})};
 assert.equal(JSON.stringify(c.aEpisodeFunding(c.aEpisodeFor(initial))),JSON.stringify({funder:'Example Case Management',ref:'R-DEMO03',authorised:8,booked:3,used:1}));
 c.window.CCPPractice={referralFor:()=>null};
 assert.equal(c.aEpisodeFunding(c.aEpisodeFor(initial)).authorised,0,'invoiced visits still mark the episode as case managed');
 assert.equal(c.aEpisodeFunding([other]),null,'a public booking is not case managed');
});

// Referral lookup in assets/practice.js: by linked booking id, the referral reference inside a visit's reason, or the client's contact details.
test('referralFor matches a referral by reference in the reason or by contact details, never by a different client',()=>{
 const psrc=readFileSync(new URL('../assets/practice.js',import.meta.url),'utf8');
 const start=psrc.indexOf('function referralFor('); assert.ok(start>0);
 const refs=[{key:'referral:1',value:{ref:'26074807',bookingId:null,client:{name:'Mrs L Marshall-Fictional',email:'',contactPhone:'07000 000010'},funding:{payerName:'Example Case Management',authorisedSessions:8}}},
  {key:'referral:2',value:{ref:'R-OTHER',client:{name:'Pat Other',email:'pat@example.com'},funding:{authorisedSessions:2}}}];
 const c=setup([]); vm.runInContext('const state={referrals:'+JSON.stringify(refs)+'};'+psrc.slice(start,psrc.indexOf('\n}\n',start)+2),c);
 assert.equal(c.referralFor([{id:'x',name:'Leslie Fictional',email:'',phone:'',reason:'HCML 26074807, authorised session'}]).key,'referral:1','reference in the reason');
 assert.equal(c.referralFor([{id:'y',name:'Leslie Fictional',email:'',phone:'+44 7000 000010',reason:''}]).key,'referral:1','contact phone');
 assert.equal(c.referralFor([{id:'z',name:'Someone Else',email:'',phone:'',reason:''}]),null);
 assert.equal(c.referralFor([{id:'w',name:'Pat Other',email:'',phone:'',reason:''}]).authorised,2,'client name');
});

test('a funded card draws one placeholder per unbooked funded session, the first with a Book button',()=>{
 const c=setup([]);
 vm.runInContext(source('aEpisodeToBookRows')+'function aSessMeta(){return {i:"○",c:"#000"};}function aEsc(x){return String(x);}',c);
 const html=c.aEpisodeToBookRows({authorised:8,booked:3,used:3},{id:'x'});
 assert.equal((html.match(/episode-tobook/g)||[]).length,5);
 assert.equal((html.match(/📅 Book/g)||[]).length,1);
 assert.ok(html.includes('Session 4 of 8'));
 assert.equal(c.aEpisodeToBookRows({authorised:3,booked:3,used:1},{id:'x'}),'','nothing left to book');
 assert.equal(c.aEpisodeToBookRows({authorised:0,booked:3,used:1},{id:'x'}),'','funding not set');
});

test('active cards sort by soonest upcoming visit, finished cards after by most recent visit',()=>{
 const far=new Date(); far.setDate(far.getDate()+9); const soon=new Date(); soon.setDate(soon.getDate()+2);
 const iso=d=>d.toISOString().slice(0,10);
 const a={id:'a',name:'A',email:'a@example.com',appointment:'Standard Session',bookedDate:iso(far),status:null};
 const b={id:'b',name:'B',email:'b@example.com',appointment:'Standard Session',bookedDate:iso(soon),status:null};
 const done={id:'c',name:'C',email:'c@example.com',appointment:'Block of 4 Sessions',customSessions:[{date:'2026-01-05',status:'completed'},{date:'2026-02-01',status:'completed'}]};
 const older={id:'d',name:'D',email:'d@example.com',appointment:'Block of 4 Sessions',customSessions:[{date:'2025-06-01',status:'completed'}]};
 const c=setup([a,b,done,older]);
 vm.runInContext(source('aCardSortKey')+'function aDateKey(d){return d.toISOString().slice(0,10);}function aPkgSessions(b){return b.customSessions;}',c);
 const ep=c.aEpisodes();
 const order=[a,b,done,older].map(x=>[x,c.aCardSortKey(x,ep)]).sort((x,y)=>x[1].next.localeCompare(y[1].next)||y[1].last.localeCompare(x[1].last)).map(x=>x[0].id);
 assert.equal(order.join(','),'b,a,c,d');
});
test('add on session price follows the public list: 45 or 60 min, complex needs and travel band',()=>{
 const c=setup([]);
 vm.runInContext(source('aAddSessionPrice')+'const CB_PRICES={standard:{normal:75,complex:90},extended:{normal:90,complex:105}};',c);
 assert.equal(c.aAddSessionPrice('Standard Session',false,0),75);
 assert.equal(c.aAddSessionPrice('Extended Session',true,'15'),120);
 assert.equal(c.aAddSessionPrice('Standard Session',true,35),125);
});

test('a funded episode stays open after every visit is done while sessions remain to book',()=>{
 const done=[initial,{...s1,status:'completed'},{...s2,status:'completed'},{...s3,status:'completed'}];
 const c=setup(done);
 c.window.CCPPractice={referralFor:()=>({ref:'R-DEMO03',funder:'Example Case Management',authorised:8})};
 assert.equal(c.aEpisodeOpen(c.aEpisodeFor(initial)),true,'5 funded sessions left');
 c.window.CCPPractice={referralFor:()=>({ref:'R-DEMO03',funder:'Example Case Management',authorised:3})};
 assert.equal(c.aEpisodeOpen(c.aEpisodeFor(initial)),false,'all funded sessions booked and done');
});
test('add on form defaults recover the price list settings from the last visit',()=>{
 const c=setup([]);
 vm.runInContext(source('aAddSessionDefaults')+'const CB_PRICES={standard:{normal:75,complex:90},extended:{normal:90,complex:105}};',c);
 assert.equal(JSON.stringify(c.aAddSessionDefaults({appointment:'Extended Session',price:140,complexityFee:15})),JSON.stringify({type:'Extended Session',complex:true,travel:35}));
 assert.equal(JSON.stringify(c.aAddSessionDefaults({appointment:'Standard Session',price:90,complexityFee:15})),JSON.stringify({type:'Standard Session',complex:true,travel:0}));
 assert.equal(JSON.stringify(c.aAddSessionDefaults({appointment:'Standard Session',price:90})),JSON.stringify({type:'Standard Session',complex:false,travel:15}),'no complexity fee recorded: read £90 as travel');
 assert.equal(JSON.stringify(c.aAddSessionDefaults({appointment:'Standard Session',price:999})),JSON.stringify({type:'Standard Session',complex:false,travel:0}));
});

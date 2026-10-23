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

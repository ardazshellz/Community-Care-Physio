import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {reconcilePackageCompletion} from '../lib/package-completion.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function source(name){
 const start=html.search(new RegExp('(?:async )?function '+name+'\\('));
 assert.ok(start>=0,name);
 return html.slice(start,html.indexOf('\n}',start)+2);
}
function setup(statuses=['completed','completed','scheduled','unscheduled']){
 const memory=new Map(),saved=[],alerts=[];
 const b={id:'11111111-1111-4111-8111-111111111111',name:'Synthetic Patient',appointment:'Block of 4 Sessions',paid:true,status:'completed',
  customSessions:statuses.map((status,i)=>({status,date:status==='unscheduled'?null:'2025-01-01',time:'10:00',...(i===0?{packageCompletedAt:'2025-01-02T00:00:00Z'}:{})}))};
 const c=vm.createContext({Date,Set,Map,Promise,JSON,Number,String,Array,Math,
  adminBookings:[b],adminSessionToken:'synthetic',PACKAGE_SIZES:{'Block of 4 Sessions':4},ARCHIVE_MS:86400000,
  aArchiveMigrationInFlight:new Set(),
  localStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},
  fetch:async(url,opts)=>{saved.push(JSON.parse(opts.body));return {ok:true};},
  document:{getElementById:()=>null},patientKey:x=>x.name,aGetNewPatientKeys:()=>new Set(),
  alert:message=>alerts.push(message),confirm:()=>{throw Error('Must not offer completion while sessions remain');}
 });
 for(const name of ['aPkgSize','aIsPackage','aIsServerBooking','aPkgBaseSessions','aPkgLoadOverrides','aPkgSessions',
  'aPkgArchiveKey','aPkgServerCompletedAt','aPkgLocalCompletedAt','aPkgAllDone','aPkgIsComplete','aPkgDerivedCompletionTime',
  'aPkgArchivedAt','aPkgIsArchived','migratePackageArchiveState','aPkgSaveOverrides','aPkgComplete',
  'aDateKey','aActiveSessionStatus','getAdminOperationalMetrics','reviewRecordIsCurrentlyActive'])vm.runInContext(source(name),c);
 return {c,b,memory,saved,alerts};
}
test('outstanding visits outrank old completed flags on both dashboard and patient archive',()=>{
 const {c,b,memory}=setup();memory.set(c.aPkgArchiveKey(b.id),'1');
 assert.equal(c.aPkgIsComplete(b),false);assert.equal(c.aPkgIsArchived(b),false);
 assert.equal(c.getAdminOperationalMetrics().activePatients,1);
 assert.equal(c.getAdminOperationalMetrics().sessionsToBook,1);
 assert.equal(c.reviewRecordIsCurrentlyActive(b),true);
 c.migratePackageArchiveState();assert.equal(memory.has(c.aPkgArchiveKey(b.id)),false);
 assert.deepEqual(b.customSessions.map(s=>s.status),['completed','completed','scheduled','unscheduled']);
});
test('an unbooked or cancelled session prevents automatic archive',()=>{
 for(const pending of ['unscheduled','cancelled','scheduled','rescheduled']){
  const {c,b}=setup(['completed','completed','completed',pending]);
  assert.equal(c.aPkgIsArchived(b),false,pending);
 }
});
test('missing saved rows retain the remaining purchased sessions',()=>{
 const {c,b}=setup(['completed','completed']);
 assert.equal(c.aPkgSessions(b).length,4);
 assert.equal(c.aPkgIsComplete(b),false);
 assert.equal(c.getAdminOperationalMetrics().sessionsToBook,2);
});
test('fully used packages archive after 24 hours, including counted DNA visits',()=>{
 const {c,b}=setup(['completed','completed','completed','dna']);
 assert.equal(c.aPkgIsArchived(b),true);
 b.customSessions[0].packageCompletedAt=new Date().toISOString();
 assert.equal(c.aPkgIsComplete(b),true);assert.equal(c.aPkgIsArchived(b),false);
});
test('saving an unfinished package clears stale completion metadata without undoing completed visits',async()=>{
 const {c,b,saved}=setup();
 await c.aPkgSaveOverrides(b.id,b.customSessions);
 assert.equal(saved[0].packageStatus,'prepaid');assert.equal(saved[0].packageCompletedAt,null);
 assert.equal(saved[0].sessions[0].status,'completed');
 assert.equal(saved[0].sessions[1].status,'completed');
 assert.equal(saved[0].sessions[3].status,'unscheduled');
 assert.equal(saved[0].sessions.some(s=>s.packageCompletedAt),false);
});
test('whole-package completion cannot skip an unbooked visit',async()=>{
 const {c,alerts,saved}=setup();await c.aPkgComplete(0);
 assert.equal(alerts.length,1);assert.equal(saved.length,0);
});
test('server rejects stale completion metadata submitted by an older browser',()=>{
 const {b}=setup();
 const update=reconcilePackageCompletion({status:'completed',custom_sessions:structuredClone(b.customSessions)},b);
 assert.equal(update.status,'prepaid');
 assert.equal(update.custom_sessions.some(s=>s.packageCompletedAt),false);
 assert.equal(update.custom_sessions[0].status,'completed');
 const incomplete=reconcilePackageCompletion({status:'completed',custom_sessions:[{status:'completed',packageCompletedAt:'2025-01-01'}]},b);
 assert.equal(incomplete.status,'prepaid');
});

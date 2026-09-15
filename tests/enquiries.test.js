import test, {before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createEnquiryService} from '../lib/enquiries.js';
import {cleanEnquiry,normalisePhone} from '../lib/enquiry-model.js';

let pg,service,stripe;
const sessions=new Map(),keys=new Map();
const future=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
const details=()=>({name:'Example Test',email:'example@example.invalid',phone:'07700900123',channel:'email',
 address:'1 Test Street',postcode:'SW19 0AA',needs:'improving balance',goals:'walking with confidence',
 approach:'We can plan an individual assessment.',date:future,time:'10:00',amount:'100'});
const rpc=async(name,p)=>{
 try{return {data:(await pg.query('select public.enquiry_command($1,$2,$3::jsonb,$4) as result',[p.p_id,p.p_action,JSON.stringify(p.p_payload),p.p_version])).rows[0].result};}
 catch(error){return {error};}
};
const db={rpc,from(table){
 assert.equal(table,'patient_enquiries');
 let id=null,one=false;
 const q={select(){return q;},eq(k,v){assert.equal(k,'id');id=v;return q;},single(){one=true;return q;},order(){return q;},limit(){return q;},
 then(resolve,reject){return pg.query('select * from patient_enquiries'+(id?' where id=$1':''),id?[id]:[]).then(r=>resolve({data:one?r.rows[0]:r.rows}),reject);}};
 return q;
}};
before(async()=>{
 pg=new PGlite();
 await pg.exec(`
  create role anon;create role authenticated;create role service_role bypassrls;
  create table bookings(id uuid primary key default gen_random_uuid(),name text not null,email text,phone text,address text,postcode text,
   appointment text not null,duration text,price integer,booked_date date,booked_time text,patient_type text,booking_for text,reason text,
   paid boolean default false,confirmed boolean default false,status text,stripe_session_id text unique);
  create table blocked_slots(id uuid primary key default gen_random_uuid(),booking_date date not null,slot_time text not null,booking_id uuid references bookings(id),unique(booking_date,slot_time));
  create table pending_bookings(id uuid primary key default gen_random_uuid(),stripe_session_id text not null unique,booking_data jsonb not null,
   booked_date date,booked_time text,expires_at timestamptz);
 `);
 await pg.exec(await readFile(new URL('../supabase/migrations/20260915182533_patient_enquiries.sql',import.meta.url),'utf8'));
});
after(async()=>pg.close());
beforeEach(async()=>{
 await pg.exec('truncate patient_enquiries,blocked_slots,pending_bookings,bookings cascade');
 sessions.clear();keys.clear();
 stripe={checkout:{sessions:{
  async create(params,{idempotencyKey}){
   if(keys.has(idempotencyKey)){assert.deepEqual(keys.get(idempotencyKey).params,params);return sessions.get(keys.get(idempotencyKey).id);}
   const id='cs_test_'+randomUUID(),s={id,url:'https://checkout.stripe.com/c/pay/'+id,status:'open',payment_status:'unpaid',
    amount_total:params.line_items[0].price_data.unit_amount,currency:'gbp',metadata:params.metadata};
   sessions.set(id,s);keys.set(idempotencyKey,{params,id});return s;
  },
  async retrieve(id){assert.ok(sessions.has(id));return sessions.get(id);},
  async expire(id){const s=sessions.get(id);assert.equal(s.status,'open');s.status='expired';return s;}
 }}};
 service=createEnquiryService({db,stripe});
});
async function make(d=details()){
 return (await service.handle({operation:'save',id:randomUUID(),version:0,details:d,drafts:{subject:'Test enquiry',intro:'Hello Example'}})).enquiry;
}
async function intro(e){
 return (await service.handle({operation:'sent',id:e.id,version:e.version,kind:'intro',channel:e.details.channel})).enquiry;
}
async function checkout(e){return (await service.handle({operation:'checkout',id:e.id,version:e.version})).enquiry;}

test('enquiry saves without creating a patient booking and persists edited drafts',async()=>{
 let e=await make();
 assert.equal((await pg.query('select count(*) from bookings')).rows[0].count,0);
 e=(await service.handle({operation:'save',id:e.id,version:e.version,details:e.details,drafts:{intro:'Edited introduction'}})).enquiry;
 assert.equal((await service.handle({operation:'list'})).enquiries[0].drafts.intro,'Edited introduction');
 assert.equal(e.payment_state,'none');
});
test('authentication roles cannot read enquiries or invoke private mutations',async()=>{
 for(const role of ['anon','authenticated']){
  await pg.exec('set role '+role);
  await assert.rejects(()=>pg.query('select * from patient_enquiries'),/permission denied/);
  await assert.rejects(()=>pg.query("select enquiry_command($1,'save','{}',0)",[randomUUID()]),/permission denied/);
  await pg.exec('reset role');
 }
});
test('stale version cannot overwrite a newer edit',async()=>{
 const e=await make();
 await service.handle({operation:'save',id:e.id,version:e.version,details:e.details,drafts:{intro:'Newer'}});
 await assert.rejects(()=>service.handle({operation:'save',id:e.id,version:e.version,details:e.details,drafts:{intro:'Stale'}}),/changed/);
});
test('payment needs introduction sent; opening or editing a draft alone is insufficient',async()=>{
 const e=await make();
 await assert.rejects(()=>checkout(e),/introduction/);
 assert.equal(sessions.size,0);
});
test('reservation creates one unpaid booking, blocks full duration and travel, retry reuses link',async()=>{
 let e=await checkout(await intro(await make()));
 assert.equal(e.payment_state,'open');
 assert.equal((await pg.query('select * from blocked_slots')).rows.length,4);
 assert.equal((await pg.query('select * from bookings')).rows[0].paid,false);
 const again=await checkout(e);
 assert.equal(again.payment_url,e.payment_url);assert.equal(sessions.size,1);
 await assert.rejects(()=>service.handle({operation:'save',id:e.id,version:e.version,details:{...e.details,date:'2030-01-01'},drafts:e.drafts}),/locked/);
});
test('overlapping enquiries and existing pending checkouts cannot reserve the appointment',async()=>{
 await checkout(await intro(await make()));
 const e=await intro(await make({...details(),time:'11:00'}));
 await assert.rejects(()=>checkout(e),/overlaps/);
 assert.equal((await pg.query('select count(*) from bookings')).rows[0].count,1);
 await pg.query("insert into pending_bookings(stripe_session_id,booking_data,booked_date,booked_time,expires_at) values('test','{}',$1,'15:00',now()+interval '1 hour')",[future]);
 const next=await intro(await make({...details(),time:'14:00'}));
 await assert.rejects(()=>checkout(next),/overlaps/);
});
test('verified paid session promotes exactly once to the dashboard booking',async()=>{
 const e=await checkout(await intro(await make()));
 const s=sessions.get(e.stripe_session_id);s.status='complete';s.payment_status='paid';
 const paid=await service.settleSession(s);
 assert.equal(paid.payment_state,'paid');
 const again=await service.settleSession(s);assert.equal(again.version,paid.version);
 const rows=(await pg.query('select * from bookings')).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].paid,true);assert.equal(rows[0].confirmed,true);assert.equal(rows[0].patient_type,'new');
 assert.equal((await pg.query('select * from blocked_slots')).rows.length,4);
});
test('delayed payment remains unconfirmed until paid, and cannot be cancelled mid-processing',async()=>{
 let e=await checkout(await intro(await make()));
 const s=sessions.get(e.stripe_session_id);s.status='complete';
 e=await service.settleSession(s);assert.equal(e.payment_state,'processing');
 assert.equal((await pg.query('select paid from bookings')).rows[0].paid,false);
 await assert.rejects(()=>service.handle({operation:'cancel',id:e.id}),/processing/);
 s.payment_status='paid';assert.equal((await service.settleSession(s)).payment_state,'paid');
});
test('wrong currency, amount and session do not confirm a patient',async()=>{
 const e=await checkout(await intro(await make()));
 const s=sessions.get(e.stripe_session_id);
 await assert.rejects(()=>service.settleSession({...s,payment_status:'paid',amount_total:1}),/mismatch/);
 await assert.rejects(()=>service.settleSession({...s,payment_status:'paid',currency:'usd'}),/mismatch/);
 await assert.rejects(()=>service.settleSession({...s,payment_status:'paid',id:'wrong'}),/mismatch/);
 assert.equal((await pg.query('select paid from bookings')).rows[0].paid,false);
});
test('expired and cancelled links release slots and can be replaced without duplicate patients',async()=>{
 let e=await checkout(await intro(await make()));
 const old=sessions.get(e.stripe_session_id);
 e=(await service.handle({operation:'cancel',id:e.id})).enquiry;
 assert.equal(e.payment_state,'expired');assert.equal((await pg.query('select * from blocked_slots')).rows.length,0);
 e=await checkout(e);assert.equal(sessions.size,2);
 await service.settleSession(old);
 assert.equal((await pg.query('select payment_state from patient_enquiries')).rows[0].payment_state,'open');
});
test('failed asynchronous payment releases the reserved appointment',async()=>{
 const e=await checkout(await intro(await make()));
 const s=sessions.get(e.stripe_session_id);s.status='complete';
 assert.equal((await service.settleSession(s,true)).payment_state,'failed');
 assert.equal((await pg.query('select * from blocked_slots')).rows.length,0);
});
test('payment send history requires current URL and retains message text and channel',async()=>{
 let e=await checkout(await intro(await make()));
 await assert.rejects(()=>service.handle({operation:'sent',id:e.id,version:e.version,kind:'payment',channel:'email'}),/draft/);
 e=(await service.handle({operation:'save',id:e.id,version:e.version,details:e.details,drafts:{...e.drafts,payment:'Please pay '+e.payment_url}})).enquiry;
 e=(await service.handle({operation:'sent',id:e.id,version:e.version,kind:'payment',channel:'whatsapp'})).enquiry;
 assert.equal(e.communications[1].channel,'whatsapp');assert.ok(e.communications[1].body.includes(e.payment_url));
});
test('Stripe creation timeout can be recovered without a second session',async()=>{
 const original=stripe.checkout.sessions.create;
 let fail=true;
 stripe.checkout.sessions.create=async(...args)=>{const s=await original(...args);if(fail){fail=false;throw new Error('Timeout');}return s;};
 const e=await intro(await make());
 await assert.rejects(()=>checkout(e),/Timeout/);
 const persisted=(await service.handle({operation:'list'})).enquiries[0];
 assert.equal(persisted.payment_state,'creating');
 const recovered=await checkout(persisted);assert.equal(recovered.payment_state,'open');assert.equal(sessions.size,1);
});
test('SQL transaction failure does not mark paid or partially promote',async()=>{
 const e=await checkout(await intro(await make()));
 await pg.exec("alter table bookings add constraint test_block_paid check (paid=false)");
 const s=sessions.get(e.stripe_session_id);s.payment_status='paid';
 await assert.rejects(()=>service.settleSession(s),/test_block_paid/);
 assert.equal((await pg.query('select payment_state from patient_enquiries')).rows[0].payment_state,'open');
 await pg.exec('alter table bookings drop constraint test_block_paid');
 assert.equal((await service.settleSession(s)).payment_state,'paid');
});
test('validation rejects malformed data and normalises UK WhatsApp numbers',()=>{
 assert.equal(normalisePhone('07700 900123'),'447700900123');
 assert.equal(normalisePhone('+353 87 123 4567'),'353871234567');
 assert.equal(normalisePhone('javascript:alert(1)'),'');
 for(const patch of [{name:''},{email:'bad'},{time:'25:00'},{time:'22:30'},{date:'2026-99-99'},{date:'2026-02-30'},{amount:'99.99'},{channel:'fax'}])
  assert.throws(()=>cleanEnquiry({details:{...details(),...patch}}));
 const clean=cleanEnquiry({details:{...details(),paid:true},drafts:{intro:'hello',paid:true}});
 assert.equal(clean.details.paid,undefined);
});
test('a public checkout arriving after an enquiry reservation cannot hold an overlapping visit',async()=>{
 await checkout(await intro(await make()));
 for(const time of ['09:00','10:00','11:30'])await assert.rejects(()=>pg.query(
  "insert into pending_bookings(stripe_session_id,booking_data,booked_date,booked_time,expires_at) values($1,'{}',$2,$3,now()+interval '32 minutes')",
  ['public_'+time,future,time]),/overlaps an enquiry reservation/);
 await pg.query("insert into pending_bookings(stripe_session_id,booking_data,booked_date,booked_time,expires_at) values('public_clear','{}',$1,'12:00',now()+interval '32 minutes')",[future]);
 assert.equal((await pg.query('select * from pending_bookings')).rows.length,1);
});

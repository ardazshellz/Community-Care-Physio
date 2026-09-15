import {normalisePhone} from '../lib/enquiry-model.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const detailFields=['name','email','phone','channel','address','postcode','needs','goals','approach','date','time','amount'];
const draftFields=['subject','intro','payment','confirmation'];
const state={records:[],current:null,dirty:false,busy:false,query:'',generation:0};
const $=id=>document.getElementById(id);
const locked=e=>['creating','open','processing','paid'].includes(e.payment_state);
const sent=(e,k)=>e.communications?.some(x=>x.kind===k && (k!=='payment'||x.attempt_id===e.attempt_id));
const money=v=>'£'+Number(v||0).toFixed(2);
function dateLabel(e){return e.details.date ? new Date(e.details.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+' at '+e.details.time : '[agreed date and time]';}
function stage(e){
 if(e.payment_state==='paid')return 4;
 if(e.payment_state==='processing'||(['creating','open'].includes(e.payment_state)&&sent(e,'payment')))return 3;
 if(e.details.date&&e.details.time&&sent(e,'intro'))return 2;
 return sent(e,'intro')?1:0;
}
function label(e){if(e.payment_state==='open'&&!sent(e,'payment'))return 'Payment link ready — not yet sent';return ({expired:'Payment link expired',failed:'Payment failed',processing:'Payment processing'})[e.payment_state] || ['Query patient','Awaiting preferred time','Appointment agreed','Awaiting payment','Paid · confirmed patient'][stage(e)];}
function status(message,error=false){$('eqStatus').textContent=message;$('eqStatus').classList.toggle('error',error);}
function updateRecord(e){
 state.current=e;
 const i=state.records.findIndex(x=>x.id===e.id);
 if(i<0)state.records.unshift(e);else state.records[i]=e;
 state.dirty=false;renderEditor();renderList();summary();
}
async function api(operation,extra={}){
 const generation=state.generation;
 const token=sessionStorage.getItem('ccp_admin_token');
 if(!token)throw new Error('Sign in to load patient enquiries.');
 const res=await fetch('/api/get-bookings',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({token,action:'enquiries',operation,...extra})});
 const data=await res.json();
 if(generation!==state.generation)throw new Error('Session changed. Sign in again.');
 if(!res.ok)throw new Error(data.error||'Could not save. Your draft is still here.');
 return data;
}
async function run(task){
 if(state.busy)return;
 state.busy=true;setBusy();
 try{await task();}catch(e){status(e.message,true);}
 finally{state.busy=false;setBusy();}
}
function setBusy(){
 document.querySelectorAll('#eqPanel button').forEach(b=>{b.disabled=state.busy;});
 document.querySelectorAll('#eqEditor input,#eqEditor textarea,#eqEditor select').forEach(el=>{
  if(state.busy&&!el.disabled){el.dataset.busyDisabled='true';el.disabled=true;}
  else if(!state.busy&&el.dataset.busyDisabled){el.disabled=false;delete el.dataset.busyDisabled;}
 });
 if($('eqSave'))$('eqSave').disabled=state.busy||!state.current;
}
function readForm(){
 if(!state.current)return null;
 const e=structuredClone(state.current);
 for(const k of detailFields)e.details[k]=$('eq-'+k).value;
 for(const k of draftFields)if($('eq-'+k))e.drafts[k]=$('eq-'+k).value;
 return e;
}
async function save(){
 const e=readForm();
 const data=await api('save',{id:e.id,version:e.version,details:e.details,drafts:e.drafts});
 updateRecord(data.enquiry);status('Enquiry and message drafts saved.');
}
function dirty(){state.dirty=true;if($('eqSaveHint'))$('eqSaveHint').textContent='Unsaved changes — save before opening a message.';}
function template(kind,e){
 const d=e.details,first=d.name.trim().split(/\s+/)[0]||'there';
 const signature='Kind regards,\nZakery\nCommunity Care Physio\nhttps://www.communitycarephysio.co.uk/';
 if(kind==='intro')return 'Hello '+first+',\n\nThank you for getting in touch'+(d.needs?' and letting us know about '+d.needs.replace(/[.\s]+$/,''):'')+'.\n\n'+(d.approach||'We can work with you to develop an individual programme, which may include strength, balance and manual therapy where appropriate, following an initial assessment.')+(d.goals?' Our aim would be to work towards your goals of '+d.goals.replace(/[.\s]+$/,'')+'.':'')+'\n\nPlease let us know a day and time that would work best for a home visit. Once we have agreed an appointment, I can send across a secure payment link to confirm your booking.\n\n'+signature;
 if(kind==='payment')return 'Hello '+first+',\n\nThank you for confirming a suitable time. We have arranged your initial assessment for '+dateLabel(e)+' at '+(d.address||'[visit address]')+(d.postcode?', '+d.postcode:'')+'.\n\nThe appointment is 60 minutes and the agreed fee is '+money(d.amount)+'. Please use the secure link below to pay:\n'+(e.payment_url||'[payment link will appear here]')+'\n\n'+(e.expires_at?'Please pay before '+new Date(e.expires_at).toLocaleString('en-GB',{timeZone:'Europe/London'})+' (UK time). ':'')+'Your appointment will be confirmed once payment has been received. Please get in touch if you need to discuss anything before booking.\n\n'+signature;
 return 'Hello '+first+',\n\nThank you — your payment of '+money(d.amount)+' has been received and your initial assessment is confirmed for '+dateLabel(e)+'.\n\nWe will visit you at '+d.address+', '+d.postcode+'. Please wear comfortable clothing and have any relevant letters or reports to hand.\n\nWe look forward to meeting you.\n\n'+signature;
}
function field(k,title,type='text',wide=false){
 const e=state.current,d=e.details,disabled=locked(e)?' disabled':'';
 let input;
 if(type==='textarea')input='<textarea id="eq-'+k+'"'+disabled+'>'+esc(d[k])+'</textarea>';
 else if(k==='channel')input='<select id="eq-channel"'+disabled+'><option value="email"'+(d.channel==='email'?' selected':'')+'>Email</option><option value="whatsapp"'+(d.channel==='whatsapp'?' selected':'')+'>WhatsApp</option></select>';
 else input='<input id="eq-'+k+'" type="'+type+'" value="'+esc(d[k])+'"'+disabled+(type==='number'?' min="10" max="5000" step="1"':type==='time'?' step="1800"':'')+'>';
 return '<label class="eq-field'+(wide?' eq-wide':'')+'">'+title+input+'</label>';
}
function messageCard(k,title){
 const e=state.current;
 return '<section class="eq-section"><h3>'+title+'</h3><label class="eq-field">Editable message<textarea id="eq-'+k+'" class="eq-draft">'+esc(e.drafts[k]||'')+'</textarea></label><div class="eq-actions"><button class="eq-btn" data-action="generate" data-kind="'+k+'">Generate draft</button><button class="eq-btn" data-action="open" data-kind="'+k+'">Open '+(e.details.channel==='whatsapp'?'WhatsApp':'Gmail')+' draft</button><button class="eq-btn" data-action="sent" data-kind="'+k+'">I have sent this message</button></div><p class="eq-muted">'+(sent(e,k)?'Recorded as sent. You can edit and send a follow-up.':'Review, save, then send the draft. Record it as sent afterwards.')+'</p></section>';
}
function renderEditor(){
 const e=state.current,host=$('eqEditor');
 if(!e){host.innerHTML='<div class="eq-placeholder">Save someone as a query patient, keep the conversation together, then arrange their first appointment.</div>';return;}
 const names=['Query patient','Introduction sent','Appointment agreed','Payment requested','Confirmed patient'],step=stage(e);
 host.innerHTML='<ol class="eq-flow" aria-label="Enquiry progress">'+names.map((n,i)=>'<li class="'+(i<=step?'done ':'')+(i===step?'current':'')+'"'+(i===step?' aria-current="step"':'')+'><b>'+(i<step?'✓':i+1)+'</b>'+n+'</li>').join('')+'</ol>'+
 '<section class="eq-section"><h3>1. Patient enquiry</h3><div class="eq-grid">'+
 field('name','Patient name')+field('channel','Preferred contact method','select')+field('email','Email address','email')+field('phone','Mobile / WhatsApp number','tel')+
 field('address','Visit address','text',true)+field('postcode','Postcode')+
 field('needs','What they would like help with (optional)','textarea',true)+field('goals','Their goals (optional)','textarea',true)+
 field('approach','Your proposed approach (optional)','textarea',true)+'</div>'+(locked(e)?'<p class="eq-muted">Details are fixed for this payment request. Close an unpaid link below before changing the appointment.</p>':'')+'</section>'+
 '<section class="eq-section"><label class="eq-field">Email subject<input id="eq-subject" value="'+esc(e.drafts.subject||'Your enquiry — Community Care Physio')+'"></label></section>'+
 messageCard('intro','2. Introduction · email or WhatsApp')+
 '<section class="eq-section"><h3>3. Agree the first appointment</h3><p class="eq-muted">Initial assessment · 60 minutes. Enter the date and time agreed with the patient. A payment request reserves the visit and travel time until the link expires.</p><div class="eq-grid">'+field('date','Agreed date (UK)','date')+field('time','Agreed time (UK)','time')+field('amount','Agreed fee (£, whole pounds)','number')+
 '</div><div class="eq-actions"><button class="eq-btn primary" data-action="checkout">'+(e.payment_state==='creating'?'Recover payment link':'Create payment link')+'</button><button class="eq-btn" data-action="refresh">Check payment status</button>'+
 (['creating','open','processing'].includes(e.payment_state)?'<button class="eq-btn" data-action="cancel">Close unpaid link / rearrange</button>':'')+'</div><div class="eq-status">'+esc(label(e))+'</div>'+
 (e.payment_url?'<p class="eq-link">'+esc(e.payment_url)+'</p>':'')+
 (e.expires_at&&e.payment_state==='open'?'<p class="eq-muted">Link expires '+esc(new Date(e.expires_at).toLocaleString('en-GB',{timeZone:'Europe/London'}))+' (UK time).</p>':'')+'</section>'+
 messageCard('payment','4. Appointment and payment follow-up')+
 (e.payment_state==='paid'?messageCard('confirmation','5. Payment received · confirmation')+'<button class="eq-btn primary" data-action="patients">View confirmed patients</button>':'')+
 '<section class="eq-section"><h3>Conversation history</h3><p class="eq-muted">Sent times are recorded by you. Opening Gmail or WhatsApp does not confirm delivery.</p><ul class="eq-history">'+(e.communications?.length?e.communications.map(c=>'<li>'+esc(c.kind)+' · '+esc(c.channel)+' · '+esc(new Date(c.sent_at).toLocaleString('en-GB'))+'<details><summary>Message</summary><div style="white-space:pre-wrap">'+esc(c.body)+'</div></details></li>').join(''):'<li>No messages recorded as sent yet.</li>')+'</ul></section>'+
 '<div class="eq-savebar"><button id="eqSave" class="eq-btn primary" data-action="save">Save enquiry and drafts</button><span id="eqSaveHint" class="eq-muted">'+(e.version?'Saved':'New enquiry — not yet saved')+'</span></div>';
 host.querySelectorAll('input,textarea,select').forEach(el=>el.addEventListener('input',dirty));
}
function renderList(){
 const q=state.query.toLowerCase();
 $('eqList').innerHTML=state.records.filter(e=>[e.details.name,e.details.email,e.details.phone].some(v=>String(v||'').toLowerCase().includes(q))).map(e=>
 '<button data-id="'+esc(e.id)+'" aria-current="'+(state.current?.id===e.id)+'"><strong>'+esc(e.details.name)+'</strong><small>'+esc(label(e))+'</small></button>').join('')||'<p class="eq-muted">No matching enquiries.</p>';
}
function summary(){
 const n=state.records.filter(e=>e.payment_state!=='paid').length;
 if($('eqSummary'))$('eqSummary').textContent=n+' patient enquir'+(n===1?'y':'ies')+' in progress';
}
async function load(){
 if(!sessionStorage.getItem('ccp_admin_token'))return;
 try{
  const data=await api('list');state.records=data.enquiries;renderList();summary();
  if(state.current&&!state.dirty&&!state.busy){const e=state.records.find(e=>e.id===state.current.id);if(e)updateRecord(e);}
  status('Enquiries loaded.');
 }catch(e){status(e.message,true);}
}
function newEnquiry(){
 if(state.dirty&&!confirm('Discard the unsaved changes?'))return;
 state.current={id:crypto.randomUUID(),version:0,payment_state:'none',details:Object.fromEntries(detailFields.map(k=>[k,k==='channel'?'email':k==='amount'?'100':''])),drafts:{subject:'Your enquiry — Community Care Physio'},communications:[]};
 state.dirty=true;renderEditor();renderList();status('Enter the patient details and save them as a query patient.');
}
function openMessage(k){
 if(state.dirty||!state.current.version){status('Save the enquiry and draft before opening it.',true);return;}
 const e=state.current,d=e.details,body=e.drafts[k];
 if(!body){status('Generate and save this message first.',true);return;}
 if(k==='payment'&&(e.payment_state!=='open'||!body.includes(e.payment_url)||new Date(e.expires_at)<=new Date())){status('Create an active payment link and include it in the saved draft.',true);return;}
 if(k==='confirmation'&&e.payment_state!=='paid'){status('Payment has not been confirmed.',true);return;}
 let url;
 if(d.channel==='whatsapp'){
  const phone=normalisePhone(d.phone);if(!phone){status('Enter and save a valid mobile number first.',true);return;}
  url='https://wa.me/'+phone+'?text='+encodeURIComponent(body);
 }else{
  if(!d.email){status('Enter and save an email address first.',true);return;}
  url='https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(d.email)+'&su='+encodeURIComponent(e.drafts.subject)+'&body='+encodeURIComponent(body);
 }
 window.open(url,'_blank','noopener,noreferrer');status('Draft opened. After sending it, choose “I have sent this message”.');
}
$('eqPanel').addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button||state.busy)return;
 if(button.dataset.id){
  if(state.dirty&&!confirm('Discard the unsaved changes?'))return;
  updateRecord(state.records.find(e=>e.id===button.dataset.id));return;
 }
 const action=button.dataset.action,k=button.dataset.kind;
 if(action==='new'){newEnquiry();return;}
 if(action==='reload'){if(!state.dirty||confirm('Discard unsaved changes and reload?')){state.dirty=false;load();}return;}
 if(!state.current)return;
 if(action==='generate'){
  if($('eq-'+k).value&&!confirm('Replace this draft with a newly generated message?'))return;
  const e=readForm();$('eq-'+k).value=template(k,e);dirty();return;
 }
 if(action==='open'){openMessage(k);return;}
 if(action==='patients'){window.adminNav('patients');return;}
 run(async()=>{
  if(action==='save'){await save();return;}
  if(state.dirty)await save();
  let e=state.current;
  if(action==='sent'){
   updateRecord((await api('sent',{id:e.id,version:e.version,kind:k,channel:e.details.channel})).enquiry);
   status('Message recorded as sent.');
  }else if(action==='checkout'){
   if(!sent(e,'intro'))throw new Error('Send the introduction and record it as sent before arranging payment.');
   const result=await api('checkout',{id:e.id,version:e.version});updateRecord(result.enquiry);
   if(state.current.payment_state==='open' && (e.payment_url!==state.current.payment_url || !state.current.drafts.payment)){
    $('eq-payment').value=template('payment',state.current);dirty();await save();
    status('Payment link created and follow-up saved. Review the draft below.');
   }else if(state.current.payment_state==='open')status('Existing payment link is ready. Your edited follow-up has been kept.');
  }else if(action==='refresh'){
   updateRecord((await api('refresh',{id:e.id})).enquiry);
   if(state.current.payment_state==='paid')await window.syncFromSupabase();
   status(label(state.current));
  }else if(action==='cancel'){
   if(!confirm('Close this unpaid payment link and release its reserved appointment?'))return;
   updateRecord((await api('cancel',{id:e.id})).enquiry);status(label(state.current));
  }
 });
});
$('eqSearch').addEventListener('input',event=>{state.query=event.target.value;renderList();});
window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
window.CCPEnquiries={
 show(){load();},
 hasUnsaved(){return state.dirty;},
 clear(){state.generation++;state.records=[];state.current=null;state.dirty=false;renderEditor();renderList();},
 refreshSummary:load
};
renderEditor();
const checkoutNotice=new URLSearchParams(window.location.search).get('enquiry');
if(checkoutNotice==='received'||checkoutNotice==='cancelled'){
 const notice=document.createElement('div');
 notice.className='eq-status';notice.setAttribute('role','status');
 notice.textContent=checkoutNotice==='received'
  ? 'Thank you. Your payment is being checked and Community Care Physio will confirm your appointment. Please contact us if you have any questions.'
  : 'Your payment was not completed on this visit. You can return to your payment link, or contact Community Care Physio to discuss your appointment.';
 document.body.prepend(notice);
}
setInterval(()=>{
 if(document.visibilityState==='visible' && document.getElementById('adminOverlay')?.classList.contains('active') &&
  state.current && !state.dirty && !state.busy && ['open','processing'].includes(state.current.payment_state)){
  run(async()=>{
   const previous=state.current.payment_state;
   updateRecord((await api('refresh',{id:state.current.id})).enquiry);
   if(previous!=='paid'&&state.current.payment_state==='paid'){await window.syncFromSupabase();status('Payment received. The patient is now in your dashboard and patient list.');}
  });
 }
},30000);

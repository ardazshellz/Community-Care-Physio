// Admin panel. Loaded only when the site opens with #admin, together with
// assets/admin-panel.html and assets/admin.css (see loadAdminAssets in index.html).
// ── ADMIN AUTH ──
// Password now lives ONLY server-side (process.env.ADMIN_PASSWORD in /api/admin-login.js).
// Nothing secret is shipped in this file anymore.
let adminSessionToken = null;
let adminTokenExpiry = 0;

async function doAdminLogin(){
  const pw=document.getElementById('adminPwInput').value;
  const btn=document.querySelector('.alogin-btn');
  if(btn){btn.textContent='Checking...';btn.disabled=true;}
  try{
    const res=await fetch('/api/admin-login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password:pw})
    });
    const data=await res.json();
    if(res.ok && data.token){
      adminSessionToken=data.token;
      adminTokenExpiry=data.expiresAt;
      sessionStorage.setItem('ccp_admin_token',data.token);
      sessionStorage.setItem('ccp_admin_expiry',String(data.expiresAt));
      document.getElementById('adminLoginWrap').style.display='none';
      document.getElementById('adminContent').style.display='block';
      initAdmin();
    } else {
      // 5 wrong passwords locks sign-in for 15 minutes (server-side).
      const err=document.getElementById('adminLoginErr');
      err.textContent=res.status===429?(data.error||'Too many attempts. Please wait 15 minutes and try again.')
        :'Incorrect password.'+(typeof data.attemptsLeft==='number'?` ${data.attemptsLeft} attempt${data.attemptsLeft===1?'':'s'} left.`:' Try again.');
      err.style.display='block';
    }
  }catch(e){
    const err=document.getElementById('adminLoginErr');
    err.textContent='Could not reach the server. Check your connection and try again.';
    err.style.display='block';
  }
  if(btn){btn.textContent='Sign in →';btn.disabled=false;}
}

function doAdminLogout(){
  window.CCPEnquiries?.clear();window.CCPPractice?.clear();
  sessionStorage.removeItem('ccp_admin_token');
  sessionStorage.removeItem('ccp_admin_expiry');
  adminSessionToken=null;
  adminTokenExpiry=0;
  document.getElementById('adminOverlay').classList.remove('active');
  document.body.classList.remove('admin-active');
  history.pushState('',document.title,window.location.pathname);
}

function openAdmin(){
  document.getElementById('adminOverlay').classList.add('active');
  document.body.classList.add('admin-active');
  const savedToken=sessionStorage.getItem('ccp_admin_token');
  const savedExpiry=Number(sessionStorage.getItem('ccp_admin_expiry')||0);
  if(savedToken && savedExpiry>Date.now()){
    adminSessionToken=savedToken;
    adminTokenExpiry=savedExpiry;
    document.getElementById('adminLoginWrap').style.display='none';
    document.getElementById('adminContent').style.display='block';
    initAdmin();
  } else {
    sessionStorage.removeItem('ccp_admin_token');
    sessionStorage.removeItem('ccp_admin_expiry');
    document.getElementById('adminLoginWrap').style.display='flex';
    document.getElementById('adminContent').style.display='none';
  }
}

// Restore an admin session only after all booking state and modules initialise.

// ── ADMIN BOOKINGS ──
// ── ADMIN CONFIRMATIONS ──
// Every admin action that saves, sends or charges through /api shows a short
// confirmation (or error) bar, so it is always clear the click was processed.
const ADMIN_ACTION_LABELS={
  'save-rota':'Availability published','blocks':'Slots updated',
  confirm:'Booking confirmed',create:'Booking added',markPaid:'Payment status updated',saveSessions:'Appointments saved',
  delete:'Removed',purge:'Removed',
  save:'Saved','invoice-create':'Invoice created','invoice-save':'Invoice saved','intake-create':'Intake link created','charge-fee':'Fee charged',
  custom:'Email sent from infoccphysio',dna:'Missed-appointment notice sent',review:'Review email sent',
  sent:'Recorded as sent',checkout:'Payment link created',cancel:'Payment link closed'
};
const ADMIN_READ_ONLY=new Set(['list','get','refresh','intake-get']);
function adminToast(message,ok=true){
  let el=document.getElementById('adminToast');
  if(!el){
    el=document.createElement('div');el.id='adminToast';el.setAttribute('role','status');el.setAttribute('aria-live','polite');
    el.style.cssText='position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:100000;padding:12px 18px;border-radius:12px;font:500 14px Outfit,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.18);max-width:min(92vw,520px);text-align:center;transition:opacity .2s';
    document.body.appendChild(el);
  }
  el.textContent=(ok?'✓ ':'✗ ')+message;
  el.style.background=ok?'#1e4d3b':'#b42318';el.style.color='#fff';el.style.opacity='1';
  clearTimeout(el._t);el._t=setTimeout(()=>{el.style.opacity='0';},ok?3000:6000);
}
(function(){
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'';
    let body=null;
    try{ body=init&&typeof init.body==='string'?JSON.parse(init.body):null; }catch(e){}
    const isAdminWrite=/^\/api\//.test(url)&&!/admin-login|get-slots/.test(url)&&init&&String(init.method).toUpperCase()==='POST'&&body&&body.token&&typeof adminSessionToken!=='undefined'&&adminSessionToken;
    const key=body&&(body.action==='enquiries'?body.operation:(body.emailType||body.action));
    const label=isAdminWrite&&key&&!ADMIN_READ_ONLY.has(key)?(ADMIN_ACTION_LABELS[key]||'Done'):(isAdminWrite&&/send-reminders/.test(url)?'Reminder sent':null);
    try{
      const res=await nativeFetch(input,init);
      if(label){
        if(res.ok) adminToast(label);
        else res.clone().json().catch(()=>({})).then(d=>adminToast((d&&d.error)||('Not saved (error '+res.status+')'),false));
      }
      return res;
    }catch(err){
      if(label) adminToast('Not saved — check your connection and try again',false);
      throw err;
    }
  };
})();

let adminBookings=[];

// The public rota fetch may have created a bare object before this script loads.
window.CCP_ADMIN_STATE = Object.assign({
  services: { supabase:'unknown', stripe:'unknown', google:'unknown' },
  rota: { status:'checking', updatedAt:null, days:null }
}, window.CCP_ADMIN_STATE || {});

function aDateKey(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
// aMoney is defined with the finance helpers below (the later declaration always won).
function aFormatDateTime(v){
  if(!v) return '—';
  const d=new Date(v);
  if(Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function aActiveSessionStatus(status){
  return ['scheduled','confirmed','pending','paid','prepaid','rescheduled'].includes(status);
}
const NEW_PATIENT_WINDOW_MS = 7*24*60*60*1000;
function aBookingMomentMs(b){
  if(!b) return NaN;
  const candidates=[b.createdAt,b.timestamp,b.bookedDate?(b.bookedDate+'T'+((b.bookedTime&&/^\d{1,2}:\d{2}/.test(b.bookedTime))?b.bookedTime.slice(0,5):'12:00')+':00'):null];
  for(const value of candidates){
    if(!value) continue;
    const n=new Date(value).getTime();
    if(Number.isFinite(n)) return n;
  }
  return NaN;
}
function aInitialAssessmentHasOccurred(records){
  const now=Date.now();
  return records.some(b=>{
    if(!b) return false;
    const status=String(b.status||'').toLowerCase();
    if(['cancelled','expired','dna'].includes(status)) return false;
    const appt=String(b.appointment||'');
    const includesInitial=/initial assessment/i.test(appt)||['Starter Programme','Full Programme'].includes(appt);
    if(!includesInitial) return false;
    if(status==='completed') return true;
    if(b.bookedDate){
      const time=(b.bookedTime&&/^\d{1,2}:\d{2}/.test(b.bookedTime))?b.bookedTime.slice(0,5):'23:59';
      const when=new Date(b.bookedDate+'T'+time+':00').getTime();
      if(Number.isFinite(when)&&when<now) return true;
    }
    if(typeof aIsPackage==='function'&&aIsPackage(b)&&typeof aPkgSessions==='function'){
      const sessions=aPkgSessions(b);
      if(sessions.some((s,i)=>i===0&&s&&s.status==='completed')) return true;
    }
    return false;
  });
}
function aGetNewPatientKeys(bookings){
  const groups=new Map();
  (Array.isArray(bookings)?bookings:[]).forEach(b=>{
    if(!b||b.patientType!=='new') return;
    const key=patientKey(b);
    if(!key) return;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(b);
  });
  const allByKey=new Map();
  (Array.isArray(bookings)?bookings:[]).forEach(b=>{
    const key=patientKey(b); if(!key) return;
    if(!allByKey.has(key)) allByKey.set(key,[]);
    allByKey.get(key).push(b);
  });
  const now=Date.now();
  const out=new Set();
  groups.forEach((newRecords,key)=>{
    const times=newRecords.map(aBookingMomentMs).filter(Number.isFinite);
    const firstSeen=times.length?Math.min(...times):NaN;
    const withinSevenDays=Number.isFinite(firstSeen)&&(now-firstSeen)<NEW_PATIENT_WINDOW_MS;
    const initialDone=aInitialAssessmentHasOccurred(allByKey.get(key)||newRecords);
    if(withinSevenDays&&!initialDone) out.add(key);
  });
  return out;
}
function aIsPatientNew(b){
  if(!b) return false;
  return aGetNewPatientKeys(adminBookings).has(patientKey(b));
}

function getAdminOperationalMetrics(){
  const bookings=Array.isArray(adminBookings)?adminBookings:[];
  const today=new Date(); today.setHours(0,0,0,0);
  const todayStr=aDateKey(today);
  const end7=new Date(today); end7.setDate(end7.getDate()+7);
  const end7Str=aDateKey(end7);
  const appts=[];
  let outstandingCount=0, outstandingTotal=0, sessionsToBook=0, activeProgrammeCount=0;
  const activePatientKeys=new Set();
  const activeProgrammeKeys=new Set();

  bookings.forEach(b=>{
    if(!b||b.activeOnly) return;
    const bStatus=String(b.status||'').toLowerCase();
    const inactive=['cancelled','expired'].includes(bStatus);
    const clinicallyClosed=['completed','dna'].includes(bStatus);
    const isPkg=typeof aIsPackage==='function'&&aIsPackage(b);
    const key=patientKey(b);

    if(b.paid===false&&!inactive&&!(isPkg&&typeof aPkgIsArchived==='function'&&aPkgIsArchived(b))){
      outstandingCount++;
      outstandingTotal+=Number(b.price)||0;
    }

    if(isPkg){
      const archived=typeof aPkgIsArchived==='function'&&aPkgIsArchived(b);
      if(!archived&&!inactive){
        activeProgrammeCount++;
        if(key){activePatientKeys.add(key);activeProgrammeKeys.add(key);}
      }
      const sessions=typeof aPkgSessions==='function'?aPkgSessions(b):[];
      sessions.forEach(s=>{
        if(!s) return;
        const st=String(s.status||'').toLowerCase();
        if((!s.date||st==='unscheduled')&&!['cancelled','completed','dna'].includes(st)) sessionsToBook++;
        if(s.date&&s.time&&aActiveSessionStatus(st)){
          appts.push({date:s.date,time:s.time,name:b.name,label:s.label||'Follow-up',patientKey:key});
        }
      });
    }else{
      if(!inactive&&!clinicallyClosed&&key) activePatientKeys.add(key);
      if(b.bookedDate&&b.bookedTime&&!['cancelled','expired','completed','dna','rescheduled'].includes(bStatus)){
        appts.push({date:b.bookedDate,time:b.bookedTime,name:b.name,label:b.appointment||'Appointment',patientKey:key});
      }
    }
  });

  appts.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const todayAppts=appts.filter(a=>a.date===todayStr);
  const next7=appts.filter(a=>a.date>=todayStr&&a.date<=end7Str);
  const nextToday=todayAppts[0]||null;
  const next7PatientKeys=new Set(next7.map(a=>a.patientKey).filter(Boolean));
  const newPatientKeys=aGetNewPatientKeys(bookings);
  return {
    todayStr,todayAppts,nextToday,next7,
    outstandingCount,outstandingTotal,sessionsToBook,
    activeProgrammes:activeProgrammeCount,activePatients:activePatientKeys.size,
    newPatients:newPatientKeys.size,totalBookings:bookings.filter(b=>b&&!b.activeOnly).length,
    activePatientKeys,activeProgrammeKeys,next7PatientKeys,newPatientKeys
  };
}
function aSetSyncButtons(label,disabled){
  document.querySelectorAll('.js-sync-bookings').forEach(btn=>{
    btn.textContent=label;
    btn.disabled=!!disabled;
  });
}
function aSaveSyncMeta(meta){
  try{ localStorage.setItem('ccp_last_booking_sync',JSON.stringify(meta)); }catch(e){}
}
function aReadSyncMeta(){
  try{return JSON.parse(localStorage.getItem('ccp_last_booking_sync')||'null');}catch(e){return null;}
}
function setServiceBadge(id,status,label){
  const el=document.getElementById(id); if(!el) return;
  el.className='service-status '+(status==='good'?'good':status==='warn'?'warn':status==='bad'?'bad':'');
  el.textContent=label;
}
function renderSettings(){
  const sync=aReadSyncMeta();
  const syncStatus=document.getElementById('setSyncStatus');
  const lastSync=document.getElementById('setLastSync');
  const records=document.getElementById('setSyncRecords');
  if(syncStatus) syncStatus.textContent=sync ? (sync.ok?'Successful':'Last attempt failed') : 'Not synced in this browser';
  if(lastSync) lastSync.textContent=sync&&sync.ok?aFormatDateTime(sync.at):'—';
  if(records) records.textContent=sync&&sync.ok?String(sync.count):'—';

  const rota=window.CCP_ADMIN_STATE.rota||{};
  const rs=document.getElementById('setRotaStatus');
  const rp=document.getElementById('setRotaPublished');
  const rd=document.getElementById('setRotaDays');
  if(rs) rs.textContent=rota.status==='published'?'Published':rota.status==='unavailable'?'Status unavailable':'Checking…';
  if(rp) rp.textContent=rota.updatedAt?aFormatDateTime(rota.updatedAt):'—';
  if(rd) rd.textContent=Number.isFinite(rota.days)?String(rota.days):'—';

  const svc=window.CCP_ADMIN_STATE.services||{};
  setServiceBadge('svcSupabase',svc.supabase==='connected'?'good':svc.supabase==='error'?'bad':'neutral',
    svc.supabase==='connected'?'Connected':svc.supabase==='error'?'Connection error':'Status unavailable');
  setServiceBadge('svcStripe',svc.stripe==='configured'?'good':svc.stripe==='missing'?'warn':'neutral',
    svc.stripe==='configured'?'Configured':svc.stripe==='missing'?'Not configured':'Status unavailable');
  setServiceBadge('svcGoogle',svc.google==='configured'?'good':svc.google==='missing'?'warn':'neutral',
    svc.google==='configured'?'Configured':svc.google==='missing'?'Not configured':'Status unavailable');
}
async function loadAdminAvailabilityStatus(){
  try{
    const res=await fetch('/api/availability');
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json();
    const rota=data&&data.rota&&typeof data.rota==='object'?data.rota:null;
    window.CCP_ADMIN_STATE.rota={
      status:rota?'published':'unavailable',
      updatedAt:data.updatedAt||null,
      days:Number.isFinite(data.days)?data.days:(rota?Object.keys(rota).length:0)
    };
  }catch(e){
    window.CCP_ADMIN_STATE.rota={status:'unavailable',updatedAt:null,days:null};
  }
  renderSettings();
}
const adminOpenPatientCards=new Set();
function togglePatientCard(btn){
  const card=btn&&btn.closest?btn.closest('.patient-card'):null;
  if(!card) return;
  const nowCollapsed=card.classList.toggle('is-collapsed');
  const bookingId=card.getAttribute('data-booking-id')||'';
  if(bookingId){
    if(nowCollapsed) adminOpenPatientCards.delete(bookingId);
    else adminOpenPatientCards.add(bookingId);
  }
  btn.setAttribute('aria-expanded',String(!nowCollapsed));
  btn.textContent=nowCollapsed?'View details':'Hide details';
}
function restoreOpenPatientCards(){
  document.querySelectorAll('.patient-card[data-booking-id]').forEach(card=>{
    const bookingId=card.getAttribute('data-booking-id')||'';
    if(!bookingId || !adminOpenPatientCards.has(bookingId)) return;
    card.classList.remove('is-collapsed');
    const btn=card.querySelector('.patient-card-toggle');
    if(btn){btn.setAttribute('aria-expanded','true');btn.textContent='Hide details';}
  });
}


// Combined patient/package cards shown in Active Patients ONLY (activeOnly:true keeps
// them out of the All-clients/Excel export, which stays as your real Supabase records).
// Michael: Initial Assessment done separately (previous), then a Package of 4 follow-ups.
// No hardcoded patients. Packages are detected from real Supabase bookings.
const MANUAL_BOOKINGS = [];

// Which bookings are packages, and how many sessions they include.
const PACKAGE_SIZES = {
  'Block of 4 Sessions': 4,
  'Block of 6 Sessions': 6,
  'Starter Programme': 4,
  'Full Programme': 6
};
function aPkgSize(b){
  if(!b) return 0;
  if(PACKAGE_SIZES[b.appointment]) return PACKAGE_SIZES[b.appointment];
  const m=String(b.appointment||'').match(/(\d+)\s*(?:sessions?|follow)/i);
  if(m) return parseInt(m[1],10);
  if(Array.isArray(b.customSessions) && b.customSessions.length>1) return b.customSessions.length;
  return 0;
}

let adminSyncInFlight=false;
async function syncFromSupabase(){
  if(adminSyncInFlight || !adminSessionToken)return;
  adminSyncInFlight=true;
  const requestToken=adminSessionToken;
  const dbg=document.getElementById('aDebug');
  aSetSyncButtons('↻ Syncing…',true);
  try{
    const res=await fetch('/api/get-bookings?fresh='+Date.now(),{
      method:'POST',
      cache:'no-store',
      headers:{'Content-Type':'application/json','Cache-Control':'no-cache'},
      body:JSON.stringify({token:adminSessionToken})
    });
    if(requestToken!==adminSessionToken)return;
    if(!res.ok){
      let err={}; try{err=await res.json();}catch(_){}
      window.CCP_ADMIN_STATE.services.supabase='error';
      aSaveSyncMeta({ok:false,at:new Date().toISOString(),error:err.error||('HTTP '+res.status)});
      if(res.status===401){
        sessionStorage.removeItem('ccp_admin_token');
        sessionStorage.removeItem('ccp_admin_expiry');
        adminSessionToken=null;
        window.CCPEnquiries?.clear();window.CCPPractice?.clear();
        const lw=document.getElementById('adminLoginWrap'),ac=document.getElementById('adminContent');
        if(lw) lw.style.display='flex';
        if(ac) ac.style.display='none';
        if(dbg) dbg.innerHTML='<span style="color:#b45309">Session expired — please sign in again to reload your bookings.</span>';
      }else if(dbg){
        dbg.innerHTML='<span style="color:#dc2626">Could not load bookings: '+aEsc(err.error||('HTTP '+res.status))+'</span>';
      }
      renderSettings();
      return;
    }

    const data=await res.json();
    if(requestToken!==adminSessionToken)return;
    window.CCPEnquiries?.refreshSummary();
    setTimeout(()=>window.CCPPractice?.load(true),0);
    const serverBookings=Array.isArray(data.bookings)?data.bookings:[];
    adminBookings=[...serverBookings,...MANUAL_BOOKINGS];
    serverBookings.forEach(b=>{
      if(aIsServerBooking(b.id) && Array.isArray(b.customSessions) && b.customSessions.length){
        try{ localStorage.removeItem('ccp_pkg_'+b.id); }catch(e){}
      }
    });
    if(data.bookedSlots) BOOKED_SLOTS=data.bookedSlots;
    migratePackageArchiveState();

    window.CCP_ADMIN_STATE.services.supabase='connected';
    if(data.services){
      window.CCP_ADMIN_STATE.services.stripe=data.services.stripeConfigured?'configured':'missing';
      window.CCP_ADMIN_STATE.services.google=data.services.googleCalendarConfigured?'configured':'missing';
    }
    aSaveSyncMeta({ok:true,at:new Date().toISOString(),count:serverBookings.length});

    const renderErr=[];
    try{updateAdminStats();}catch(e){renderErr.push('stats: '+e.message);}
    try{renderClientList();}catch(e){renderErr.push('history: '+e.message);}
    try{renderAdminBookings();}catch(e){renderErr.push('active: '+e.message);}
    try{renderAdminRota();}catch(e){renderErr.push('rota: '+e.message);}
    try{rebuildCalendarFromPackages();}catch(e){}
    try{renderSettings();}catch(e){}
    if(dbg){
      dbg.innerHTML='Bookings loaded from Supabase: <strong>'+serverBookings.length+'</strong> · shown in view: <strong>'+adminBookings.length+'</strong>'
        +(serverBookings.length===0?' — API returned none (Supabase query returned 0 rows).':'')
        +(renderErr.length?'<br><span style="color:#dc2626">Render issue → '+renderErr.map(aEsc).join('; ')+'</span>':'');
    }
  }catch(e){
    window.CCP_ADMIN_STATE.services.supabase='error';
    aSaveSyncMeta({ok:false,at:new Date().toISOString(),error:e.message||'network'});
    if(dbg) dbg.innerHTML='<span style="color:#dc2626">Could not reach the server ('+aEsc(e.message||'network')+'). Your existing data is not deleted.</span>';
    renderSettings();
  }finally{
    adminSyncInFlight=false;
    aSetSyncButtons('↻ Sync bookings',false);
  }
}

// Push every currently-scheduled package appointment to the public block list
// (idempotent upsert), so manually-scheduled follow-ups reserve their slot for
// everyone — not just this browser. Runs after bookings load.
function syncPackageBlocks(){
  const block=[];
  adminBookings.filter(b=>aIsPackage(b)).forEach(b=>{
    aPkgSessions(b).forEach(s=>{
      if(s.date && s.time && ['scheduled','confirmed','pending','paid','prepaid','completed','rescheduled'].includes(s.status)){
        block.push({ date:s.date, time:s.time });
      }
    });
  });
  if(block.length) apiBlockSlots(block, []);
}

let lastAdminVisibilitySync=0;
function refreshAdminFromServerIfVisible(force=false){
  const overlay=document.getElementById('adminOverlay');
  const loggedIn=overlay&&overlay.classList.contains('active')&&adminSessionToken;
  const now=Date.now();
  if(!loggedIn || (!force&&now-lastAdminVisibilitySync<15000)) return;
  lastAdminVisibilitySync=now;
  syncFromSupabase();
}
window.addEventListener('pageshow',e=>{
  if(e.persisted) refreshAdminFromServerIfVisible(true);
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible') refreshAdminFromServerIfVisible(false);
});
// A payment webhook can confirm any enquiry while the clinician stays on the
// homepage. Refresh the dashboard even when no individual enquiry is selected.
setInterval(()=>{
  if(document.visibilityState==='visible' && ['dashboard','patients'].includes(ADMIN_SEC)){
    refreshAdminFromServerIfVisible(false);
  }
},30000);

function initAdmin(){
  adminBookings=[...MANUAL_BOOKINGS];
  renderAdminBookings();
  renderAdminRota();
  updateAdminStats();
  document.getElementById('aAddDateInput').min=new Date().toISOString().split('T')[0];
  cbInitCal();
  cbRenderSessions();
  cbRecalc();
  renderSettings();
  loadAdminAvailabilityStatus();
  adminNav('dashboard');   // open on the Dashboard view
  // Auto-load bookings from Supabase
  syncFromSupabase();
}

// ── DASHBOARD NAVIGATION ──
// Shows only the panels tagged with the chosen section. Every panel, ID and
// function is unchanged — this just filters which section is visible.
let ADMIN_SEC='dashboard';
function toggleAdminMobileNav(){
  const nav=document.getElementById('adminNav');
  const btn=nav&&nav.querySelector('.admin-mobile-nav-toggle');
  if(!nav||!btn) return;
  const open=nav.classList.toggle('open');
  btn.setAttribute('aria-expanded',open?'true':'false');
}
function adminNav(sec){
  if(ADMIN_SEC==='enquiries' && sec!=='enquiries' && window.CCPEnquiries?.hasUnsaved?.() && !confirm('Leave the enquiry with unsaved changes? Your draft will remain here.')) return;
  ADMIN_SEC=sec;
  if(sec==='enquiries')window.CCPEnquiries?.show();
  if(sec==='referrals')window.CCPPractice?.render();
  document.querySelectorAll('#adminContent [data-asec]').forEach(el=>{
    el.style.display=(el.getAttribute('data-asec')===sec)?'':'none';
  });
  let activeButton=null;
  document.querySelectorAll('.admin-nav-item').forEach(el=>{
    const active=el.getAttribute('data-nav')===sec;
    el.classList.toggle('active',active);
    if(active) activeButton=el;
  });
  const nav=document.getElementById('adminNav');
  const mobileBtn=nav&&nav.querySelector('.admin-mobile-nav-toggle');
  const mobileLabel=document.getElementById('adminMobileNavLabel');
  if(activeButton&&mobileLabel) mobileLabel.innerHTML=activeButton.innerHTML;
  if(nav) nav.classList.remove('open');
  if(mobileBtn) mobileBtn.setAttribute('aria-expanded','false');
  if(sec==='dashboard'){try{renderDashboard();}catch(e){}}
  if(sec==='patients'){try{applyPatientHighlights();}catch(e){}}
  if(sec==='settings'){try{renderSettings();loadAdminAvailabilityStatus();}catch(e){}}
  try{window.scrollTo(0,0);}catch(e){}
}

// ── DASHBOARD OVERVIEW (read-only, computed from existing data) ──
let adminPatientHighlightMode=null;
const DASHBOARD_HIGHLIGHT_LABELS={
  activePatients:['active patient','active patients'],
  activeProgrammes:['active programme patient','active programme patients'],
  next7:['patient with an appointment in the next 7 days','patients with appointments in the next 7 days'],
  newPatients:['new patient','new patients']
};
function aDashboardHighlightKeys(mode){
  const m=getAdminOperationalMetrics();
  if(mode==='activePatients') return m.activePatientKeys;
  if(mode==='activeProgrammes') return m.activeProgrammeKeys;
  if(mode==='next7') return m.next7PatientKeys;
  if(mode==='newPatients') return m.newPatientKeys;
  return new Set();
}
function dashboardShowPatients(mode){
  adminPatientHighlightMode=mode;
  adminNav('patients');
  renderAdminBookings();
  setTimeout(()=>{
    const target=document.getElementById('aPatientHighlightNotice')||document.getElementById('aBookingsList');
    if(target) target.scrollIntoView({behavior:'smooth',block:'start'});
  },50);
}
function clearPatientHighlight(){
  adminPatientHighlightMode=null;
  applyPatientHighlights();
}
function applyPatientHighlights(){
  const notice=document.getElementById('aPatientHighlightNotice');
  const cards=[...document.querySelectorAll('#aBookingsList .patient-card')];
  cards.forEach(card=>card.classList.remove('dashboard-highlight'));
  if(!adminPatientHighlightMode){
    if(notice){notice.className='patient-highlight-notice';notice.innerHTML='';}
    return;
  }
  const keys=aDashboardHighlightKeys(adminPatientHighlightMode);
  let matchedCards=0;
  cards.forEach(card=>{
    const key=card.getAttribute('data-patient-key')||'';
    if(keys.has(key)){card.classList.add('dashboard-highlight');matchedCards++;}
  });
  const labels=DASHBOARD_HIGHLIGHT_LABELS[adminPatientHighlightMode]||['matching patient','matching patients'];
  const patientCount=keys.size;
  const label=patientCount===1?labels[0]:labels[1];
  if(notice){
    notice.className='patient-highlight-notice show';
    notice.innerHTML=`<span><strong>Highlighted:</strong> ${patientCount} ${label}${matchedCards<patientCount?' · some may be archived or outside the active list':''}</span><button class="patient-highlight-clear" onclick="clearPatientHighlight()">Clear highlight</button>`;
  }
}
function renderDashboard(){
  const el=document.getElementById('aDashboard'); if(!el) return;
  const m=getAdminOperationalMetrics();
  const bookings=Array.isArray(adminBookings)?adminBookings:[];
  const recent=[...bookings].filter(b=>b&&b.createdAt&&!b.activeOnly).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5);
  const box=(v,l,cls,mode)=>mode
    ?`<button type="button" class="dash-box is-clickable ${cls||''}" onclick="dashboardShowPatients('${mode}')" title="Show and highlight the matching patients"><div class="dv">${v}</div><div class="dl">${l}</div></button>`
    :`<div class="dash-box ${cls||''}"><div class="dv">${v}</div><div class="dl">${l}</div></div>`;
  let html=`<div class="dash-grid">
    ${box(m.activePatients,'Active patients','','activePatients')}
    ${box(m.activeProgrammes,'Active programmes','','activeProgrammes')}
    ${box(m.next7PatientKeys.size,'Next 7 days','','next7')}
    ${box(m.newPatients,'New patients','','newPatients')}
    ${box(m.totalBookings,'Total bookings')}
  </div>`;
  html+=`<div class="dash-sub" style="font-weight:600;color:var(--char);font-size:13px;margin-top:6px">Today's appointments</div>`;
  html+=m.todayAppts.length
    ?m.todayAppts.map(a=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid rgba(30,77,59,.06);font-size:13px"><span>${fmt12(a.time)} · ${aEsc(a.name||'')}</span><span style="color:var(--muted)">${aEsc(a.label)}</span></div>`).join('')
    :`<div class="dash-sub">No appointments scheduled for today.</div>`;
  html+=`<div class="dash-sub" style="font-weight:600;color:var(--char);font-size:13px;margin-top:16px">Recent booking activity</div>`;
  html+=recent.length
    ?recent.map(b=>{
      const idx=adminBookings.indexOf(b);
      const date=b.createdAt?new Date(b.createdAt).toLocaleDateString('en-GB'):'';
      return `<div class="recent-activity-row"><span>${aEsc(b.name||'—')} · ${aEsc(b.appointment||'')}</span><span class="recent-date" style="color:var(--muted)">${date}${b.paid===false?' · <span style="color:#c0392b">unpaid</span>':''}</span><button type="button" class="recent-delete-btn" onclick="aPurgeBooking(${idx})" title="Permanently remove this test or refunded record from patients, bookings, finance and Excel exports" aria-label="Permanently remove booking record">×</button></div>`;
    }).join('')
    :`<div class="dash-sub">No recent activity yet.</div>`;
  el.innerHTML=html;
}
function aApptType(name){
  if(!name)return{label:'Unknown',color:'var(--muted)'};
  if(name==='Initial Assessment')return{label:'Initial Assessment',color:'var(--forest)'};
  if(name==='Standard Session'||name==='Extended Session')return{label:name,color:'#0369a1'};
  return{label:'Package',color:'#92400e'};
}

let cbDismissed = JSON.parse(localStorage.getItem('ccp_dismissed')||'[]');
function aDismissBooking(id){
  if(!cbDismissed.includes(id)){ cbDismissed.push(id); localStorage.setItem('ccp_dismissed',JSON.stringify(cbDismissed)); }
  renderAdminBookings();
}

// Derive a clear booking status from the stored flags.
function aStatus(b){
  if(b.status==='cancelled') return {label:'Cancelled', color:'#dc2626', bg:'#fef2f2'};
  if(b.status==='expired')   return {label:'Expired', color:'#b45309', bg:'#fffbeb'};
  if(b.status==='completed') return {label:'Completed', color:'#0369a1', bg:'#e0f2fe'};
  if(b.status==='prepaid')   return {label:'Prepaid / Confirmed', color:'#16a34a', bg:'#f0fdf4'};
  if(b.status==='invoiced')  return {label:'Invoiced / Confirmed', color:'#16a34a', bg:'#f0fdf4'};
  if(b.paid!==false)         return {label:'Paid / Confirmed', color:'#16a34a', bg:'#f0fdf4'};
  return {label:'Pending payment', color:'#b45309', bg:'#fffbeb'};
}
// Hours since a booking was created (from created_at or the timestamp string).
function aHoursSince(b){
  let t = b.created_at ? Date.parse(b.created_at) : (b.timestamp ? Date.parse(b.timestamp) : NaN);
  if(isNaN(t)) return null;
  return (Date.now() - t) / 3600000;
}
// A pending-payment booking older than 48h is flagged overdue (not auto-deleted).
function aIsOverdue(b){
  const s = aStatus(b).label;
  if(s !== 'Pending payment') return false;
  const h = aHoursSince(b);
  return h !== null && h > 48;
}
async function aCompleteBooking(i){
  const b = adminBookings[i]; if(!b) return;
  if(!confirm('Mark this appointment as completed?')) return;
  try{ await fetch('/api/update-booking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:adminSessionToken,action:'complete',bookingId:b.id})}); }catch(e){}
  adminBookings[i].status='completed';
  renderAdminBookings();
}
async function aReleaseBooking(i){
  const b = adminBookings[i]; if(!b) return;
  if(!confirm('Release these appointment slot(s) back into public availability? The booking will be marked Expired but kept in your records.')) return;
  try{ await fetch('/api/update-booking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:adminSessionToken,action:'delete',bookingId:b.id})}); }catch(e){}
  adminBookings[i].status='expired';
  adminBookings[i].confirmed=false;
  await fetchBookedSlots();
  renderAdminBookings();
  updateAdminStats();
}

// ══════════════════════════════════════════════════════════════
// PACKAGE / EPISODE OF CARE
// A package is ONE booking that owns several appointments (sessions).
// Custom bookings already store all their sessions together, so a package
// renders as a single card with a progress bar and per-appointment status.
// Per-appointment status is saved in the browser for now; persisting it and
// blocking every session for the public is the backend step still to come.
// ══════════════════════════════════════════════════════════════
function aIsPackage(b){
  if(!b) return false;
  if(b.isPackage) return true;
  if(Array.isArray(b.sessions) && b.sessions.length) return true;
  if(Array.isArray(b.customSessions) && b.customSessions.length) return true;
  return aPkgSize(b) > 1;
}
function aPkgKey(id){ return 'ccp_pkg_'+id; }
function aPkgLoadStatuses(id){ try{ return JSON.parse(localStorage.getItem(aPkgKey(id))||'null'); }catch(e){ return null; } }
function aPkgSaveStatuses(id, arr){ try{ localStorage.setItem(aPkgKey(id), JSON.stringify(arr)); }catch(e){} }
function aPkgLoadOverrides(id){ try{ return JSON.parse(localStorage.getItem('ccp_pkg_'+id)||'null'); }catch(e){ return null; } }

// The package's appointments BEFORE any local edits are applied.
// Priority: sessions saved on the Supabase booking (custom_sessions) → hardcoded
// sessions → generated placeholders from the package size (session 1 = the booked slot).
function aPkgBaseSessions(b){
  if(Array.isArray(b.sessions) && b.sessions.length) return b.sessions.map(s=>({...s}));
  if(Array.isArray(b.customSessions) && b.customSessions.length){
    return b.customSessions.map((s,i)=>({
      label: s.label || ('Follow-up '+(i+1)),
      date: s.date || null, time: s.time || null,
      length: s.length || 45,
      status: s.status || (s.date ? 'scheduled' : 'unscheduled'),
      reminderOff: !!s.reminderOff, reminderSent: !!s.reminderSent,
      dnaType: s.dnaType || null, dnaFee: Number(s.dnaFee||0), refundDue: Number(s.refundDue||0),
      refundCompleted: !!s.refundCompleted, refundDate: s.refundDate || null,
      dnaNoticeSent: !!s.dnaNoticeSent, dnaNoticeSentAt: s.dnaNoticeSentAt || null
    }));
  }
  const n=aPkgSize(b);
  const out=[];
  for(let i=0;i<n;i++){
    out.push(i===0 && b.bookedDate
      ? { label:'Follow-up 1', date:b.bookedDate, time:(b.bookedTime||null), length:45, status:'scheduled' }
      : { label:'Follow-up '+(i+1), date:null, time:null, length:45, status:'unscheduled' });
  }
  return out;
}
function aPkgSessions(b){
  const base=aPkgBaseSessions(b);
  // A partly populated session list must not silently shrink the purchased package.
  while(base.length<aPkgSize(b))base.push({label:'Follow-up '+(base.length+1),date:null,time:null,length:45,status:'unscheduled'});
  // Supabase is the source of truth for real bookings. Older versions stored
  // session edits only in localStorage, which caused phones and desktops to show
  // different patients/statuses.
  const hasServerSessions=aIsServerBooking(b&&b.id) && Array.isArray(b.customSessions) && b.customSessions.length;
  const ov=hasServerSessions ? null : aPkgLoadOverrides(b.id);
  if(Array.isArray(ov)) base.forEach((s,i)=>{
    const o=ov[i];
    if(o && typeof o==='object'){
      if(o.status) s.status=o.status;
      if('date' in o) s.date=o.date;
      if('time' in o) s.time=o.time;
      if('reminderOff' in o) s.reminderOff=!!o.reminderOff;
      if('reminderSent' in o) s.reminderSent=!!o.reminderSent;
      if('dnaType' in o) s.dnaType=o.dnaType||null;
      if('dnaFee' in o) s.dnaFee=Number(o.dnaFee||0);
      if('refundDue' in o) s.refundDue=Number(o.refundDue||0);
      if('refundCompleted' in o) s.refundCompleted=!!o.refundCompleted;
      if('refundDate' in o) s.refundDate=o.refundDate||null;
      if('dnaNoticeSent' in o) s.dnaNoticeSent=!!o.dnaNoticeSent;
      if('dnaNoticeSentAt' in o) s.dnaNoticeSentAt=o.dnaNoticeSentAt||null;
    } else if(typeof o==='string'){
      s.status=o;   // old format from an earlier version
    }
  });
  return base;
}
// Is this a real Supabase booking (UUID id) we can save sessions onto?
function aIsServerBooking(id){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id||'')); }

// Save a package's appointments locally AND back to Supabase, so statuses and
// scheduled follow-ups persist across devices and feed the 24-hour reminder cron.
function aPkgServerCompletedAt(b){
  if(!b) return null;
  if(b.packageCompletedAt) return b.packageCompletedAt;
  const list=Array.isArray(b.customSessions)?b.customSessions:[];
  const hit=list.find(s=>s&&s.packageCompletedAt);
  return hit&&hit.packageCompletedAt ? hit.packageCompletedAt : null;
}
function aPkgLocalCompletedAt(b){
  if(!b) return null;
  try{
    const raw=localStorage.getItem(aPkgArchiveKey(b.id));
    if(raw==null) return null;
    const n=Number(raw);
    return Number.isFinite(n) ? new Date(n).toISOString() : null;
  }catch(e){ return null; }
}

// Save appointments and package completion metadata to Supabase. Storing the
// completion timestamp inside custom_sessions avoids a database migration while
// ensuring desktop and mobile calculate the same Active/Archived state.
function aPkgSaveOverrides(id, arr, meta={}){
  try{ localStorage.setItem('ccp_pkg_'+id, JSON.stringify(arr)); }catch(e){}
  try{
    const b=adminBookings.find(x=>x.id===id);
    if(!b || !aIsServerBooking(id)) return Promise.resolve();
    const base=aPkgSessions(b);
    const hasCompletedMeta=Object.prototype.hasOwnProperty.call(meta,'packageCompletedAt');
    let completedAt=hasCompletedMeta ? meta.packageCompletedAt : (aPkgServerCompletedAt(b)||aPkgLocalCompletedAt(b));
    let packageStatus=Object.prototype.hasOwnProperty.call(meta,'packageStatus') ? meta.packageStatus : (b.status||null);
    const merged=base.map((s,i)=>{
      const o=(Array.isArray(arr)&&arr[i]&&typeof arr[i]==='object')?arr[i]:{};
      const row={
        label: s.label || ('Follow-up '+(i+1)),
        date: ('date' in o) ? o.date : s.date,
        time: ('time' in o) ? o.time : s.time,
        length: s.length || 45,
        status: o.status || s.status,
        reminderOff: ('reminderOff' in o) ? !!o.reminderOff : !!s.reminderOff,
        reminderSent: ('reminderSent' in o) ? !!o.reminderSent : !!s.reminderSent,
        dnaType: ('dnaType' in o) ? (o.dnaType||null) : (s.dnaType||null),
        dnaFee: ('dnaFee' in o) ? Number(o.dnaFee||0) : Number(s.dnaFee||0),
        refundDue: ('refundDue' in o) ? Number(o.refundDue||0) : Number(s.refundDue||0),
        refundCompleted: ('refundCompleted' in o) ? !!o.refundCompleted : !!s.refundCompleted,
        refundDate: ('refundDate' in o) ? (o.refundDate||null) : (s.refundDate||null),
        dnaNoticeSent: ('dnaNoticeSent' in o) ? !!o.dnaNoticeSent : !!s.dnaNoticeSent,
        dnaNoticeSentAt: ('dnaNoticeSentAt' in o) ? (o.dnaNoticeSentAt||null) : (s.dnaNoticeSentAt||null)
      };
      if(i===0 && completedAt) row.packageCompletedAt=completedAt;
      return row;
    });
    const allDone=merged.length>0 && merged.length>=aPkgSize(b) && merged.every(s=>['completed','dna'].includes(s.status));
    if(!allDone){
      completedAt=null;
      merged.forEach(s=>{delete s.packageCompletedAt;});
      if(packageStatus==='completed')packageStatus=b.paid!==false?'prepaid':'pending';
      try{localStorage.removeItem(aPkgArchiveKey(id));}catch(e){}
    }
    b.customSessions=merged;
    if(packageStatus) b.status=packageStatus;
    if(completedAt) b.packageCompletedAt=completedAt;
    else if(hasCompletedMeta || !allDone) delete b.packageCompletedAt;
    return fetch('/api/update-booking',{
      method:'POST',
      cache:'no-store',
      headers:{'Content-Type':'application/json','Cache-Control':'no-cache'},
      body:JSON.stringify({
        token:adminSessionToken,
        action:'saveSessions',
        bookingId:id,
        sessions:merged,
        packageStatus,
        packageCompletedAt:completedAt||null
      })
    }).then(r=>{
      if(r.ok){
        try{ localStorage.removeItem('ccp_pkg_'+id); }catch(e){}
      }else{
        const dbg=document.getElementById('aDebug');
        if(dbg) dbg.innerHTML='<span style="color:#b45309">Appointment saved on this device, but saving to the server failed'
          +(r.status===401?' — your admin session expired. Sign out and back in.':' (HTTP '+r.status+').')
          +' Reminders may not fire until it saves.</span>';
      }
    }).catch(()=>{});
  }catch(e){ return Promise.resolve(); }
}

function aSessMeta(s){
  const m={ completed:{i:'✓',c:'#16a34a'}, cancelled:{i:'✕',c:'#dc2626'}, dna:{i:'⚠',c:'#b45309'}, rescheduled:{i:'↻',c:'#0369a1'}, scheduled:{i:'□',c:'#8a8a80'}, unscheduled:{i:'○',c:'#b0b0a8'} };
  return m[s]||m.scheduled;
}
function aPkgStatus(b, done, total){
  if(b.status==='cancelled') return {label:'Cancelled', color:'#dc2626', bg:'#fef2f2'};
  if(total>0 && done>=total)  return {label:'Completed', color:'#0369a1', bg:'#e0f2fe'};
  if(b.status==='prepaid')    return {label:'Prepaid / In progress', color:'#16a34a', bg:'#f0fdf4'};
  if(b.paid!==false)          return done>0 ? {label:'Paid / In progress', color:'#16a34a', bg:'#f0fdf4'} : {label:'Paid', color:'#16a34a', bg:'#f0fdf4'};
  return {label:'Pending payment', color:'#b45309', bg:'#fffbeb'};
}
function aFmtDay(date,time){
  if(!date) return 'Not booked yet';
  const d=new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
  return time ? `${d} ${fmt12(time)}` : d;
}
// ── Patient identity for record linking ──
// A patient's OWN records are matched by NAME (normalised: trimmed, lowercased,
// double-spaces collapsed). We deliberately do NOT link across different names, even
// when they share a household phone/email/address — attributing one person's clinical
// appointment to a differently-named patient would be incorrect. Household overlaps are
// surfaced separately as a soft, non-attributed note (see aHouseholdNotes).
function aNormName(b){ return (b&&b.name?String(b.name):'').trim().toLowerCase().replace(/\s+/g,' '); }
function aNormTxt(v){ return (v==null?'':String(v)).trim().toLowerCase(); }
function aNormPhone(v){ return (v==null?'':String(v)).replace(/\D/g,''); }
// Same household = any one of phone / email / address matches (and is non-empty).
function aSameHousehold(a,b){
  if(!a||!b) return false;
  const ap=aNormPhone(a.phone), bp=aNormPhone(b.phone);
  if(ap && bp && ap===bp) return true;
  const ae=aNormTxt(a.email), be=aNormTxt(b.email);
  if(ae && be && ae===be) return true;
  const aa=aNormTxt(a.address), ba=aNormTxt(b.address);
  if(aa && ba && aa===ba) return true;
  return false;
}
// Every OTHER booking for THIS SAME-NAMED patient (e.g. their own initial assessment),
// shown on the package card as "Previous appointments". Name-matched only.
function aPatientPrevious(pkg){
  if(Array.isArray(pkg.previous)) return pkg.previous;
  const nm=aNormName(pkg);
  if(!nm) return [];
  const today=new Date(); today.setHours(0,0,0,0);
  return adminBookings
    .filter(b=>b!==pkg && !aIsPackage(b) && aNormName(b)===nm && b.bookedDate)
    .sort((a,b)=>(a.bookedDate<b.bookedDate?-1:1))
    .map(b=>{
      const past=new Date(b.bookedDate+'T23:59:59') < today;
      return {
        label: b.appointment || 'Appointment',
        date: b.bookedDate, time: b.bookedTime || null,
        status: past ? 'completed' : 'scheduled',
        note: past ? 'purchased separately' : null
      };
    });
}
// Initial assessments for a DIFFERENT-named person in the SAME household. Surfaced as a
// soft prompt only (never attributed to this patient), so you can check whether this
// patient still needs their own assessment.
function aHouseholdNotes(pkg){
  const nm=aNormName(pkg);
  const seen=new Set(), out=[];
  adminBookings.forEach(b=>{
    if(b===pkg || aIsPackage(b) || !b.name || !b.bookedDate) return;
    if(aNormName(b)===nm) return;                                       // same name → handled as a "previous"
    if(!/initial assessment/i.test(String(b.appointment||''))) return;  // only assessments matter here
    if(!aSameHousehold(pkg,b)) return;                                  // must actually share a household
    const kk=aNormName(b)+'|'+b.bookedDate;
    if(seen.has(kk)) return; seen.add(kk);
    out.push({ name:b.name, date:b.bookedDate, time:b.bookedTime||null });
  });
  return out;
}
function aHouseholdNoteHtml(pkg){
  const hh=aHouseholdNotes(pkg);
  if(!hh.length) return '';
  return hh.map(h=>`<div style="padding:7px 10px;border-radius:7px;background:#fffbeb;border:1px solid #fde68a;margin-bottom:5px;font-size:11.5px;color:#92400e;line-height:1.5">🏠 Household note: an Initial Assessment was completed on ${aFmtDay(h.date,h.time)} under a different name (${aEsc(h.name)}). This patient may still need their own assessment — please check.</div>`).join('');
}
// Fill in contact details from the patient's OWN (same-name) bookings if the package
// row lacks them. Never borrows a household member's details.
function aPatientInfo(pkg){
  const nm=aNormName(pkg);
  const others=adminBookings.filter(b=>aNormName(b)===nm);
  const pick=f=>{ for(const b of [pkg,...others]) if(b && b[f]) return b[f]; return ''; };
  return {
    phone:pick('phone'), email:pick('email'), address:pick('address'),
    patientType:pick('patientType'), reason:pick('reason')
  };
}
function aPackageCard(b){
  const idx=adminBookings.indexOf(b);
  const sessions=aPkgSessions(b);
  const total=sessions.length;
  const done=sessions.filter(s=>s.status==='completed').length;
  const scheduled=sessions.filter(s=>aActiveSessionStatus(s.status) && s.date).length;
  const unscheduled=sessions.filter(s=>!s.date || s.status==='unscheduled').length;
  const remaining=Math.max(0,total-done);
  const st=aPkgStatus(b,done,total);
  const pct=total?Math.round(done/total*100):0;
  const nowKey=aDateKey(new Date());
  const next=[...sessions].filter(s=>s.date&&s.time&&aActiveSessionStatus(s.status)&&s.date>=nowKey)
    .sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0]||null;

  const info=aPatientInfo(b);
  const detail=`<div style="background:#fff;border:1px solid rgba(30,77,59,.08);border-radius:9px;padding:10px 12px;margin:10px 0;font-size:12px;color:var(--char);line-height:1.9">
      ${info.phone?`<span style="margin-right:16px">📞 ${aEsc(info.phone)}</span>`:''}${info.email?`<span>✉️ ${aEsc(info.email)}</span>`:''}
      ${info.address?`<div>📍 ${aEsc(info.address)}</div>`:''}
      <div>${b.bookedDate?'📅 Booked '+aFmtDay(b.bookedDate,'')+' · ':''}${info.patientType?('👤 '+(aIsPatientNew(b)?'New patient':'Returning patient')):''}</div>
      ${info.reason?`<div style="color:var(--muted)">📋 ${aEsc(info.reason)}</div>`:''}
    </div>`;

  const prevList=aPatientPrevious(b);
  const prev=prevList.length?`
    <div style="font-size:11px;color:var(--muted);margin:6px 0 4px">Previous appointment${prevList.length>1?'s':''}</div>
    ${prevList.map(p=>{const m=aSessMeta(p.status);return `<div style="padding:6px 9px;border-radius:7px;background:#f0fdf4;border:1px solid rgba(22,163,74,.15);margin-bottom:5px;font-size:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="color:${m.c};font-weight:700;width:16px;text-align:center">${m.i}</span>
          <span style="flex:1;color:var(--char)">${aEsc(p.label)}<span style="color:var(--muted)"> · ${aFmtDay(p.date,p.time)}</span></span>
          <span style="font-size:10px;color:${m.c};text-transform:capitalize">${p.status}</span>
        </div>
        ${p.note?`<div style="font-size:10px;color:var(--muted);padding-left:24px;margin-top:2px">(${aEsc(p.note)})</div>`:''}
      </div>`;}).join('')}`:'';

  const rows=sessions.map((s,i)=>{
    const m=aSessMeta(s.status);
    const isUn=s.status==='unscheduled'||!s.date;
    const isDone=s.status==='completed',dna=s.status==='dna',canc=s.status==='cancelled';
    const actions=isUn
      ?`<button class="bi-btn" style="background:#eef2ff;color:#4338ca;padding:4px 8px;font-size:10.5px" onclick="aOpenReschedule('${b.id}',${i})">＋ Schedule</button>`
      :`<button class="bi-btn" style="background:${isDone?'#dcfce7':'#f0fdf4'};color:#16a34a;padding:4px 8px;font-size:10.5px;${isDone?'font-weight:600;border:1px solid #86efac':''}" title="${isDone?'Undo — mark as not completed':'Mark this session completed'}" onclick="aSessSet('${b.id}',${i},'${isDone?'scheduled':'completed'}')">${isDone?'↩ Not completed':'✓ Completed'}</button>
         <button class="bi-btn" style="background:${dna?'#fef3c7':'#fffbeb'};color:#b45309;padding:4px 8px;font-size:10.5px;${dna?'font-weight:600;border:1px solid #fcd34d':''}" title="${dna?'Undo — mark as not DNA':'Mark as did not attend'}" onclick="${dna?`aSessSet('${b.id}',${i},'scheduled')`:`aOpenDna('${b.id}',${i})`}">${dna?'↩ Undo DNA':'⚠ DNA'}</button>
         <button class="bi-btn" style="background:#eef2ff;color:#4338ca;padding:4px 8px;font-size:10.5px" onclick="aOpenReschedule('${b.id}',${i})">↻ Reschedule</button>
         <button class="bi-btn" style="background:#e8f2ee;color:#1e4d3b;padding:4px 8px;font-size:10.5px" title="Open or create this session's note in Google Drive" onclick="window.CCPPractice&&CCPPractice.notesFor('${b.id}',${i})">📝 Notes</button>
         <button class="bi-btn" style="background:${canc?'#fee2e2':'#fef2f2'};color:#dc2626;padding:4px 8px;font-size:10.5px;${canc?'font-weight:600;border:1px solid #fca5a5':''}" title="${canc?'Undo — restore this appointment and re-block the slot':'Cancel and free the slot'}" onclick="aSessSet('${b.id}',${i},'${canc?'scheduled':'cancelled'}')">${canc?'↩ Undo cancel':'✕ Cancel'}</button>`;
    return `<div style="padding:8px 9px;border-radius:7px;background:#fff;border:1px solid rgba(30,77,59,.08);margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="color:${m.c};font-weight:700;width:16px;text-align:center">${m.i}</span>
          <span style="flex:1;font-size:12px;color:var(--char)">${aEsc(s.label||'Follow-up '+(i+1))}<span style="color:var(--muted)"> · ${aFmtDay(s.date,s.time)}</span></span>
          <span style="font-size:10px;color:${m.c};text-transform:capitalize">${s.status}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;padding-left:24px">${actions}</div>
        ${dna?aDnaSessionLine(b,s,i):''}
        ${aReminderLine(b,s,i)}
      </div>`;
  }).join('');

  return `<div class="booking-item bpkg patient-card is-collapsed" data-patient-key="${aEsc(patientKey(b))}" data-booking-id="${aEsc(b.id||'')}" style="${b.status==='cancelled'?'opacity:.6':''}">
    <div class="patient-card-summary">
      <div class="patient-summary-main">
        <div class="patient-summary-name">${aEsc(b.name)||'Unknown patient'}</div>
        <div class="patient-summary-type">${aEsc(b.appointment)||'Package'} · <span style="font-weight:600;color:${st.color}">${st.label}</span> · £${b.price||'?'}</div>
      </div>
      <div class="patient-summary-metric"><div class="patient-summary-label">Package progress</div><div class="patient-summary-value">${done} of ${total} completed</div></div>
      <div class="patient-summary-metric"><div class="patient-summary-label">Remaining</div><div class="patient-summary-value">${remaining} session${remaining===1?'':'s'} · ${unscheduled} to book</div></div>
      <div class="patient-summary-metric"><div class="patient-summary-label">Next appointment</div><div class="patient-summary-value">${next?aFmtDay(next.date,next.time):'Not booked yet'}</div></div>
      <button class="patient-card-toggle" onclick="togglePatientCard(this)" aria-expanded="false">View details</button>
    </div>
    <div class="patient-card-details">
      ${detail}
      ${prev}
      ${aHouseholdNoteHtml(b)}
      <div style="font-size:11px;color:var(--muted);margin:12px 0 4px;font-weight:500">Current package</div>
      <div style="margin:0 0 6px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:4px"><span>Progress</span><span>${done} of ${total} completed · ${scheduled} of ${total} scheduled${unscheduled?` · ${unscheduled} to book`:''}</span></div>
        <div style="height:8px;background:#ede9e3;border-radius:5px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#1e4d3b"></div></div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin:10px 0 4px">Follow-up appointments</div>
      <div style="margin-bottom:6px">${rows}</div>
      <div class="bi-actions">
        <button class="bi-btn" style="background:#eef2ff;color:#4338ca" onclick="aPkgReminder(${idx})">✉️ Reminder email</button>
        <button class="bi-btn" style="background:#eef2ff;color:#4338ca" onclick="aPkgExercise(${idx})">🏋️ Exercise email</button>
        <button class="bi-btn" style="background:#fff7ed;color:#b45309" onclick="openReviewRequestForBooking('${b.id}')">⭐ Review email</button>
        <button class="bi-btn" style="background:#e8f2ee;color:#1e4d3b" onclick="window.CCPPractice&&CCPPractice.intakeFor('${b.id}')">📋 Intake form</button>
        <button class="bi-btn" style="background:#e8f2ee;color:#1e4d3b" onclick="window.CCPPractice&&CCPPractice.notesFor('${b.id}',null)">📝 Notes</button>
        <button class="bi-btn" style="background:#fef2f2;color:#b91c1c" onclick="window.CCPPractice&&CCPPractice.chargeFee('${b.id}',${aEscJs(b.name)})">💳 Charge fee</button>
        <button class="bi-btn" style="background:#f5f3ef;color:var(--muted)" title="File this booking with another patient's records" onclick="aLinkChooser(this,'${b.id}')">🔗 Link to…</button>
        ${aPkgIsComplete(b)
          ?`<button class="bi-btn" style="background:#e0f2fe;color:#0369a1" onclick="aPkgUncomplete('${b.id}')">↩ Uncomplete</button>
             <span style="font-size:10.5px;color:#0369a1;align-self:center">Completed · archives in ${aPkgHoursToArchive(b)}h</span>`
          :`<button class="bi-btn confirm" onclick="aPkgComplete(${idx})">✓ Mark complete</button>`}
        <button class="bi-btn del" onclick="aPkgCancel(${idx})">✕ Cancel package</button>
      </div>
    </div>
  </div>`;
}
// Set one appointment's status (completed / dna / cancelled). Cancelled frees its slot.
// Persist slot blocks/releases to Supabase (blocked_slots) so the PUBLIC homepage
// updates for everyone — the same table paid bookings use. Best-effort: if the
// endpoint isn't deployed yet it fails silently and the in-file block still applies.
function apiBlockSlots(block, release){
  if((!block||!block.length) && (!release||!release.length)) return Promise.resolve();
  try{
    return fetch('/api/availability',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ token:adminSessionToken, action:'blocks', block:block||[], release:release||[] })})
      .then(async r=>{
        // Pull the server's fresh blocked-slot list, then redraw so admin + homepage agree.
        if(r && r.ok){
          try{ if(typeof fetchBookedSlots==='function') await fetchBookedSlots(); }catch(e){}
          try{ refreshCalendars(); }catch(e){}
        }
      })
      .catch(()=>{});
  }catch(e){ return Promise.resolve(); }
}
// Redraw every calendar/slot view after an appointment status or time changes,
// so the admin rota calendar AND the public homepage availability both update.
// (Each call is guarded — the homepage ones don't exist while in admin, and vice versa.)
function refreshCalendars(){
  try { if(typeof renderAdminRota==='function') renderAdminRota(); } catch(e){}
  try { if(typeof renderCal==='function') renderCal(); } catch(e){}
  try { if(typeof buildHeroSlots==='function') buildHeroSlots(); } catch(e){}
  try { if(typeof renderHeroCal==='function' && typeof heroCalOpen!=='undefined' && heroCalOpen) renderHeroCal(); } catch(e){}
}
// ── AUTOMATIC 24-HOUR REMINDERS ──
// The reminder cron emails the patient the morning before each appointment.
// This shows its state on the card, ticks itself once sent, and lets you cancel it.
// Manual WhatsApp reminder — shown only for appointments tomorrow (UK time).
// Opens WhatsApp with the message prefilled; the owner presses send.
// ponytail: "sent" tick lives in localStorage (one admin, one phone); move to
// the booking record if a second device ever needs to see it.
function aWaReminderBtn(b, date, time, key){
  if(!date || !time || !b.phone) return '';
  const tomorrow=new Date(Date.now()+864e5).toLocaleDateString('en-CA',{timeZone:'Europe/London'});
  if(date!==tomorrow) return '';
  const lsKey='ccp_wa_'+key;
  let sent=false; try{ sent=!!localStorage.getItem(lsKey); }catch(e){}
  if(sent) return `<span style="font-size:10.5px;color:#16a34a;margin-left:6px">✓ WhatsApp reminder sent</span>`;
  let ph=aNormPhone(b.phone); if(ph.startsWith('0')) ph='44'+ph.slice(1);
  const day=new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long'});
  const first=String(b.name||'').trim().split(/\s+/)[0]||'there';
  const msg=`Hi ${first}, reminder that Zakery from Community Care Physio is visiting ${day} at ${fmt12(time)}. Reply here if anything has changed. See you then.`;
  return `<a class="bi-btn" style="background:#e7f6ec;color:#1a7a45;padding:2px 7px;font-size:10px;margin-left:6px;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/${ph}?text=${encodeURIComponent(msg)}" onclick="try{localStorage.setItem('${lsKey}','1')}catch(e){};setTimeout(renderAdminBookings,300)">💬 WhatsApp reminder</a>`;
}
function aReminderLine(b, s, i){
  if(!s.date || ['cancelled','dna','expired','unscheduled'].includes(s.status)) return '';
  const rd=new Date(s.date+'T12:00:00'); rd.setDate(rd.getDate()-1);
  const rdLabel=rd.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
  const past=new Date(s.date+'T23:59:59') < new Date();
  let icon, text, color;
  if(s.reminderSent){ icon='✓'; color='#16a34a'; text='Reminder sent'; }
  else if(s.reminderOff){ icon='✕'; color='#8a8a80'; text='Reminder cancelled'; }
  else if(past){ icon='–'; color='#8a8a80'; text='Reminder window passed'; }
  else { icon='🔔'; color='#4338ca'; text='Reminder scheduled for '+rdLabel+' (morning)'; }
  const btn = s.reminderSent ? ''
    : `<button class="bi-btn" style="background:${s.reminderOff?'#eef2ff':'#f6f5f2'};color:${s.reminderOff?'#4338ca':'#8a8a80'};padding:2px 7px;font-size:10px;margin-left:8px" title="${s.reminderOff?'Turn the automatic reminder back on':'Stop the automatic reminder email for this appointment'}" onclick="aToggleReminder('${b.id}',${i})">${s.reminderOff?'↩ Enable reminder':'✕ Cancel reminder'}</button>`;
  const sendBtn = s.reminderSent ? ''
    : `<button class="bi-btn" style="background:#e7f0ea;color:#1e4d3b;padding:2px 7px;font-size:10px;margin-left:6px" title="Email this reminder to the patient right now — the same email the automatic 24-hour reminder sends" onclick="aSendReminderNow('${b.id}',${i})">\uD83D\uDCE8 Send now</button>`;
  return `<div style="display:flex;align-items:center;flex-wrap:wrap;padding-left:24px;margin-top:6px;font-size:10.5px;color:${color}">
      <span style="width:16px">${icon}</span><span>${text}</span>${btn}${sendBtn}${aWaReminderBtn(b,s.date,s.time,b.id+':'+i)}
    </div>`;
}
function aToggleReminder(id, i){
  const b=adminBookings.find(x=>x.id===id); if(!b) return;
  const sessions=aPkgSessions(b);
  const arr=sessions.map(s=>({status:s.status,date:s.date,time:s.time,reminderOff:!!s.reminderOff,reminderSent:!!s.reminderSent}));
  arr[i].reminderOff = !arr[i].reminderOff;
  aPkgSaveOverrides(id, arr);
  renderAdminBookings();
}
// Email the standard 24-hour reminder to the patient on demand — for appointments
// added/edited after the 8am cron has already run for the day.
async function aSendReminderNow(id, i){
  const b=adminBookings.find(x=>x.id===id); if(!b) return;
  const s=aPkgSessions(b)[i];
  if(!s || !s.date || !s.time){ alert('This appointment needs a date and time before a reminder can be sent.'); return; }
  if(!b.email){ alert('No email address on file for this patient.'); return; }
  const dLabel=new Date(s.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
  if(!confirm('Send the reminder email to '+(b.name||'the patient')+' now for '+dLabel+' at '+fmt12(s.time)+'?')) return;
  const dbg=document.getElementById('aDebug');
  if(dbg) dbg.innerHTML='Sending reminder…';
  try{
    const res=await fetch('/api/send-reminders',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ token:adminSessionToken, bookingId:id, sessionIndex:i,
        to:b.email, name:b.name||'', label:s.label||'Follow-up appointment',
        date:s.date, time:fmt12(s.time), address:b.address||'', postcode:b.postcode||'',
        phone:b.phone||'', reason:b.reason||'' })});
    if(res.ok){
      const sessions=aPkgSessions(b);
      const arr=sessions.map(x=>({status:x.status,date:x.date,time:x.time,reminderOff:!!x.reminderOff,reminderSent:!!x.reminderSent}));
      arr[i].reminderSent=true;
      aPkgSaveOverrides(id, arr);
      renderAdminBookings();
      if(dbg) dbg.innerHTML='<span style="color:#16a34a">Reminder emailed to '+(b.name||b.email)+'.</span>';
    } else {
      let e={}; try{ e=await res.json(); }catch(_){}
      if(dbg) dbg.innerHTML='';
      const serverMsg = (e && e.error) ? e.error : '';
      if(res.status===404){
        // The send-reminder-now API isn't deployed. Don't dead-end the user —
        // offer to send the exact same reminder straight from Gmail instead.
        if(confirm('The one-click "Send now" service isn\'t available yet (HTTP 404 — the /api/send-reminder-now function still needs to be deployed to the site).\n\nSend this reminder another way instead (from infoccphysio, or Gmail if there is no email address)?')){
          const first=(b.name||'there').split(' ')[0];
          const dFull=new Date(s.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
          const subject='Appointment reminder — Community Care Physio';
          const body=`Dear ${first},\n\nThis is a reminder of your upcoming physiotherapy appointment with Community Care Physio:\n\n• ${dFull} at ${fmt12(s.time)}\n\nPlease wear comfortable clothing, and have any relevant letters, scan results or x-rays to hand.\n\nShould you need to rearrange, please reply to this email or contact us on WhatsApp at your earliest convenience. Please note that cancellations within 24 hours may be subject to a £50 fee.\n\nWe look forward to seeing you.\n\n${EMAIL_SIGNATURE}`;
          if(b.email) emailSendDirect(b.email, subject, body).then(ok=>{ if(ok) alert('✓ Reminder sent from infoccphysio.'); });
          else window.open(gmailComposeUrl('', subject, body), '_blank');
        }
      } else if(res.status===401){
        alert('Your admin session has expired. Please Sign out and back in, then try "Send now" again.');
      } else if(res.status>=500){
        alert('The reminder service hit a server error (HTTP '+res.status+')'+(serverMsg?': '+serverMsg:'')+'.\n\nThis usually means the email setting GMAIL_APP_PASSWORD is missing or wrong in Vercel. You can still send the reminder using the ✉️ Reminder email button on the patient card.');
      } else {
        alert('Could not send reminder (HTTP '+res.status+')'+(serverMsg?': '+serverMsg:'')+'.\n\nYou can send it manually with the ✉️ Reminder email button on the patient card.');
      }
    }
  }catch(err){
    if(dbg) dbg.innerHTML='';
    alert('Could not reach the server to send the reminder ('+(err && err.message ? err.message : 'network error')+').\n\nCheck your connection and that the latest deployment is live, then try again — or use the ✉️ Reminder email button to send it from Gmail.');
  }
}
async function aSessSet(id, i, status){
  const b=(typeof MANUAL_BOOKINGS!=='undefined'?MANUAL_BOOKINGS:[]).find(x=>x.id===id) || adminBookings.find(x=>x.id===id);
  if(!b) return;
  const sessions=aPkgSessions(b);
  const arr=sessions.map(s=>({status:s.status,date:s.date,time:s.time}));
  const old=arr[i];
  const wasFreed = (old.status==='cancelled' || old.status==='dna');
  arr[i]={ ...arr[i], status };
  // Instant local update.
  renderAdminBookings();
  refreshCalendars();
  // Save to the database first, then adjust public slots and re-pull availability
  // so the calendar always mirrors the database.
  await aPkgSaveOverrides(id, arr);
  if(old.date && old.time){
    if(status==='cancelled' || status==='dna'){
      // Cancelled/DNA free the slot back into public availability.
      await apiBlockSlots([], [{date:old.date,time:old.time}]);
    } else if(wasFreed){
      // Undoing a cancel/DNA — restore the appointment, so re-block its slot.
      await apiBlockSlots([{date:old.date,time:old.time}], []);
    }
  }
  try{ await fetchBookedSlots(); }catch(e){}
  refreshCalendars();
}
// Open a reschedule/schedule picker built from real rota availability.
// Full clinic-day time range so admin can schedule ANY time (e.g. 4pm on an
// evening-shift day), not just the public rota slots.
function aReschedTimes(){
  const out=[];
  for(let h=8; h<=20; h++){ out.push(String(h).padStart(2,'0')+':00'); if(h<20) out.push(String(h).padStart(2,'0')+':30'); }
  return out;
}
function aOpenReschedule(id, i){
  const t=ukToday();
  // Every date for the next 8 weeks — admin isn't limited to the published rota.
  const dateOpts=[];
  for(let n=0;n<56;n++){
    const dt=new Date(t.getFullYear(), t.getMonth(), t.getDate()+n);
    const dk=dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const lbl=new Date(dk+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
    dateOpts.push(`<option value="${dk}">${lbl}</option>`);
  }
  const ov=document.createElement('div');
  ov.id='reschedOverlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(20,30,25,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML=`<div style="background:#fff;border-radius:16px;padding:22px;width:340px;max-width:100%;font-family:'Outfit',sans-serif">
      <div style="font-family:'Playfair Display',serif;font-size:18px;color:var(--char);margin-bottom:14px">Reschedule / schedule appointment</div>
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">New date</label>
      <select id="reschedDate" onchange="aReschedFillTimes()" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(30,77,59,.2);font-size:13px;margin-bottom:12px">${dateOpts.join('')}</select>
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">New time (any time in the day — booked times are greyed out)</label>
      <select id="reschedTime" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(30,77,59,.2);font-size:13px;margin-bottom:18px"></select>
      <div style="display:flex;gap:8px">
        <button onclick="aDoReschedule('${id}',${i})" style="flex:1;padding:10px;background:#1e4d3b;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer">Confirm</button>
        <button onclick="document.getElementById('reschedOverlay').remove()" style="flex:1;padding:10px;background:var(--stone);border:none;border-radius:8px;font-size:13px;cursor:pointer">Cancel</button>
      </div>
      <div style="font-size:10.5px;color:var(--muted);margin-top:12px;line-height:1.5">Blocks the chosen slot on the public site (via block-slots) and frees the old one. Updates this card and the calendar.</div>
    </div>`;
  document.body.appendChild(ov);
  aReschedFillTimes();
}
function aReschedFillTimes(){
  const dk=document.getElementById('reschedDate').value;
  const sel=document.getElementById('reschedTime');
  if(!dk){ sel.innerHTML='<option value="">—</option>'; return; }
  // Full day; already-booked times are shown but disabled so admin can't double-book.
  sel.innerHTML=aReschedTimes().map(tm=>{
    const taken=isSlotBooked(dk,tm);
    return `<option value="${tm}"${taken?' disabled':''}>${fmt12(tm)}${taken?' — booked':''}</option>`;
  }).join('');
}
// Single (non-package) booking: the server moves the booking and its blocked slots.
async function aDoRescheduleSingle(id,date,time){
  const b=adminBookings.find(x=>x.id===id); if(!b) return;
  let res,data={};
  try{
    res=await fetch('/api/update-booking',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:adminSessionToken,action:'reschedule',bookingId:id,booking:{bookedDate:date,bookedTime:time}})});
    data=await res.json().catch(()=>({}));
  }catch(e){}
  if(!res||!res.ok){ alert(data.error||'Could not reschedule. Nothing was changed.'); return; }
  b.bookedDate=date; b.bookedTime=time; b.preferredTime=time;
  const el=document.getElementById('reschedOverlay'); if(el) el.remove();
  try{ await fetchBookedSlots(); }catch(e){}
  renderAdminBookings();
  refreshCalendars();
}
async function aDoReschedule(id, i){
  const date=document.getElementById('reschedDate').value;
  const time=document.getElementById('reschedTime').value;
  if(!date||!time){ alert('Pick a date and time first.'); return; }
  if(i<0) return aDoRescheduleSingle(id,date,time);
  const b=(typeof MANUAL_BOOKINGS!=='undefined'?MANUAL_BOOKINGS:[]).find(x=>x.id===id) || adminBookings.find(x=>x.id===id);
  if(!b) return;
  const sessions=aPkgSessions(b);
  const arr=sessions.map(s=>({status:s.status,date:s.date,time:s.time}));
  const old=arr[i];
  // Moving an appointment to a new date must re-arm its reminder: clear any
  // previously-sent/disabled flag so the 24-hour cron sends a fresh reminder for
  // the NEW date. (aPkgSaveOverrides otherwise preserves the old reminder state.)
  arr[i]={ status:'scheduled', date, time, reminderSent:false, reminderOff:false };
  const el=document.getElementById('reschedOverlay'); if(el) el.remove();
  // Instant local update so the card and calendar respond immediately.
  renderAdminBookings();
  refreshCalendars();
  // Then make the calendar match the database: wait for the moved appointment to
  // save, update the public blocked slots, and re-pull availability from the DB so
  // the OLD slot is gone and the NEW one shows. No stale slot can survive this.
  await aPkgSaveOverrides(id, arr);
  await apiBlockSlots([{date,time}], (old.date&&old.time)?[{date:old.date,time:old.time}]:[]);
  try{ await fetchBookedSlots(); }catch(e){}
  refreshCalendars();
}
function aPkgReminder(i){
  const b=adminBookings[i]; if(!b) return;
  const sessions=aPkgSessions(b).filter(s=>(s.status==='scheduled'||s.status==='rescheduled') && s.date && s.time);
  const first=(b.name||'there').split(' ')[0];
  const plural=sessions.length>1;
  const lines=sessions.map(s=>{ const d=new Date(s.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}); return `• ${d} at ${fmt12(s.time)}`; }).join('\n');
  const subject='Appointment reminder — Community Care Physio';
  const body=`Dear ${first},\n\nThis is a reminder of your upcoming physiotherapy appointment${plural?'s':''} with Community Care Physio:\n\n${lines||'(no upcoming appointments scheduled)'}\n\nPlease wear comfortable clothing, and have any relevant letters, scan results or x-rays to hand.\n\nShould you need to rearrange, please reply to this email or contact us on WhatsApp at your earliest convenience. Please note that cancellations within 24 hours may be subject to a £50 fee.\n\nWe look forward to seeing you.\n\n${EMAIL_SIGNATURE}`;
  if(b.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)){ emailSendDirect(b.email, subject, body).then(ok=>{ if(ok) alert('✓ Reminder sent from infoccphysio.'); }); return; }
  window.open(gmailComposeUrl(b.email||'', subject, body), '_blank');
}
function aPkgExercise(i){
  const b=adminBookings[i]; if(!b) return;
  if(typeof hepPatient!=='undefined') hepPatient={name:b.name,email:b.email||'',phone:b.phone||''};
  const ps=document.getElementById('hepPatientSearch'); if(ps){ ps.value=b.name; }
  const sp=document.getElementById('hepSelectedPatient'); if(sp){ sp.textContent='Selected: '+b.name; }
  if(ps){ ps.scrollIntoView({behavior:'smooth',block:'center'}); }
}
// ── PACKAGE COMPLETION & 24-HOUR AUTO-ARCHIVE ──────────────────────────────
// A completed package stays visible (with an Uncomplete button) for 24 hours,
// then drops off the Active page into "Completed / archived patients". Nothing
// is ever deleted — the patient and every appointment stay in the database and
// in All clients & payments. The 24-hour clock is stored per-package.
const ARCHIVE_MS = 24*60*60*1000;
function aPkgArchiveKey(id){ return 'ccp_archived_'+id; }
function aPkgAllDone(b){
  const sessions=aPkgSessions(b);
  return sessions.length>0 && sessions.length>=aPkgSize(b) &&
    sessions.every(s=>s && ['completed','dna'].includes(s.status));
}
function aPkgIsComplete(b){
  if(!b || ['cancelled','expired'].includes(b.status)) return false;
  // Session records outrank stale package flags and old browser archive timers.
  return aPkgAllDone(b);
}
function aPkgDerivedCompletionTime(b){
  const completed=aPkgSessions(b).filter(s=>s&&['completed','dna'].includes(s.status)&&s.date);
  if(!completed.length) return null;
  const times=completed.map(s=>{
    const tm=(s.time&&/^\d{2}:\d{2}/.test(s.time))?s.time.slice(0,5):'23:59';
    return Date.parse(`${s.date}T${tm}:00`);
  }).filter(Number.isFinite);
  return times.length?Math.max(...times):null;
}
function aPkgArchivedAt(b){
  if(!aPkgIsComplete(b)) return null;
  const serverIso=aPkgServerCompletedAt(b);
  const serverMs=serverIso?Date.parse(serverIso):NaN;
  if(Number.isFinite(serverMs)) return serverMs;

  let local=null;
  try{
    const raw=localStorage.getItem(aPkgArchiveKey(b.id));
    if(raw!=null){
      const n=Number(raw);
      if(Number.isFinite(n)) local=n;
    }
  }catch(e){}
  if(local!=null) return local;
  if(!aPkgIsComplete(b)) return null;

  const derived=aPkgDerivedCompletionTime(b);
  const stamp=derived!=null?derived:Date.now();
  try{ localStorage.setItem(aPkgArchiveKey(b.id),String(stamp)); }catch(e){}
  return stamp;
}
function aPkgIsArchived(b){
  const t=aPkgArchivedAt(b);
  return t!=null && (Date.now()-t)>=ARCHIVE_MS;
}
function aPkgHoursToArchive(b){
  const t=aPkgArchivedAt(b); if(t==null) return 24;
  return Math.max(0,Math.ceil((ARCHIVE_MS-(Date.now()-t))/3600000));
}

const aArchiveMigrationInFlight=new Set();
function migratePackageArchiveState(){
  adminBookings.forEach(b=>{
    if(!b || !aIsPackage(b) || !aIsServerBooking(b.id)) return;
    if(!aPkgIsComplete(b)){
      try{localStorage.removeItem(aPkgArchiveKey(b.id));}catch(e){}
      return;
    }
    const localIso=aPkgLocalCompletedAt(b);
    const serverIso=aPkgServerCompletedAt(b);
    if(!localIso || serverIso || aArchiveMigrationInFlight.has(b.id)) return;
    aArchiveMigrationInFlight.add(b.id);
    const arr=aPkgSessions(b).map(s=>({
      status:s.status,date:s.date,time:s.time,
      reminderOff:!!s.reminderOff,reminderSent:!!s.reminderSent
    }));
    aPkgSaveOverrides(b.id,arr,{packageStatus:'completed',packageCompletedAt:localIso})
      .finally(()=>aArchiveMigrationInFlight.delete(b.id));
  });
}

async function aPkgComplete(i){
  const b=adminBookings[i]; if(!b) return;
  const sessions=aPkgSessions(b);
  if(sessions.length<aPkgSize(b) || sessions.some(s=>!['completed','dna'].includes(s.status) && (!s.date || ['unscheduled','cancelled'].includes(s.status)))){
    alert('This package still has sessions to arrange. Complete or resolve those sessions before marking the whole package complete.');
    return;
  }
  if(!confirm('Mark this whole package as completed? It stays visible for 24 hours (with an Uncomplete button), then moves to Completed / archived patients. Nothing is deleted.')) return;
  const arr=sessions.map(s=>({ status:s.status==='dna'?'dna':'completed', date:s.date, time:s.time }));
  b.status='completed';
  try{ localStorage.setItem(aPkgArchiveKey(b.id), String(Date.now())); }catch(e){}
  renderAdminBookings();
  refreshCalendars();
  // Save the completed sessions, then free their slots — completed appointments
  // no longer occupy future availability.
  const completedAtMs=Number(localStorage.getItem(aPkgArchiveKey(b.id)))||Date.now();
  await aPkgSaveOverrides(b.id,arr,{
    packageStatus:'completed',
    packageCompletedAt:new Date(completedAtMs).toISOString()
  });
  const release=sessions.filter(s=>s.date&&s.time).map(s=>({date:s.date,time:s.time}));
  await apiBlockSlots([], release);
  try{ await fetchBookedSlots(); }catch(e){}
  refreshCalendars();
}

// Restore a completed package back to Active and cancel the 24-hour archive timer.
async function aPkgUncomplete(id){
  const b=adminBookings.find(x=>x.id===id); if(!b) return;
  try{ localStorage.removeItem(aPkgArchiveKey(id)); }catch(e){}
  b.status = (b.paid!==false) ? 'prepaid' : 'pending';
  const sessions=aPkgSessions(b);
  // Completed sessions go back to scheduled (keep their date/time); leave cancelled,
  // DNA and unscheduled sessions exactly as they were.
  const arr=sessions.map(s=>({ status: s.status==='completed' ? (s.date?'scheduled':'unscheduled') : s.status, date:s.date, time:s.time }));
  renderAdminBookings();
  refreshCalendars();
  await aPkgSaveOverrides(id,arr,{packageStatus:b.status,packageCompletedAt:null});
  // Re-block the restored future appointments so they hold their slots again.
  const block=arr.filter(s=>s.date&&s.time&&s.status==='scheduled').map(s=>({date:s.date,time:s.time}));
  await apiBlockSlots(block, []);
  try{ await fetchBookedSlots(); }catch(e){}
  refreshCalendars();
}

// ── CALENDAR REBUILD FROM PATIENT BOOKINGS (single source of truth) ─────────
// Clicking "Sync bookings" rebuilds availability purely from what's stored in
// each patient's package plus each standalone booking. Old/rescheduled/cancelled
// /completed slots are released; every active appointment is blocked. The patient
// package is the single source of truth — no separate booking system.
function rebuildCalendarFromPackages(){
  // Build the ONE true set of occupied slots straight from the current bookings.
  // A global (date|time) set guarantees no slot is ever listed twice, and because
  // we read each package's CURRENT sessions only, a rescheduled appointment's old
  // date simply isn't produced — so it cannot linger or duplicate.
  const auth={};
  const seen=new Set();
  const add=(d,t)=>{ if(d&&t){ const k=d+'|'+t; if(seen.has(k)) return; seen.add(k); (auth[d]=auth[d]||[]).push(t); } };
  // Every appointment holds its whole visit plus the 45-minute travel buffer — the
  // same slots the payment webhook blocks — so a sync never releases buffer slots.
  const addRange=(d,t,mins)=>occupiedTimes(t,mins).forEach(x=>add(d,x));
  adminBookings.forEach(b=>{
    if(!b || b.activeOnly) return;
    if(aIsPackage(b)){
      // Completed / cancelled / DNA / unscheduled do NOT hold a slot.
      aPkgSessions(b).forEach(s=>{
        if(s.date && s.time && ['scheduled','confirmed','pending','paid','prepaid','rescheduled'].includes(s.status)) addRange(s.date,s.time,Number(s.length)===60?60:45);
      });
    } else if(b.bookedDate && b.bookedTime && !['cancelled','expired','completed','dna'].includes(b.status)){
      addRange(b.bookedDate, b.bookedTime, APPT_MINS[b.appointment]||60);
    }
  });
  // Reconcile against what the server currently holds: block anything new, and
  // RELEASE every slot the server still has that no live appointment claims
  // (this is what clears an old date left behind by a reschedule or cancellation).
  const toBlock=[], toRelease=[];
  Object.keys(auth).forEach(d=>auth[d].forEach(t=>{ if(!((BOOKED_SLOTS[d]||[]).includes(t))) toBlock.push({date:d,time:t}); }));
  Object.keys(BOOKED_SLOTS||{}).forEach(d=>(BOOKED_SLOTS[d]||[]).forEach(t=>{ if(!((auth[d]||[]).includes(t))) toRelease.push({date:d,time:t}); }));
  // The bookings are the source of truth for what shows on the calendar right now.
  BOOKED_SLOTS = auth;
  refreshCalendars();
  // Persist the reconciliation, then RE-ASSERT `auth` once the write returns, so a
  // stale /api/get-slots response can't quietly re-introduce the old/rescheduled
  // dates on this screen. (apiBlockSlots is avoided here because its own re-fetch
  // is exactly what used to clobber the clean rebuild.)
  if(toBlock.length || toRelease.length){
    try{
      fetch('/api/availability',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ token:adminSessionToken, action:'blocks', block:toBlock, release:toRelease })})
        .then(()=>{ BOOKED_SLOTS = auth; refreshCalendars(); })
        .catch(()=>{});
    }catch(e){}
  }
}
async function aPkgCancel(i){
  const b=adminBookings[i]; if(!b) return;
  if(!confirm('Cancel this whole package? Every appointment is marked Cancelled and its slots are freed.')) return;
  const sessions=aPkgSessions(b);
  const release=sessions.filter(s=>s.date&&s.time).map(s=>({date:s.date,time:s.time}));
  const arr=sessions.map(s=>({ status:'cancelled', date:s.date, time:s.time }));
  b.status='cancelled';
  // Instant local update.
  renderAdminBookings();
  refreshCalendars();
  // Save to the database first, then free the slots and re-pull availability.
  await aPkgSaveOverrides(b.id, arr);
  await apiBlockSlots([], release);
  try{ await fetchBookedSlots(); }catch(e){}
  refreshCalendars();
}

function renderAdminBookings(){
  renderClientList();
  renderArchivedPackages();
  try{renderDashboard();}catch(e){}
  try{updateAdminStats();}catch(e){}
  const el=document.getElementById('aBookingsList');
  if(!adminBookings.length){
    el.innerHTML=`<div class="admin-empty">No bookings yet. They'll appear here automatically when patients book through your site.<br><br><small>If you've had bookings, click <strong>↻ Sync bookings</strong> above to pull from the server.</small></div>`;
    restoreOpenPatientCards();
    applyPatientHighlights();
    return;
  }
  const pkgSlots=new Set();
  adminBookings.forEach(pb=>{if(aIsPackage(pb)){aPkgSessions(pb).forEach(s=>{if(s.date&&s.time)pkgSlots.add(s.date+'|'+s.time);});}});
  const pkgPatients=new Set(adminBookings.filter(pb=>aIsPackage(pb)&&pb.name).map(pb=>pb.name.trim().toLowerCase()));
  const recent=[...adminBookings].reverse().filter(b=>{
    if(b.id&&cbDismissed.includes(b.id))return false;
    const recordStatus=String(b.status||'').toLowerCase();
    if(aIsPackage(b)&&(aPkgIsArchived(b)||recordStatus==='cancelled'||recordStatus==='expired'))return false;
    if(!aIsPackage(b)&&['completed','cancelled','expired','dna'].includes(recordStatus))return false;
    if(!aIsPackage(b)&&b.bookedDate&&b.bookedTime&&pkgSlots.has(b.bookedDate+'|'+b.bookedTime))return false;
    if(!aIsPackage(b)&&b.name&&pkgPatients.has(b.name.trim().toLowerCase()))return false;
    return true;
  });
  if(!recent.length){
    el.innerHTML='<div class="admin-empty" style="padding:24px">No active patient records match the current view.<br><br><small>Your full booking history is under <strong>Finance → All clients &amp; payments</strong>.</small></div>';
    restoreOpenPatientCards();
    applyPatientHighlights();
    return;
  }
  const cardFor=b=>{
    try{
      if(aIsPackage(b))return aPackageCard(b);
      const isPkg=['Starter Programme','Full Programme','Block of 4 Sessions','Block of 6 Sessions'].includes(b.appointment);
      const type=aApptType(b.appointment);
      const paid=b.paid!==false;
      const idx=adminBookings.indexOf(b);
      const st=aStatus(b);
      const overdue=aIsOverdue(b);
      const isComplete=['completed','cancelled','expired','dna'].includes(String(b.status||'').toLowerCase());
      return `<div class="booking-item ${isPkg?'bpkg':'bnew'} patient-card is-collapsed" data-patient-key="${aEsc(patientKey(b))}" data-booking-id="${aEsc(b.id||'')}" style="${isComplete?'opacity:.65':''}">
        <div class="patient-card-summary">
          <div class="patient-summary-main">
            <div class="patient-summary-name">${aEsc(b.name)||'Unknown patient'}</div>
            <div class="patient-summary-type">${type.label} · <span style="font-weight:600;color:${st.color}">${st.label}</span> · £${b.price||'?'}</div>
          </div>
          <div class="patient-summary-metric"><div class="patient-summary-label">Appointment</div><div class="patient-summary-value">${aFmtDay(b.bookedDate,b.bookedTime)}</div></div>
          <div class="patient-summary-metric"><div class="patient-summary-label">Completed</div><div class="patient-summary-value">${b.status==='completed'?'1 of 1':'0 of 1'}</div></div>
          <div class="patient-summary-metric"><div class="patient-summary-label">Remaining</div><div class="patient-summary-value">${isComplete?'0':'1'} session</div></div>
          <button class="patient-card-toggle" onclick="togglePatientCard(this)" aria-expanded="false">View details</button>
        </div>
        <div class="patient-card-details">
          ${overdue?`<div style="font-size:11px;font-weight:600;color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:8px 10px;margin-bottom:8px">⚠ Payment overdue (held over 48h) — check Stripe, then mark paid or release the slot.</div>`:''}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 10px;padding:10px;background:#fff;border-radius:8px;border:1px solid rgba(30,77,59,.06)">
            <div style="font-size:11px;color:var(--muted)">📞 <strong style="color:var(--char)">${aEsc(b.phone)||'—'}</strong></div>
            <div style="font-size:11px;color:var(--muted)">✉️ <strong style="color:var(--char)">${aEsc(b.email)||'—'}</strong></div>
            <div style="font-size:11px;color:var(--muted);grid-column:1/-1">📍 <strong style="color:var(--char)">${aEsc(b.address)||'—'}, ${aEsc(b.postcode)||''}</strong></div>
            <div style="font-size:11px;color:var(--muted)">🗓 <strong style="color:var(--char)">${aEsc(b.preferredTime||b.bookedTime)||'—'}</strong></div>
            <div style="font-size:11px;color:var(--muted)">👤 <strong style="color:var(--char)">${aIsPatientNew(b)?'New patient':'Returning patient'}</strong></div>
            ${b.reason?`<div style="font-size:11px;color:var(--muted);grid-column:1/-1">📋 <strong style="color:var(--char)">Reason:</strong> ${aEsc(b.reason)}</div>`:''}
            ${b.concernAreas?`<div style="font-size:11px;color:var(--muted);grid-column:1/-1">🏷️ <strong style="color:var(--char)">Areas of concern:</strong> ${aEsc(b.concernAreas)}${b.complexityFee?` <span style="color:var(--forest);font-weight:500">(+£${b.complexityFee} complexity)</span>`:''}</div>`:''}
          </div>
          <div class="bi-actions">
            <button class="bi-btn" style="background:#e0f2fe;color:#0369a1" onclick="aMarkPaid(${idx})">${paid?'↩ Mark as unpaid':'✓ Mark as paid'}</button>
            ${b.status!=='completed'?`<button class="bi-btn confirm" onclick="aCompleteBooking(${idx})">✓ Complete</button>`:`<span style="font-size:11px;color:#0369a1;font-weight:500">✓ Completed</span>`}
            ${overdue?`<button class="bi-btn" style="background:#fef3c7;color:#b45309" onclick="aReleaseBooking(${idx})" title="Mark expired and free the slot">⏱ Release slots</button>`:''}
            ${b.status!=='completed'&&aIsServerBooking(b.id)?`<button class="bi-btn" style="background:#eef2ff;color:#4338ca" onclick="aOpenReschedule('${b.id}',-1)" title="Move to a new date and time. Sends nothing to the patient.">↻ Reschedule</button>`:''}
            <button class="bi-btn" style="background:#fef3c7;color:#b45309" onclick="aCancelBooking(${idx})" title="Cancel — checks the 24h window, drafts the email, frees the slot">⊘ Cancel / release slot</button>
            <button class="bi-btn" style="background:#fff7ed;color:#b45309" onclick="openReviewRequestForBooking('${b.id}')">⭐ Review email</button>
            ${aWaReminderBtn(b,b.bookedDate,b.bookedTime,b.id)}
            <button class="bi-btn" style="background:#e8f2ee;color:#1e4d3b" onclick="window.CCPPractice&&CCPPractice.intakeFor('${b.id}')">📋 Intake form</button>
        <button class="bi-btn" style="background:#e8f2ee;color:#1e4d3b" onclick="window.CCPPractice&&CCPPractice.notesFor('${b.id}',null)">📝 Notes</button>
        <button class="bi-btn" style="background:#fef2f2;color:#b91c1c" onclick="window.CCPPractice&&CCPPractice.chargeFee('${b.id}',${aEscJs(b.name)})">💳 Charge fee</button>
        <button class="bi-btn" style="background:#f5f3ef;color:var(--muted)" title="File this booking with another patient's records" onclick="aLinkChooser(this,'${b.id}')">🔗 Link to…</button>
            <button class="bi-btn del" onclick="aDeleteBooking(${idx})">✕ Remove</button>
          </div>
        </div>
      </div>`;
    }catch(e){
      return '<div class="booking-item" style="padding:10px;font-size:12px;color:#dc2626">A booking could not be displayed ('+aEsc(e&&e.message||'error')+') — it is still safe in your records.</div>';
    }
  };
  // Linked records (same patient booked under different names) render together,
  // newest at the top and the first booking (usually the initial) at the bottom.
  // Archived (finished) blocks still belong in a linked patient's history.
  const pool=recent.concat(adminBookings.filter(b=>!recent.includes(b)&&b.id&&!cbDismissed.includes(b.id)&&((aIsPackage(b)&&aPkgIsArchived(b))||aPatientGroup(b))));
  const drawn=new Set();
  el.innerHTML=aLinkSuggestionsHtml(pool,recent)+recent.map(b=>{
    const g=aPatientGroup(b);
    if(!g) return cardFor(b);
    if(drawn.has(g.id)) return '';
    drawn.add(g.id);
    const members=pool.filter(x=>aPatientGroup(x)===g).sort((x,y)=>aBookingStart(y).localeCompare(aBookingStart(x)));
    const trail=[...members].reverse().map((m,i)=>`${i?'<span style="color:var(--gold)">＋</span> ':''}${aEsc(m.appointment||'Booking')} <span style="color:var(--muted)">(${aEsc(m.name)})</span>`).join(' ');
    return `<div class="patient-group" style="border-left:3px solid var(--sage);padding:10px 0 2px 12px;margin:0 0 14px">
      <div style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin-bottom:8px">
        <strong style="color:var(--forest);font-size:14px">👥 ${aEsc(g.name)}</strong>
        <span style="font-size:11.5px;color:var(--char)">${trail}</span>
        <button class="bi-btn" style="background:#fff7ed;color:#b45309;padding:3px 8px;font-size:10.5px;margin-left:auto" title="Review request to whoever made the latest booking for this patient" onclick="openReviewRequestForBooking('${aEsc(members[0].id)}')">⭐ Review email</button>
        <button class="bi-btn" style="background:#f5f3ef;color:var(--muted);padding:3px 8px;font-size:10.5px" onclick="aUnlinkPatient('${aEsc(g.id)}')">Unlink</button>
      </div>
      ${members.map(cardFor).join('')}
    </div>`;
  }).join('');
  restoreOpenPatientCards();
  applyPatientHighlights();
}

// ── Linking one patient's bookings made under different names ──
// e.g. a spouse books a second block for her husband. Nothing links automatically:
// likely matches are suggested and you confirm Yes / No. Stored via CCPPractice
// (practice_records settings:patient-groups) so it follows you across devices.
function aGroups(){ return (window.CCPPractice&&CCPPractice.patientGroups)?CCPPractice.patientGroups():{groups:[],notSame:[]}; }
function aPatientGroup(b){ return b&&b.id?aGroups().groups.find(g=>(g.bookingIds||[]).includes(String(b.id)))||null:null; }
function aBookingStart(b){
  const dates=(aIsPackage(b)?aPkgSessions(b).map(s=>s.date):[]).concat(b.bookedDate||[]).filter(Boolean).sort();
  return dates[0]||String(b.timestamp||'');
}
function aNormPostcode(v){ return String(v||'').replace(/\s+/g,'').toUpperCase(); }
// Why two differently-named bookings might be the same patient (or household).
function aLinkReasons(a,b){
  const why=[], na=aNormName(a).split(' '), nb=aNormName(b).split(' ');
  const surA=na.length>1?na[na.length-1]:'', surB=nb.length>1?nb[nb.length-1]:'';
  if(surA.length>1 && surA===surB) why.push('same surname');
  const ea=aNormTxt(a.email), eb=aNormTxt(b.email);
  if(ea && ea===eb) why.push('same email');
  else if(ea && eb){
    const local=e=>e.split('@')[0];
    const hit=(e,names)=>names.some(t=>t.length>=3 && local(e).includes(t));
    if(hit(ea,nb)||hit(eb,na)) why.push('similar email');
  }
  const pa=aNormPhone(a.phone).slice(-10), pb=aNormPhone(b.phone).slice(-10);
  if(pa.length>=9 && pa===pb) why.push('same phone');
  const aa=aNormTxt(a.address), ba=aNormTxt(b.address);
  if(aa && aa===ba) why.push('same address');
  else if(aNormPostcode(a.postcode) && aNormPostcode(a.postcode)===aNormPostcode(b.postcode)) why.push('same postcode');
  return why;
}
// A single weak signal (e.g. only a shared surname) is not enough to ask.
function aLinkScore(why){ return why.reduce((n,w)=>n+(['same email','same phone','same address'].includes(w)?2:1),0); }
// Only asks about pairs where at least one booking is still active.
function aLinkSuggestions(list, active=list){
  const {notSame}=aGroups(), out=[];
  for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length;j++){
    const a=list[i], b=list[j];
    if(!a.id||!b.id||aNormName(a)===aNormName(b)) continue;
    if(!active.includes(a)&&!active.includes(b)) continue;
    const ga=aPatientGroup(a), gb=aPatientGroup(b);
    if(ga && ga===gb) continue;
    if(notSame.includes([a.id,b.id].map(String).sort().join('|'))) continue;
    const why=aLinkReasons(a,b);
    if(aLinkScore(why)>=2) out.push({a,b,why});
  }
  return out.slice(0,3);
}
function aLinkSuggestionsHtml(list, active){
  return aLinkSuggestions(list, active).map(({a,b,why})=>{
    const lbl=x=>`<strong>${aEsc(x.name)}</strong> <span style="color:var(--muted)">(${aEsc(x.appointment||'booking')}${x.bookedDate?', '+aFmtDay(x.bookedDate,''):''})</span>`;
    const ids=`'${aEsc(a.id)}','${aEsc(b.id)}'`;
    return `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;margin:0 0 12px;font-size:12.5px;color:var(--char);line-height:1.6">
      🔗 <strong>Same patient?</strong> ${lbl(a)} and ${lbl(b)} · ${aEsc(why.join(', '))}
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
        <button class="bi-btn confirm" style="padding:4px 9px;font-size:11px" onclick="aLinkPatients(${ids},${aEscJs(a.name)})">Yes · file under ${aEsc(a.name)}</button>
        <button class="bi-btn confirm" style="padding:4px 9px;font-size:11px" onclick="aLinkPatients(${ids},${aEscJs(b.name)})">Yes · file under ${aEsc(b.name)}</button>
        <button class="bi-btn" style="background:#f5f3ef;color:var(--muted);padding:4px 9px;font-size:11px" onclick="aNotSamePatient(${ids})">No, different people</button>
      </div>
    </div>`;
  }).join('');
}
async function aSaveGroups(value, done){
  if(!window.CCPPractice||!CCPPractice.saveGroups){ adminToast('Records are still loading — try again in a moment',false); return; }
  try{ await CCPPractice.saveGroups(value); adminToast(done); }
  catch(e){ /* the admin fetch wrapper already shows the error */ }
}
function aLinkPatients(idA, idB, name){
  const v=aGroups(), groups=v.groups.map(g=>({...g,bookingIds:[...(g.bookingIds||[])]}));
  const find=id=>groups.find(g=>g.bookingIds.includes(String(id)));
  let g=find(idA)||find(idB);
  const other=g&&find(idA)&&find(idB)&&find(idA)!==find(idB)?(g===find(idA)?find(idB):find(idA)):null;
  if(!g){ g={id:'g'+Date.now().toString(36),name,bookingIds:[]}; groups.push(g); }
  if(other){ g.bookingIds.push(...other.bookingIds); groups.splice(groups.indexOf(other),1); }
  g.name=name;
  [idA,idB].map(String).forEach(id=>{ if(!g.bookingIds.includes(id)) g.bookingIds.push(id); });
  aSaveGroups({...v,groups}, 'Linked under '+name);
}
function aNotSamePatient(idA, idB){
  const v=aGroups();
  aSaveGroups({...v,notSame:[...v.notSame,[idA,idB].map(String).sort().join('|')]}, 'Kept as different people');
}
// Manual link for cases the matcher can't spot (e.g. a friend booked with no shared details).
function aLinkChooser(btn, id){
  const me=adminBookings.find(b=>String(b.id)===String(id)); if(!me) return;
  const g=aPatientGroup(me);
  const others=adminBookings.filter(b=>b.id&&b!==me&&!cbDismissed.includes(b.id)&&!(g&&aPatientGroup(b)===g));
  const seen=new Set();
  const opts=others.filter(b=>{ const k=String(b.id); if(seen.has(k)) return false; seen.add(k); return true; })
    .sort((a,b)=>aNormName(a).localeCompare(aNormName(b)))
    .map(b=>`<option value="${aEsc(b.id)}">${aEsc(b.name||'Unknown')} · ${aEsc(b.appointment||'')}${b.bookedDate?' · '+aFmtDay(b.bookedDate,''):''}</option>`).join('');
  const wrap=document.createElement('div');
  wrap.style.cssText='display:flex;gap:6px;flex-wrap:wrap;align-items:center;width:100%;margin-top:6px;font-size:12px';
  wrap.innerHTML=`<span>Link <strong>${aEsc(me.name)}</strong> with</span><select style="font:inherit;padding:5px 8px;border:1px solid #d8d4cc;border-radius:7px;max-width:100%">${opts}</select>
    <button class="bi-btn confirm" style="padding:4px 9px;font-size:11px">Link · file under ${aEsc(me.name)}</button>
    <button class="bi-btn" style="background:#f5f3ef;color:var(--muted);padding:4px 9px;font-size:11px">Cancel</button>`;
  const [link,cancel]=wrap.querySelectorAll('button');
  link.onclick=()=>aLinkPatients(id, wrap.querySelector('select').value, me.name);
  cancel.onclick=()=>wrap.remove();
  btn.parentElement.appendChild(wrap);
}
function aUnlinkPatient(id){
  const v=aGroups();
  aSaveGroups({...v,groups:v.groups.filter(g=>g.id!==id)}, 'Records unlinked');
}

function aEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
// A JS string literal that is safe inside a double-quoted HTML attribute (e.g. onclick).
function aEscJs(s){return aEsc(JSON.stringify(String(s==null?'':s))).replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

// Completed packages that have passed the 24-hour window — shown in their own
// collapsible section. The record itself is untouched in the database.
function aArchivedReminderSummary(s){
  if(!s || !s.date) return '<span style="color:var(--muted)">No appointment date — no reminder scheduled</span>';
  if(s.reminderSent) return '<span style="color:#16a34a">✓ Reminder sent</span>';
  if(s.reminderOff) return '<span style="color:#8a8a80">✕ Reminder cancelled</span>';
  if(['cancelled','dna','expired','unscheduled'].includes(String(s.status||'').toLowerCase())){
    return '<span style="color:#8a8a80">– No reminder required</span>';
  }
  const apptEnd=new Date(s.date+'T23:59:59');
  if(apptEnd < new Date()) return '<span style="color:#8a8a80">– Reminder window passed</span>';
  const rd=new Date(s.date+'T12:00:00');
  rd.setDate(rd.getDate()-1);
  const rdLabel=rd.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
  return '<span style="color:#4338ca">🔔 Reminder scheduled for '+rdLabel+' (morning)</span>';
}

// Completed packages that have passed the 24-hour window — shown in their own
// collapsible section. The record itself is untouched in the database.
function renderArchivedPackages(){
  const el=document.getElementById('aArchivedList'); if(!el) return;
  const archived=adminBookings.filter(b=>aIsPackage(b) ? aPkgIsArchived(b) : ['completed','dna'].includes(String(b.status||'').toLowerCase()));
  const badge=document.getElementById('aArchivedBadge');
  if(badge) badge.textContent = archived.length ? '· '+archived.length : '';
  if(!archived.length){
    el.innerHTML='<div style="font-size:12px;color:var(--muted);padding:4px 0">No archived patients yet.</div>';
    return;
  }

  el.innerHTML=archived.map(b=>{
    if(!aIsPackage(b)) return aArchivedSingleCard(b);
    const sessions=aPkgSessions(b);
    const done=sessions.filter(s=>s.status==='completed').length;
    const info=aPatientInfo(b);
    const when=aPkgArchivedAt(b);
    const wlabel=when?new Date(when).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'—';
    const previous=aPatientPrevious(b);

    const previousRows=previous.length
      ? `<div style="font-size:11px;color:var(--muted);margin:12px 0 5px;font-weight:500">Previous appointments</div>
         ${previous.map(p=>{
           const m=aSessMeta(p.status);
           return `<div style="padding:8px 10px;border-radius:8px;background:#f8faf9;border:1px solid rgba(30,77,59,.08);margin-bottom:6px;font-size:11.5px">
             <div style="display:flex;align-items:center;gap:8px">
               <span style="color:${m.c};font-weight:700;width:16px;text-align:center">${m.i}</span>
               <span style="flex:1;color:var(--char)">${aEsc(p.label)} <span style="color:var(--muted)">· ${aFmtDay(p.date,p.time)}</span></span>
               <span style="font-size:10px;color:${m.c};text-transform:capitalize">${aEsc(p.status)}</span>
             </div>
             ${p.note?`<div style="font-size:10px;color:var(--muted);padding-left:24px;margin-top:3px">(${aEsc(p.note)})</div>`:''}
           </div>`;
         }).join('')}`
      : '';

    const sessionRows=sessions.map((s,i)=>{
      const m=aSessMeta(s.status);
      return `<div style="padding:9px 10px;border-radius:8px;background:#fff;border:1px solid rgba(30,77,59,.08);margin-bottom:7px">
        <div style="display:flex;align-items:flex-start;gap:8px;font-size:11.5px">
          <span style="color:${m.c};font-weight:700;width:16px;text-align:center;padding-top:1px">${m.i}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
              <span style="font-weight:500;color:var(--char)">${aEsc(s.label||('Follow-up '+(i+1)))}</span>
              <span style="font-size:10px;color:${m.c};text-transform:capitalize">${aEsc(s.status||'scheduled')}</span>
            </div>
            <div style="color:var(--muted);margin-top:3px">📅 ${aFmtDay(s.date,s.time)}${s.length?` · ${Number(s.length)} min`:''}</div>
            <div style="font-size:10.5px;margin-top:5px">${aArchivedReminderSummary(s)}</div>
          </div>
        </div>
      </div>`;
    }).join('');

    return `<div class="booking-item patient-card is-collapsed archived-patient-card" data-booking-id="${aEsc(b.id||'')}">
      <div class="patient-card-summary">
        <div class="patient-summary-main">
          <div class="patient-summary-name">${aEsc(b.name)||'Unknown patient'}</div>
          <div class="patient-summary-type">${aEsc(b.appointment)||'Package'} · <span style="font-weight:600;color:#0369a1">Completed</span></div>
        </div>
        <div class="patient-summary-metric"><div class="patient-summary-label">Package progress</div><div class="patient-summary-value">${done} of ${sessions.length} completed</div></div>
        <div class="patient-summary-metric"><div class="patient-summary-label">Appointments</div><div class="patient-summary-value">${sessions.length} session${sessions.length===1?'':'s'}</div></div>
        <div class="patient-summary-metric"><div class="patient-summary-label">Archived</div><div class="patient-summary-value">${wlabel}</div></div>
        <button class="patient-card-toggle" onclick="togglePatientCard(this)" aria-expanded="false">View details</button>
      </div>

      <div class="patient-card-details">
        <div style="background:#fff;border:1px solid rgba(30,77,59,.08);border-radius:9px;padding:10px 12px;margin:0 0 10px;font-size:11.5px;color:var(--char);line-height:1.9">
          ${info.phone?`<span style="margin-right:16px">📞 ${aEsc(info.phone)}</span>`:''}
          ${info.email?`<span>✉️ ${aEsc(info.email)}</span>`:''}
          ${info.address?`<div>📍 ${aEsc(info.address)}</div>`:''}
          <div>✅ Package completed and archived ${wlabel}</div>
        </div>

        ${previousRows}
        ${aHouseholdNoteHtml(b)}

        <div style="font-size:11px;color:var(--muted);margin:12px 0 5px;font-weight:500">Package appointment history</div>
        <div>${sessionRows || '<div style="font-size:11px;color:var(--muted)">No appointment history saved.</div>'}</div>

        <div class="bi-actions" style="margin-top:12px">
          <button class="bi-btn" style="background:#fff7ed;color:#b45309" onclick="openReviewRequestForBooking('${b.id}')">⭐ Review email</button>
          <button class="bi-btn" style="background:#e0f2fe;color:#0369a1" onclick="aPkgUncomplete('${b.id}')">↩ Restore to Active</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
// Completed single bookings (an initial assessment seen once, say) keep their
// record, notes and intake reachable here instead of vanishing from Patients.
function aArchivedSingleCard(b){
  const idx=adminBookings.indexOf(b);
  const st=String(b.status||'').toLowerCase()==='dna'?'Did not attend':'Completed';
  return `<div class="booking-item patient-card is-collapsed archived-patient-card" data-booking-id="${aEsc(b.id||'')}">
      <div class="patient-card-summary">
        <div class="patient-summary-main">
          <div class="patient-summary-name">${aEsc(b.name)||'Unknown patient'}</div>
          <div class="patient-summary-type">${aEsc(b.appointment)||'Appointment'} · <span style="font-weight:600;color:#0369a1">${st}</span> · £${b.price||'?'}</div>
        </div>
        <div class="patient-summary-metric"><div class="patient-summary-label">Appointment</div><div class="patient-summary-value">${aFmtDay(b.bookedDate,b.bookedTime)}</div></div>
        <div class="patient-summary-metric"><div class="patient-summary-label">Paid</div><div class="patient-summary-value">${b.paid===false?'Outstanding':'Yes'}</div></div>
        <button class="patient-card-toggle" onclick="togglePatientCard(this)" aria-expanded="false">View details</button>
      </div>
      <div class="patient-card-details">
        <div style="background:#fff;border:1px solid rgba(30,77,59,.08);border-radius:9px;padding:10px 12px;margin:0 0 10px;font-size:11.5px;color:var(--char);line-height:1.9">
          ${b.phone?`<span style="margin-right:16px">📞 ${aEsc(b.phone)}</span>`:''}
          ${b.email?`<span>✉️ ${aEsc(b.email)}</span>`:''}
          ${b.address?`<div>📍 ${aEsc(b.address)}${b.postcode?', '+aEsc(b.postcode):''}</div>`:''}
          ${b.reason?`<div>📋 ${aEsc(b.reason)}</div>`:''}
        </div>
        ${aHouseholdNoteHtml(b)}
        <div class="bi-actions" style="margin-top:12px">
          <button class="bi-btn" style="background:#e0f2fe;color:#0369a1" onclick="aMarkPaid(${idx})">${b.paid===false?'✓ Mark as paid':'↩ Mark as unpaid'}</button>
          <button class="bi-btn" style="background:#fff7ed;color:#b45309" onclick="openReviewRequestForBooking('${b.id}')">⭐ Review email</button>
          <button class="bi-btn" style="background:#e8f2ee;color:#1e4d3b" onclick="window.CCPPractice&&CCPPractice.intakeFor('${b.id}')">📋 Intake form</button>
          <button class="bi-btn" style="background:#e8f2ee;color:#1e4d3b" onclick="window.CCPPractice&&CCPPractice.notesFor('${b.id}',null)">📝 Notes</button>
          <button class="bi-btn" style="background:#e0f2fe;color:#0369a1" onclick="aReopenBooking(${idx})">↩ Restore to Active</button>
        </div>
      </div>
    </div>`;
}
async function aReopenBooking(i){
  const b=adminBookings[i]; if(!b) return;
  try{ await fetch('/api/update-booking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:adminSessionToken,action:'reopen',bookingId:b.id})}); }catch(e){}
  b.status='confirmed';
  renderAdminBookings();
}
function clientFilterRange(){
  const f=document.getElementById('aClientFrom');
  const t=document.getElementById('aClientTo');
  return {from:(f&&f.value)?f.value:null, to:(t&&t.value)?t.value:null};
}
function filteredClients(){
  const {from,to}=clientFilterRange();
  const list=adminBookings.filter(b=>{
    if(b.activeOnly) return false;         // combined display cards aren't real records
    const d=b.bookedDate;
    if(!d) return !from && !to;           // undated enquiries only show with no range set
    if(from && d<from) return false;
    if(to && d>to) return false;
    return true;
  });
  // chronological (earliest appointment first; undated last)
  return list.slice().sort((a,b)=>{
    const da=a.bookedDate||'9999-99-99', db=b.bookedDate||'9999-99-99';
    return da<db?-1:da>db?1:0;
  });
}

function aBookingRefundCompleted(b){
  if(!b) return 0;
  return aPkgSessions(b).reduce((sum,s)=>sum+(s&&s.refundCompleted?Number(s.refundDue||0):0),0);
}
function aBookingRefundPending(b){
  if(!b) return 0;
  return aPkgSessions(b).reduce((sum,s)=>sum+(s&&s.status==='dna'&&!s.refundCompleted?Number(s.refundDue||0):0),0);
}
function aMoney(v){ return Number(v||0).toFixed(2).replace(/\.00$/,''); }

function renderClientList(){
  const el=document.getElementById('aClientList');
  if(!el)return;
  const list=filteredClients();
  const cnt=document.getElementById('aClientCount');
  if(cnt)cnt.textContent=list.length+' record'+(list.length===1?'':'s');
  if(!list.length){ el.innerHTML='<div class="admin-empty">No clients in this range.</div>'; return; }
  const rows=list.map(b=>{
    const paid=b.paid!==false;
    const apptDate=b.bookedDate?new Date(b.bookedDate+'T12:00:00').toLocaleDateString('en-GB'):'—';
    const addr=(b.address||'')+(b.postcode?', '+b.postcode:'');
    const idx=adminBookings.indexOf(b);
    const gross=Number(b.price||0), refunded=aBookingRefundCompleted(b), pendingRefund=aBookingRefundPending(b), net=Math.max(0,gross-refunded);
    return `<tr>
      <td>${aEsc(b.name||'—')}</td>
      <td>${aEsc(b.appointment||'—')}</td>
      <td>${apptDate}</td>
      <td>${aEsc(b.bookedTime||b.preferredTime||'—')}</td>
      <td>${aEsc(b.phone||'—')}</td>
      <td>${aEsc(b.email||'—')}</td>
      <td class="wrap">${aEsc(addr||'—')}</td>
      <td>£${aMoney(gross)}</td>
      <td style="color:#dc2626">${refunded?'−£'+aMoney(refunded):'£0'}${pendingRefund?`<div style="font-size:9px;color:#b45309">£${aMoney(pendingRefund)} pending</div>`:''}</td>
      <td style="font-weight:700;color:var(--forest)">£${aMoney(net)}</td>
      <td style="color:${paid?'#16a34a':'#dc2626'};font-weight:600">${paid?'Paid':'Unpaid'}</td>
      <td><button type="button" class="finance-delete-btn" onclick="aPurgeBooking(${idx})" title="Remove a genuine test or refunded record from Supabase and future Excel exports">× Remove test/refund</button></td>
    </tr>`;
  }).join('');
  el.innerHTML=`<table class="a-client-table">
    <thead><tr><th>Name</th><th>Appointment</th><th>Date</th><th>Time</th><th>Phone</th><th>Email</th><th>Address</th><th>Gross</th><th>Refunded</th><th>Net</th><th>Status</th><th>Record action</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function ensureXLSX(){
  return new Promise((res,rej)=>{
    if(window.XLSX)return res();
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload=()=>res(); s.onerror=()=>rej(new Error('load failed'));
    document.head.appendChild(s);
  });
}
function clientExportRows(list){
  const header=['Booked at','Name','Email','Phone','Address','Postcode','Area','Service / package','Appt date','Appt time','Booking for','Reason','Gross amount (GBP)','Refund completed (GBP)','Pending refund (GBP)','Net income (GBP)','Payment status','Package status','Confirmed','DNA details'];
  const data=[header];
  list.forEach(b=>{
    const payStatus = b.status==='cancelled'?'Cancelled':(b.status==='refunded'?'Refunded':(b.status==='prepaid'?'Prepaid':(b.paid!==false?'Paid':'Awaiting payment')));
    const isPkg = (typeof aIsPackage==='function' && aIsPackage(b));
    const pkgStatus = isPkg ? (b.status || (b.paid!==false?'In progress':'Pending payment')) : '';
    const gross=Number(b.price||0), refunded=aBookingRefundCompleted(b), pendingRefund=aBookingRefundPending(b), net=Math.max(0,gross-refunded);
    const dnaDetails=aPkgSessions(b).filter(s=>s.status==='dna').map(s=>{
      if(s.dnaType==='package') return `${s.label||'Session'}: DNA — prepaid session used, no extra charge`;
      if(s.dnaType==='unpaid') return `${s.label||'Appointment'}: DNA — £${aMoney(s.dnaFee||50)} fee due`;
      return `${s.label||'Appointment'}: DNA — £${aMoney(s.dnaFee||50)} retained, £${aMoney(s.refundDue||0)} refund ${s.refundCompleted?'completed':'pending'}`;
    }).join(' | ');
    data.push([b.timestamp||'',b.name||'',b.email||'',b.phone||'',b.address||'',b.postcode||'',b.area||'',
      b.appointment||'',b.bookedDate||'',b.bookedTime||b.preferredTime||'',b.bookingFor||'',b.reason||'',gross,refunded,pendingRefund,net,
      payStatus, pkgStatus, (b.confirmed?'Yes':'No'), dnaDetails]);
  });
  return data;
}
function exportFileName(ext){
  const {from,to}=clientFilterRange();
  const range=(from||to)?`_${from||'start'}-to-${to||'today'}`:'';
  return `ccp-clients${range}_${new Date().toISOString().slice(0,10)}.${ext}`;
}
async function exportClientsXLSX(){
  const list=filteredClients();
  if(!list.length){ alert('No clients in this range to export.'); return; }
  try{
    await ensureXLSX();
    const ws=XLSX.utils.aoa_to_sheet(clientExportRows(list));
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Clients');
    XLSX.writeFile(wb,exportFileName('xlsx'));
  }catch(e){
    exportClientsCSV(list); // fallback if the Excel library can't load
  }
}
function exportClientsCSV(list){
  list=list||filteredClients();
  if(!list.length){ alert('No clients in this range to export.'); return; }
  const q=v=>{ v=String(v==null?'':v); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  const csv=clientExportRows(list).map(row=>row.map(q).join(',')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=exportFileName('csv');
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function aConfirmBooking(i){
  const booking = adminBookings[i];
  if(!booking) return;
  try {
    await fetch('/api/update-booking', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ token:adminSessionToken, action:'confirm', bookingId:booking.id })
    });
  } catch(e) {}
  adminBookings[i].confirmed=true;
  renderAdminBookings();
}
async function aMarkPaid(i){
  const booking = adminBookings[i];
  if(!booking) return;
  try {
    await fetch('/api/update-booking', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ token:adminSessionToken, action:'markPaid', bookingId:booking.id })
    });
  } catch(e) {}
  adminBookings[i].paid=!adminBookings[i].paid;
  renderAdminBookings();
}
async function aPurgeBooking(i){
  const booking=adminBookings[i];
  if(!booking) return false;
  const when=booking.bookedDate?` on ${new Date(booking.bookedDate+'T12:00:00').toLocaleDateString('en-GB')}`:'';
  const ok=confirm(`Permanently remove this record?\n\n${booking.name||'Unknown patient'} — ${booking.appointment||'Booking'}${when}\n\nThis removes it from Active Patients, Dashboard, Bookings, Finance, Supabase and future Excel exports. This cannot be undone. Any separate Stripe payment/refund history remains in Stripe.`);
  if(!ok) return false;
  try{
    const res=await fetch('/api/update-booking',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:adminSessionToken,action:'purge',bookingId:booking.id})
    });
    let data={}; try{data=await res.json();}catch(e){}
    if(!res.ok||data.success!==true) throw new Error(data.error||('HTTP '+res.status));
    try{
      localStorage.removeItem(aPkgArchiveKey(booking.id));
      localStorage.removeItem(aPkgKey(booking.id));
    }catch(e){}
    adminBookings.splice(i,1);
    await fetchBookedSlots();
    renderAdminBookings();
    renderClientList();
    updateAdminStats();
    return true;
  }catch(err){
    alert('The record was not removed. '+(err&&err.message?err.message:'Please try syncing and try again.'));
    return false;
  }
}

async function aDeleteBooking(i){
  if(!confirm('Remove this booking record?'))return false;
  const booking=adminBookings[i];
  if(!booking) return false;
  try {
    const res=await fetch('/api/update-booking',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:adminSessionToken,action:'delete',bookingId:booking.id})
    });
    let data={}; try{data=await res.json();}catch(e){}
    if(!res.ok||data.success!==true) throw new Error(data.error||('HTTP '+res.status));
    adminBookings.splice(i,1);
    await fetchBookedSlots();
    renderAdminBookings();
    renderClientList();
    updateAdminStats();
    return true;
  } catch(e) {
    alert('The booking could not be removed. '+(e&&e.message?e.message:'Please try again.'));
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// DNA / MISSED APPOINTMENT WORKFLOW — Stage 1
// Refunds remain manual in Stripe; this records the decision, keeps finance/export
// accurate once a refund is marked completed, and generates/resends communications.
// ══════════════════════════════════════════════════════════════
let dnaSelectedBookingId=null, dnaSelectedSessionIndex=null;
function aSessionCarry(s){
  return {status:s.status,date:s.date,time:s.time,reminderOff:!!s.reminderOff,reminderSent:!!s.reminderSent,
    dnaType:s.dnaType||null,dnaFee:Number(s.dnaFee||0),refundDue:Number(s.refundDue||0),refundCompleted:!!s.refundCompleted,
    refundDate:s.refundDate||null,dnaNoticeSent:!!s.dnaNoticeSent,dnaNoticeSentAt:s.dnaNoticeSentAt||null};
}
function aDnaFundingType(b){ return aPkgSize(b)>1?'package':(b.paid===false?'unpaid':'single_paid'); }
function aOpenDna(id,i){
  const b=adminBookings.find(x=>x.id===id); if(!b)return;
  const s=aPkgSessions(b)[i]; if(!s)return;
  const funding=aDnaFundingType(b), gross=Number(b.price||0), fee=funding==='package'?0:50, refund=funding==='single_paid'?Math.max(0,gross-fee):0;
  const ov=document.createElement('div'); ov.id='dnaConfirmOverlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(20,30,25,.52);z-index:10000;display:flex;align-items:center;justify-content:center;padding:18px';
  const summary=funding==='package'
    ?`This is part of a prepaid package. The appointment will be counted as one purchased session. No extra fee or refund applies.`
    :funding==='unpaid'
      ?`No payment is recorded. A £50 missed-appointment fee can be requested, but it will not count as income until paid.`
      :`Original payment: £${aMoney(gross)} · fee retained: £${aMoney(fee)} · partial refund required: £${aMoney(refund)}.`;
  ov.innerHTML=`<div style="background:#fff;border-radius:16px;padding:22px;width:430px;max-width:100%;font-family:'Outfit',sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.2)">
    <div style="font-family:'Playfair Display',serif;font-size:20px;color:var(--char);margin-bottom:6px">Mark appointment as DNA</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:13px">${aEsc(b.name||'Patient')} · ${aEsc(s.label||'Appointment')} · ${aFmtDay(s.date,s.time)}</div>
    <div style="padding:12px;border-radius:10px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:12px;line-height:1.6;margin-bottom:14px">${summary}</div>
    ${funding==='single_paid'?`<label style="font-size:11px;color:var(--muted)">Fee retained (£)</label><input id="dnaModalFee" type="number" min="0" max="${gross}" value="${fee}" oninput="document.getElementById('dnaModalRefund').textContent=aMoney(Math.max(0,${gross}-Number(this.value||0)))" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid rgba(30,77,59,.2);border-radius:8px;margin:4px 0 8px"><div style="font-size:12px;color:var(--char);margin-bottom:14px">Refund required: <strong>£<span id="dnaModalRefund">${aMoney(refund)}</span></strong></div>`:''}
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button onclick="aConfirmDna('${id}',${i},true)" style="flex:1;min-width:150px;padding:10px;background:#1e4d3b;color:#fff;border:none;border-radius:8px;cursor:pointer">Confirm & generate email</button>
      <button onclick="aConfirmDna('${id}',${i},false)" style="flex:1;min-width:120px;padding:10px;background:#fffbeb;color:#92400e;border:1px solid #fde68a;border-radius:8px;cursor:pointer">Confirm only</button>
      <button onclick="document.getElementById('dnaConfirmOverlay').remove()" style="padding:10px 14px;background:var(--stone);border:none;border-radius:8px;cursor:pointer">Cancel</button>
    </div>
    <div style="font-size:10.5px;color:var(--muted);margin-top:12px;line-height:1.5">This does not issue a Stripe refund automatically. For single prepaid appointments, complete the partial refund in Stripe and then mark it completed from the DNA line on the patient card.</div>
  </div>`;
  document.body.appendChild(ov);
}
async function aConfirmDna(id,i,openEmail){
  const b=adminBookings.find(x=>x.id===id); if(!b)return;
  const sessions=aPkgSessions(b), arr=sessions.map(aSessionCarry), s=sessions[i];
  const funding=aDnaFundingType(b), gross=Number(b.price||0);
  const modalFee=document.getElementById('dnaModalFee');
  const fee=funding==='package'?0:(modalFee?Math.max(0,Number(modalFee.value||0)):50);
  arr[i]={...arr[i],status:'dna',dnaType:funding,dnaFee:funding==='package'?0:fee,
    refundDue:funding==='single_paid'?Math.max(0,gross-fee):0,refundCompleted:false,refundDate:null};
  document.getElementById('dnaConfirmOverlay')?.remove();
  await aPkgSaveOverrides(id,arr);
  if(s.date&&s.time) await apiBlockSlots([], [{date:s.date,time:s.time}]);
  try{await fetchBookedSlots();}catch(e){}
  renderAdminBookings(); renderClientList(); refreshCalendars();
  if(openEmail) openDnaNoticeForSession(id,i);
}
function aDnaSessionLine(b,s,i){
  let msg='';
  if(s.dnaType==='package') msg='Prepaid package session used · no additional charge or refund';
  else if(s.dnaType==='unpaid') msg=`£${aMoney(s.dnaFee||50)} DNA fee due · income is not recorded until paid`;
  else msg=`£${aMoney(s.dnaFee||50)} retained · £${aMoney(s.refundDue||0)} refund ${s.refundCompleted?'completed':'required'}`;
  return `<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding-left:24px;margin-top:7px;font-size:10.5px;color:#92400e">
    <span>⚠ ${msg}</span>
    ${s.refundDue?`<button class="bi-btn" style="background:${s.refundCompleted?'#dcfce7':'#fff7ed'};color:${s.refundCompleted?'#16a34a':'#b45309'};padding:2px 7px;font-size:10px" onclick="aToggleDnaRefund('${b.id}',${i})">${s.refundCompleted?'↩ Undo refund completed':'✓ Mark refund completed'}</button>`:''}
    <button class="bi-btn" style="background:#eef2ff;color:#4338ca;padding:2px 7px;font-size:10px" onclick="openDnaNoticeForSession('${b.id}',${i})">✉️ DNA email</button>
  </div>`;
}
async function aToggleDnaRefund(id,i){
  const b=adminBookings.find(x=>x.id===id); if(!b)return;
  const arr=aPkgSessions(b).map(aSessionCarry); const next=!arr[i].refundCompleted;
  if(next&&!confirm(`Confirm that you have manually refunded £${aMoney(arr[i].refundDue||0)} through Stripe?`))return;
  arr[i].refundCompleted=next; arr[i].refundDate=next?new Date().toISOString():null;
  await aPkgSaveOverrides(id,arr); renderAdminBookings(); renderClientList();
}
function dnaAllAppointments(){
  const out=[];
  adminBookings.forEach(b=>aPkgSessions(b).forEach((s,i)=>{
    if(s.status==='dna') out.push({b,s,i,key:(b.id||'')+'|'+i});
  }));
  return out.sort((x,y)=>String(y.s.date||'').localeCompare(String(x.s.date||'')));
}
let dnaPatientLastMatches=[];
function dnaSearchPatients(){
  const q=(document.getElementById('dnaPatientSearch')?.value||'').trim().toLowerCase();
  const el=document.getElementById('dnaPatientResults');
  if(!el)return;
  if(q.length<1){el.innerHTML='';dnaPatientLastMatches=[];return;}

  const dnaMatches=dnaAllAppointments()
    .filter(x=>[x.b.name,x.b.email,x.b.phone,x.s.label].join(' ').toLowerCase().includes(q))
    .slice(0,5)
    .map(x=>({kind:'dna',...x}));

  const activeMatches=reviewUniquePatients()
    .filter(p=>p.stateKey==='active')
    .filter(p=>p.name.toLowerCase().includes(q)||p.email.toLowerCase().includes(q)||String(p.phone||'').replace(/\s+/g,'').includes(q.replace(/\s+/g,'')))
    .slice(0,8)
    .map(p=>({kind:'patient',patient:p}));

  const seen=new Set(dnaMatches.map(x=>reviewNormaliseName(x.b.name)));
  dnaPatientLastMatches=[...dnaMatches,...activeMatches.filter(x=>!seen.has(reviewNormaliseName(x.patient.name)))].slice(0,10);

  if(!dnaPatientLastMatches.length){
    el.innerHTML='<div style="font-size:11px;color:var(--muted);padding:6px">No active patient or DNA appointment found. You can enter the details manually.</div>';
    return;
  }

  el.innerHTML=dnaPatientLastMatches.map((x,i)=>{
    if(x.kind==='dna'){
      return `<button type="button" onclick="dnaPickSearchResult(${i})" class="review-patient-result" style="display:flex;width:100%;text-align:left;margin-top:4px"><div><strong>${aEsc(x.b.name||'Patient')}</strong><div class="review-result-contact">${aEsc(x.s.label||'Appointment')} · ${aFmtDay(x.s.date,x.s.time)}</div></div><span class="review-result-state">DNA recorded</span></button>`;
    }
    const p=x.patient;
    const contacts=[p.email?'✉️ '+aEsc(p.email):'',p.phone?'📱 '+aEsc(p.phone):''].filter(Boolean).join(' · ')||'No contact details saved';
    return `<button type="button" onclick="dnaPickSearchResult(${i})" class="review-patient-result" style="display:flex;width:100%;text-align:left;margin-top:4px"><div><strong>${aEsc(p.name)}</strong><div class="review-result-contact">${contacts}</div></div><span class="review-result-state">${aEsc(p.state)}</span></button>`;
  }).join('');
}
function dnaPickSearchResult(i){
  const x=dnaPatientLastMatches[i];
  if(!x)return;
  if(x.kind==='dna'){
    dnaSelectAppointment(x.b.id,x.i);
    return;
  }
  const p=x.patient;
  dnaSelectedBookingId=null; dnaSelectedSessionIndex=null;
  document.getElementById('dnaPatientSearch').value=p.name||'';
  document.getElementById('dnaPatientResults').innerHTML='';
  document.getElementById('dnaRecipientEmail').value=p.email||'';
  document.getElementById('dnaRecipientPhone').value=p.phone||'';
  const contact=[p.email,p.phone].filter(Boolean).join(' · ');
  document.getElementById('dnaSelectedPatient').textContent=`Selected active patient: ${p.name}${contact?' · '+contact:''}. Enter or select the missed appointment details below.`;
}
function dnaSelectAppointment(id,i){
  const b=adminBookings.find(x=>x.id===id); if(!b)return; const s=aPkgSessions(b)[i]; if(!s)return;
  dnaSelectedBookingId=id; dnaSelectedSessionIndex=i;
  document.getElementById('dnaPatientSearch').value=b.name||''; document.getElementById('dnaPatientResults').innerHTML='';
  document.getElementById('dnaSelectedPatient').textContent=`Selected: ${b.name||'Patient'} · ${s.label||'Appointment'}`;
  document.getElementById('dnaRecipientEmail').value=b.email||''; document.getElementById('dnaRecipientPhone').value=b.phone||'';
  document.getElementById('dnaAppointmentDate').value=s.date||''; document.getElementById('dnaAppointmentTime').value=(s.time||'').slice(0,5);
  document.getElementById('dnaAppointmentLabel').value=s.label||b.appointment||'';
  document.getElementById('dnaFundingType').value=s.dnaType||aDnaFundingType(b);
  document.getElementById('dnaOriginalAmount').value=Number(b.price||0);
  document.getElementById('dnaFeeRetained').value=Number(s.dnaFee||((s.dnaType||aDnaFundingType(b))==='package'?0:50));
  document.getElementById('dnaRefundDue').value=Number(s.refundDue||0);
  document.getElementById('dnaRefundStatus').value=s.refundCompleted?'completed':(s.refundDue?'required':'not_applicable');
  dnaRecalculate(false);
}
function openDnaNoticeForSession(id,i){
  showAdminSection('programmes');
  setTimeout(()=>{dnaSelectAppointment(id,i); document.getElementById('dnaNoticeCard')?.scrollIntoView({behavior:'smooth',block:'start'});},80);
}
function dnaLooksLikePackageFollowUp(label){
  const text=String(label||'').trim();
  return /\b(?:package|programme|block)\b/i.test(text)
    || /\bfollow[\s-]*up\s*(?:appointment|session)?\s*#?\d+\b/i.test(text)
    || /\bsession\s*#?\d+\s*(?:of|\/)\s*\d+\b/i.test(text);
}
function dnaMaybeInferFundingType(){
  const label=document.getElementById('dnaAppointmentLabel')?.value||'';
  const typeEl=document.getElementById('dnaFundingType');
  if(typeEl && dnaLooksLikePackageFollowUp(label) && typeEl.value!=='package'){
    typeEl.value='package';
    dnaRecalculate(true);
  }
}
function dnaFundingChanged(){
  dnaRecalculate(true);
}
function dnaRecalculate(overwrite=false){
  const type=document.getElementById('dnaFundingType')?.value;
  const gross=Number(document.getElementById('dnaOriginalAmount')?.value||0);
  const feeEl=document.getElementById('dnaFeeRetained');
  const refundEl=document.getElementById('dnaRefundDue');
  const status=document.getElementById('dnaRefundStatus');
  if(!feeEl||!refundEl||!status)return;

  const packageMode=type==='package';
  feeEl.disabled=packageMode;
  feeEl.style.opacity=packageMode?'.65':'1';
  feeEl.style.cursor=packageMode?'not-allowed':'';

  if(packageMode){
    feeEl.value=0;
    refundEl.value='0.00';
    status.value='not_applicable';
  } else if(type==='unpaid'){
    if(overwrite) feeEl.value=50;
    refundEl.value='0.00';
    status.value='not_applicable';
  } else {
    if(overwrite) feeEl.value=50;
    const rawFee=feeEl.value;
    const fee=rawFee===''?0:Math.max(0,Number(rawFee)||0);
    refundEl.value=Math.max(0,gross-fee).toFixed(2);
    if(status.value==='not_applicable')status.value='required';
  }
}
function dnaValues(){
  const name=(document.getElementById('dnaPatientSearch')?.value||'').trim();
  const email=(document.getElementById('dnaRecipientEmail')?.value||'').trim();
  const phone=(document.getElementById('dnaRecipientPhone')?.value||'').trim();
  const label=(document.getElementById('dnaAppointmentLabel')?.value||'appointment').trim();
  let type=document.getElementById('dnaFundingType')?.value||'single_paid';
  if(type==='single_paid' && dnaLooksLikePackageFollowUp(label)) type='package';
  return {name,email,phone,date:document.getElementById('dnaAppointmentDate')?.value||'',time:document.getElementById('dnaAppointmentTime')?.value||'',label,type,gross:Number(document.getElementById('dnaOriginalAmount')?.value||0),fee:type==='package'?0:Number(document.getElementById('dnaFeeRetained')?.value||0),refund:type==='package'?0:Number(document.getElementById('dnaRefundDue')?.value||0),refundStatus:type==='package'?'not_applicable':(document.getElementById('dnaRefundStatus')?.value||'required'),extra:(document.getElementById('dnaExtraMessage')?.value||'').trim()};
}
function dnaBuild(v){
  const first=(v.name||'there').split(/\s+/)[0], dateLabel=v.date?new Date(v.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}):'the scheduled date', timeLabel=v.time?` at ${fmt12(v.time)}`:'';
  let detail='';
  if(v.type==='package') detail=`As this appointment formed part of your prepaid follow-up block or programme, no refund or additional charge applies. The missed appointment has been counted as a used follow-up appointment within the block and cannot be carried over.`;
  else if(v.type==='unpaid') detail=`In line with the cancellation and missed-appointment policy, a fee of £${aMoney(v.fee||50)} is due for the reserved appointment time. Please contact us so that payment or any exceptional circumstances can be discussed.`;
  else detail=`In line with the cancellation and missed-appointment policy, a fee of £${aMoney(v.fee||50)} applies. As £${aMoney(v.gross)} was originally paid, ${v.refundStatus==='completed'?`a partial refund of £${aMoney(v.refund)} has been returned to the original payment method`:`a partial refund of £${aMoney(v.refund)} will be returned to the original payment method`}. Refunds processed through Stripe may take 5–10 working days to appear, depending on your bank.`;
  const extra=v.extra?`\n\n${v.extra}`:'\n\nPlease get in touch if there were exceptional circumstances that you would like us to consider.';
  const subject='Missed physiotherapy appointment — Community Care Physio';
  const body=`Dear ${first},\n\nI’m writing regarding your ${v.label} scheduled for ${dateLabel}${timeLabel}, which was recorded as a missed appointment.\n\n${detail}${extra}\n\n${EMAIL_SIGNATURE}`;
  const sms=`Hi ${first}, I’m writing regarding your missed Community Care Physio appointment on ${dateLabel}${timeLabel}. ${v.type==='package'?'The missed appointment has not been refunded and has been counted as a used follow-up appointment within your prepaid block.':v.type==='unpaid'?`A £${aMoney(v.fee||50)} missed-appointment fee is due.`:`A £${aMoney(v.fee||50)} fee applies and ${v.refundStatus==='completed'?'a': 'the'} £${aMoney(v.refund)} partial refund ${v.refundStatus==='completed'?'has been processed':'will be processed'}.`} Please check your email or contact me if there were exceptional circumstances.\n\nKind regards,\n\nZakery Shelley\nCommunity Care Physio\n${BUSINESS.phone}`;
  return {subject,body,sms};
}
function dnaGenerate(){
  const v=dnaValues(); if(!v.name){alert('Please enter or select the patient name.');return;} const m=dnaBuild(v), out=document.getElementById('dnaOutput');
  const emailOk=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email), phoneOk=!!v.phone;
  out.innerHTML=`<div style="margin-top:16px;padding:16px;background:#fff;border:1px solid rgba(30,77,59,.1);border-radius:12px"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">Subject</div><div style="font-size:13px;font-weight:600;color:var(--char);margin-bottom:12px">${aEsc(m.subject)}</div><div style="white-space:pre-wrap;font-size:12px;line-height:1.65;color:var(--char);padding:12px;background:var(--stone);border-radius:8px">${aEsc(m.body)}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${emailOk?`<button onclick="dnaSendEmail()" style="flex:1;min-width:130px;padding:10px;background:#1e4d3b;color:#fff;border:none;border-radius:8px;cursor:pointer">Send by email</button><a href="${gmailComposeUrl(v.email,m.subject,m.body)}" target="_blank" rel="noopener" style="flex:1;min-width:130px;text-align:center;padding:10px;background:#eef2ff;color:#4338ca;border-radius:8px;text-decoration:none">Open in Gmail</a>`:''}${phoneOk?`<a href="sms:${encodeURIComponent(v.phone)}?&body=${encodeURIComponent(m.sms)}" style="flex:1;min-width:130px;text-align:center;padding:10px;background:#e7f0ea;color:#1e4d3b;border-radius:8px;text-decoration:none">Open SMS draft</a>`:''}</div>${!emailOk&&!phoneOk?'<div style="font-size:11px;color:#b45309;margin-top:8px">Add an email address or mobile number to send this notice.</div>':''}<div id="dnaSendStatus" style="font-size:11px;margin-top:8px;color:var(--muted)"></div></div>`;
}
async function dnaSendEmail(){
  const v=dnaValues(), m=dnaBuild(v); if(!v.email)return;
  if(!confirm(`Send the DNA notice to ${v.name} at ${v.email}?`))return;
  const st=document.getElementById('dnaSendStatus'); if(st)st.textContent='Sending DNA notice…';
  try{
    const r=await fetch('/api/send-patient-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emailType:'dna',token:adminSessionToken,to:v.email,name:v.name,date:v.date,time:v.time,label:v.label,type:v.type,gross:v.gross,fee:v.fee,refund:v.refund,refundStatus:v.refundStatus,extra:v.extra})});
    const d=await r.json().catch(()=>({})); if(!r.ok)throw new Error(d.error||'Email could not be sent');
    if(dnaSelectedBookingId!=null&&dnaSelectedSessionIndex!=null){ const b=adminBookings.find(x=>x.id===dnaSelectedBookingId); if(b){const arr=aPkgSessions(b).map(aSessionCarry); arr[dnaSelectedSessionIndex].dnaNoticeSent=true; arr[dnaSelectedSessionIndex].dnaNoticeSentAt=new Date().toISOString(); await aPkgSaveOverrides(b.id,arr); renderAdminBookings();}}
    if(st){st.style.color='#16a34a';st.textContent='✓ DNA notice sent.';}
  }catch(e){if(st){st.style.color='#dc2626';st.textContent=e.message||'Email could not be sent.';}}
}

// ══════════════════════════════════════════════════════════════
// REUSABLE EMAIL CORE — shared by every admin email template.
// To add a new template later (reminder, discharge, GP letter, review,
// cancellation, DNA): build a subject + body, append EMAIL_SIGNATURE,
// then render with emailActions(subject, body, gmailComposeUrl(to,subject,body)).
// ══════════════════════════════════════════════════════════════

// Gmail always composes from the business account, whatever order accounts
// are signed in on this device (authuser matches by address, not position).
const GMAIL_SENDER = 'infoccphysio@gmail.com';

// Single source of truth for business identity.
const BUSINESS = {
  name: 'Community Care Physio',
  clinician: 'Zakery Shelley',
  website: 'https://www.communitycarephysio.co.uk/',
  email: 'infoccphysio@gmail.com',
  phone: '07508 401627'
};

// The exact sign-off appended to every generated email. Mirrors the Gmail
// "Community Care Physio – Formal" signature (Gmail skips its own signature
// when compose opens with a pre-filled body).
const EMAIL_SIGNATURE =
`Kind regards,

${BUSINESS.clinician}
Physiotherapist
${BUSINESS.name}
Home Visit Physiotherapy · South West London
T: ${BUSINESS.phone}
E: ${BUSINESS.email}
W: www.communitycarephysio.co.uk`;

// Build a Gmail compose URL from the configured account index.
function gmailComposeUrl(to, subject, body){
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(GMAIL_SENDER)}&view=cm&fs=1`
    + `&to=${encodeURIComponent(to||'')}`
    + `&su=${encodeURIComponent(subject)}`
    + `&body=${encodeURIComponent(body)}`;
}

// Base64 helpers that survive emoji / accents / newlines inside button attributes.
function emailB64(s){ return btoa(unescape(encodeURIComponent(s))); }
function emailCopy(btn, data){
  const text = decodeURIComponent(escape(atob(data)));
  navigator.clipboard.writeText(text).then(()=>{
    const o = btn.textContent; btn.textContent = '✓ Copied';
    setTimeout(()=>{ btn.textContent = o; }, 1200);
  });
}

// Send an admin-drafted email from infoccphysio via the server, which adds the
// branded signature and logo. Returns true when sent.
async function emailSendDirect(to, subject, body, attachments){
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to||'').trim())){ alert('This patient has no valid email address. Use Open in Gmail instead.'); return false; }
  if(!confirm(`Send "${subject}" to ${to} from ${GMAIL_SENDER}?`)) return false;
  const r = await fetch('/api/send-patient-email',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({emailType:'custom',token:adminSessionToken,to,subject,body,attachments:attachments||[]})});
  const d = await r.json().catch(()=>({}));
  if(!r.ok){ alert(r.status===401?'Your admin session has expired. Sign out and back in, then try again.':(d.error||'Email could not be sent.')); return false; }
  return true;
}
// Read files chosen in an attachment picker as base64 for the send API.
function emailReadFiles(input){
  return Promise.all(Array.from((input&&input.files)||[]).map(f=>new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res({filename:f.name,contentType:f.type||'application/octet-stream',data:String(r.result).split(',')[1]||''});
    r.onerror=()=>rej(new Error('Could not read '+f.name));
    r.readAsDataURL(f);
  })));
}
async function emailSendBtn(btn, toB, sB, bB, fileInputId, requireFile){
  const dec = x => decodeURIComponent(escape(atob(x)));
  const input = fileInputId ? document.getElementById(fileInputId) : null;
  if(requireFile && !(input && input.files && input.files.length)){ alert('Choose the programme file to attach first.'); return; }
  const o = btn.textContent; btn.disabled = true; btn.textContent = 'Sending…';
  let files = [];
  try{ files = await emailReadFiles(input); }catch(e){ alert(e.message); btn.disabled=false; btn.textContent=o; return; }
  const ok = await emailSendDirect(dec(toB), dec(sB), dec(bB), files);
  btn.textContent = ok ? '✓ Sent from infoccphysio' : o; btn.disabled = ok;
}

// Shared action row: Send (branded, from infoccphysio) + Open in Gmail + Copy subject + Copy body.
// opts.attach: show a file picker; opts.requireFile: block sending without one.
function emailActions(subject, body, gmailUrl, to, opts){
  const s = emailB64(subject), b = emailB64(body);
  const canSend = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to||'').trim());
  const fid = opts && opts.attach ? 'emailAttach'+Math.random().toString(36).slice(2,8) : '';
  return `${fid&&canSend?`<label style="display:block;margin-top:10px;font-size:11px;color:var(--muted)">Attach file(s) — PDF, Word, PNG or JPG, 3 MB total<input type="file" id="${fid}" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" style="display:block;margin-top:4px;font-size:12px"></label>`:''}<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      ${canSend?`<button onclick="emailSendBtn(this,'${emailB64(to)}','${s}','${b}','${fid}',${!!(opts&&opts.requireFile)})" style="flex:1 1 100%;padding:11px;background:#1e4d3b;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif">✉️ Send from infoccphysio (with signature)</button>`:''}
      <a href="${gmailUrl}" target="_blank" rel="noopener" style="flex:1;min-width:130px;text-align:center;padding:10px;background:#eef3ef;color:#1e4d3b;border-radius:8px;font-size:12px;font-weight:500;text-decoration:none">Open in Gmail</a>
      <button onclick="emailCopy(this,'${s}')" style="flex:1;min-width:110px;padding:10px;background:var(--stone);border:none;border-radius:8px;font-size:12px;cursor:pointer;font-family:'Outfit',sans-serif">📋 Copy subject</button>
      <button onclick="emailCopy(this,'${b}')" style="flex:1;min-width:110px;padding:10px;background:var(--stone);border:none;border-radius:8px;font-size:12px;cursor:pointer;font-family:'Outfit',sans-serif">📋 Copy body</button>
    </div>`;
}

// ── CANCELLATION with 24-hour fee check ──
// Works out if the appointment is within 24h. If so, drafts a £50-fee email;
// otherwise a plain cancellation email. Either way it opens in YOUR Gmail for
// you to review and send — nothing is auto-sent and no charge is auto-taken.
function aCancelBooking(i){
  const b = adminBookings[i];
  if(!b) return;
  const firstName = (b.name||'there').split(' ')[0];
  let within24 = null;

  // Try to auto-calculate from a firm date + time
  if(b.bookedDate && b.bookedTime && /^\d{1,2}:\d{2}/.test(b.bookedTime)){
    const apptTime = new Date(b.bookedDate+'T'+b.bookedTime.slice(0,5)+':00').getTime();
    if(!isNaN(apptTime)){
      const hoursUntil = (apptTime - Date.now())/(1000*60*60);
      within24 = hoursUntil < 24; // includes already-past appointments
    }
  }

  // If we couldn't work it out, ask
  if(within24 === null){
    within24 = confirm("Couldn't auto-detect the appointment time.\n\nIs this appointment within the next 24 hours (i.e. the £50 late-cancellation fee applies)?\n\nOK = yes, within 24h (fee applies)\nCancel = no, more than 24h away (no fee)");
  }

  const apptLabel = b.bookedDate
    ? new Date(b.bookedDate+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}) + (b.bookedTime?(' at '+fmt12(b.bookedTime.slice(0,5))):'')
    : (b.preferredTime||'your appointment');

  let subject, body;
  if(within24){
    subject = `Cancellation — your appointment on ${apptLabel}`;
    body =
`Hi ${firstName},

I'm confirming the cancellation of your appointment on ${apptLabel}.

As this is within 24 hours of the appointment, our £50 late-cancellation fee applies. Since payment was taken at the time of booking, a partial refund will be issued minus the £50 charge, which can take 5–10 working days to appear on your card via Stripe.

If there were exceptional circumstances (for example a hospital admission), please do let me know on WhatsApp and I'll review this with you.

${EMAIL_SIGNATURE}`;
  } else {
    subject = `Cancellation — your appointment on ${apptLabel}`;
    body =
`Hi ${firstName},

I'm confirming the cancellation of your appointment on ${apptLabel}. As this is more than 24 hours before the appointment, no cancellation fee applies and a full refund will be issued via Stripe (this can take 5–10 working days to appear on your card).

If you'd like to rearrange, just reply here or message me on WhatsApp and we'll find another time.

${EMAIL_SIGNATURE}`;
  }

  const gmailUrl = gmailComposeUrl(b.email||'', subject, body);

  const feeNote = within24
    ? '<span style="color:#dc2626;font-weight:600">Within 24h — £50 fee applies</span>'
    : '<span style="color:#16a34a;font-weight:600">More than 24h — no fee</span>';

  // Show a small panel with the draft + actions
  const panelId = 'aCancelPanel';
  const existing=document.getElementById(panelId);
  if(existing)existing.remove();
  const wrap=document.createElement('div');
  wrap.id=panelId;
  wrap.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  wrap.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;padding:24px;max-height:90vh;overflow:auto">
    <div style="font-family:'Playfair Display',serif;font-size:18px;color:var(--char);margin-bottom:6px">Cancel — ${aEsc(b.name)}</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:4px">${aEsc(apptLabel)}</div>
    <div style="font-size:12px;margin-bottom:14px">${feeNote}</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Draft email (review, then send):</div>
    <textarea readonly style="width:100%;height:190px;padding:10px;border-radius:8px;border:1px solid rgba(30,77,59,.15);font-size:12px;font-family:inherit;box-sizing:border-box;resize:vertical">${body.replace(/</g,'&lt;')}</textarea>
    ${emailActions(subject, body, gmailUrl, b.email)}
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
      <button onclick="aConfirmCancelDelete(${i})" style="flex:1;min-width:150px;padding:10px;background:#fee2e2;color:#dc2626;border:none;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;font-family:'Outfit',sans-serif">Remove booking from calendar</button>
    </div>
    <div style="text-align:center;margin-top:12px"><button onclick="document.getElementById('${panelId}').remove()" style="background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;text-decoration:underline">Close without changes</button></div>
    <div style="font-size:10px;color:var(--muted);margin-top:10px;line-height:1.5">Nothing is auto-sent and no charge is auto-taken. You send the email yourself, and issue any refund manually in Stripe.</div>
  </div>`;
  document.body.appendChild(wrap);
}

async function aConfirmCancelDelete(i){
  document.getElementById('aCancelPanel')?.remove();
  await aDeleteBooking(i);
}
function updateAdminStats(){
  const m=getAdminOperationalMetrics();
  const today=document.getElementById('aStatToday');
  const outstanding=document.getElementById('aStatOutstanding');
  const toBook=document.getElementById('aStatToBook');
  if(today) today.textContent=m.todayAppts.length;
  if(outstanding) outstanding.textContent=m.outstandingCount;
  if(toBook) toBook.textContent=m.sessionsToBook;

  const todaySub=document.getElementById('aStatTodaySub');
  const outSub=document.getElementById('aStatOutstandingSub');
  const bookSub=document.getElementById('aStatToBookSub');
  if(todaySub) todaySub.textContent=m.nextToday?`Next: ${fmt12(m.nextToday.time)} · ${m.nextToday.name||'Appointment'}`:'No appointments today';
  if(outSub) outSub.textContent=m.outstandingCount?`${aMoney(m.outstandingTotal)} outstanding`:'No outstanding payments';
  if(bookSub) bookSub.textContent=m.sessionsToBook?'Purchased programme sessions without a date':'All purchased sessions scheduled';
  try{renderDashboard();}catch(e){}
}

// ── ADMIN ROTA EDITOR ──
// Always mirror the live rota published in this file, so updates carry over automatically.
// Admin rota: prefer the rota saved in this browser, else the baked-in default.
// fetchLiveRota() overwrites this with the PUBLISHED rota from Supabase as soon as
// it arrives, so the admin calendar and the public homepage always agree.
let adminROTA=(function(){
  try{
    const saved=JSON.parse(localStorage.getItem('ccp_rota')||'null');
    if(saved && typeof saved==='object' && !Array.isArray(saved) && Object.keys(saved).length) return saved;
  }catch(e){}
  return Object.assign({},ROTA);
})();
// If the live rota already arrived before this script loaded, it wins (same as
// when fetchLiveRota finishes later and updates adminROTA directly).
if((window.CCP_ADMIN_STATE.rota||{}).status==='published'){
  adminROTA=Object.assign({},ROTA);
  try{localStorage.setItem('ccp_rota',JSON.stringify(adminROTA));}catch(e){}
}

function aShiftLabel(slots){
  if(!slots||!slots.length)return'';
  if(slots[0]==='18:30')return'Eve';
  if(slots[0]==='09:00'&&slots.length<=2)return'Late';
  return'Full';
}

let aRotaPage=0; // 0 = current+next month, increments by 2

function aRotaPageNav(dir){
  const today=ukToday();
  const keys=Object.keys(adminROTA).sort();
  let endY=today.getFullYear(), endM=today.getMonth();
  if(keys.length){ const last=keys[keys.length-1]; endY=parseInt(last.slice(0,4)); endM=parseInt(last.slice(5,7))-1; }
  const totalMonths=(endY-today.getFullYear())*12+(endM-today.getMonth())+1;
  const maxPage=Math.max(0,Math.ceil(totalMonths/2)-1);
  aRotaPage=Math.min(maxPage,Math.max(0,aRotaPage+dir));
  renderAdminRota();
}

function renderAdminRota(){
  const today=ukToday();
  // Two months per page, starting from current month + (page*2)
  const baseY=today.getFullYear(), baseM=today.getMonth();
  const starts=[];
  for(let i=0;i<2;i++){
    let mo=baseM + aRotaPage*2 + i;
    let yr=baseY + Math.floor(mo/12);
    mo=((mo%12)+12)%12;
    starts.push([yr,mo]);
  }
  // Work out if next/prev pages exist
  const keys=Object.keys(adminROTA).sort();
  let endY=today.getFullYear(), endM=today.getMonth();
  if(keys.length){ const last=keys[keys.length-1]; endY=parseInt(last.slice(0,4)); endM=parseInt(last.slice(5,7))-1; }
  const totalMonths=(endY-today.getFullYear())*12+(endM-today.getMonth())+1;
  const maxPage=Math.max(0,Math.ceil(totalMonths/2)-1);
  const prevDisabled=aRotaPage<=0;
  const nextDisabled=aRotaPage>=maxPage;

  let html=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <button type="button" onclick="aRotaPageNav(-1)" ${prevDisabled?'disabled':''} style="padding:6px 14px;border-radius:8px;border:none;font-size:12px;cursor:${prevDisabled?'not-allowed':'pointer'};background:${prevDisabled?'#eee':'var(--stone)'};color:${prevDisabled?'#bbb':'var(--char)'};font-family:'Outfit',sans-serif">‹ Previous</button>
    <span style="font-size:11px;color:var(--muted)">Showing 2 months</span>
    <button type="button" onclick="aRotaPageNav(1)" ${nextDisabled?'disabled':''} style="padding:6px 14px;border-radius:8px;border:none;font-size:12px;cursor:${nextDisabled?'not-allowed':'pointer'};background:${nextDisabled?'#eee':'var(--stone)'};color:${nextDisabled?'#bbb':'var(--char)'};font-family:'Outfit',sans-serif">Next ›</button>
  </div>`;
  starts.forEach(([yr,mo])=>{
    const monthName=new Date(yr,mo,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});
    const firstDow=new Date(yr,mo,1).getDay();
    const dim=new Date(yr,mo+1,0).getDate();
    const offset=(firstDow+6)%7;
    html+=`<div class="a-rota-month"><div class="a-rota-month-title">${monthName}</div>
    <div class="a-rota-grid">
    <div class="a-rota-dh">Mo</div><div class="a-rota-dh">Tu</div><div class="a-rota-dh">We</div><div class="a-rota-dh">Th</div><div class="a-rota-dh">Fr</div><div class="a-rota-dh">Sa</div><div class="a-rota-dh">Su</div>`;
    for(let i=0;i<offset;i++)html+=`<div class="a-rota-day empty"></div>`;
    for(let d=1;d<=dim;d++){
      const key=`${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dt=new Date(yr,mo,d);
      const past=dt<today;
      const slots=adminROTA[key];
      const lbl=slots?aShiftLabel(slots):'';
      // Standalone bookings only — packages are counted via packageApptsOnDate below
      // (using their CURRENT session dates), so counting them here as well would
      // double them up and leave a phantom on any rescheduled appointment's old date.
      const dayBookings=adminBookings.filter(b=>b.bookedDate===key && !b.activeOnly && !aIsPackage(b));
      const dayCount=dayBookings.length + packageApptsOnDate(key).length;
      const bookingBadge=dayCount>0?`<div style="background:#1e4d3b;color:#fff;border-radius:50%;width:26px;height:26px;font-size:12px;display:flex;align-items:center;justify-content:center;font-weight:600;margin-top:3px">${dayCount}</div>`:'';
      if(past)html+=`<div class="a-rota-day unavail">${d}${bookingBadge}</div>`;
      else if(slots)html+=`<div class="a-rota-day avail" onclick="aDayClick('${key}')" title="${dayCount} booking(s) — click to manage">${d}<div class="a-rota-shift">${lbl}</div>${bookingBadge}</div>`;
      else html+=`<div class="a-rota-day" onclick="aDayClick('${key}')" title="Click to add availability">${d}${bookingBadge}</div>`;
    }
    html+=`</div></div>`;
  });
  document.getElementById('aRotaDisplay').innerHTML=html;
}

// All package follow-up appointments falling on a given date (non-cancelled, scheduled).
function packageApptsOnDate(key){
  const out=[];
  adminBookings.filter(b=>aIsPackage(b)).forEach(b=>{
    aPkgSessions(b).forEach((s,i)=>{
      if(s.date===key && s.time && !['cancelled','dna','expired','unscheduled'].includes(s.status)){
        out.push({ name:b.name||'Patient', time:s.time, label:s.label||('Follow-up '+(i+1)), status:s.status, pkg:b.appointment||'Package' });
      }
    });
  });
  return out;
}
function aDayClick(key){
  // Standalone bookings only; package appointments are listed separately (dayPkg)
  // from their CURRENT session dates, so they never double up on the old date.
  const dayBookings=adminBookings.filter(b=>b.bookedDate===key && !b.activeOnly && !aIsPackage(b));
  const dayPkg=packageApptsOnDate(key);
  const hasSlots=adminROTA[key];
  const d=new Date(key+'T12:00:00');
  const label=d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});

  // Build day detail panel
  let html=`<div style="background:#fff;border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:20px;margin-top:12px" id="aDayPanel">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-size:14px;font-weight:500;color:var(--char)">${label}</div>
      <button onclick="document.getElementById('aDayPanel').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--muted)">×</button>
    </div>`;

  if(dayBookings.length>0 || dayPkg.length>0){
    html+=`<div style="margin-bottom:14px">`;
    dayBookings.forEach((b,i)=>{
      const idx=adminBookings.indexOf(b);
      html+=`<div style="padding:10px;background:var(--fp);border-radius:8px;margin-bottom:8px;font-size:12px">
        <div style="font-weight:500;color:var(--char)">${aEsc(b.name)} — ${aEsc(b.bookedTime||b.preferredTime)||'TBC'}</div>
        <div style="color:var(--muted);margin-top:2px">${aEsc(b.appointment)} · £${b.price} · ${b.paid?'✓ Paid':'⏳ Unpaid'}</div>
        <div style="color:var(--muted)">${aEsc(b.phone)} · ${aEsc(b.email)||'—'}</div>
        <button onclick="aDeleteBooking(${idx});document.getElementById('aDayPanel').remove()" style="margin-top:6px;background:#fee2e2;color:#dc2626;border:none;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer">✕ Cancel booking</button>
      </div>`;
    });
    dayPkg.forEach(p=>{
      html+=`<div style="padding:10px;background:#f0fdf4;border:1px solid rgba(30,77,59,.12);border-radius:8px;margin-bottom:8px;font-size:12px">
        <div style="font-weight:500;color:var(--char)">${aEsc(p.name)} — ${fmt12(p.time)}</div>
        <div style="color:var(--muted);margin-top:2px">${aEsc(p.label)} · ${aEsc(p.pkg)} · <span style="text-transform:capitalize">${p.status}</span></div>
        <div style="color:var(--muted);font-size:11px;margin-top:2px">Manage in the patient's package card above.</div>
      </div>`;
    });
    html+=`</div>`;
    if(dayBookings.length>0){
      html+=`<button onclick="aCancelDay('${key}')" style="width:100%;padding:10px;background:#fee2e2;color:#dc2626;border:none;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;margin-bottom:8px">✕ Cancel standalone bookings & make unavailable</button>`;
    }
  } else {
    html+=`<p style="font-size:12px;color:var(--muted);margin-bottom:12px">No bookings on this day.</p>`;
  }

  if(hasSlots){
    html+=`<button onclick="aRemoveDate('${key}');document.getElementById('aDayPanel').remove()" style="width:100%;padding:10px;background:var(--stone);border:none;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer">Remove from availability</button>`;
  } else {
    html+=`<div style="display:flex;gap:8px;margin-top:4px">
      <select id="aDayShift" style="flex:1;padding:8px;border-radius:8px;border:0.5px solid var(--color-border-secondary);font-size:12px">
        <option value="FULL">Full day</option>
        <option value="E">Early shift (eve)</option>
        <option value="L">Late shift (morning)</option>
      </select>
      <button onclick="aAddDateFromPanel('${key}')" style="padding:8px 14px;background:#1e4d3b;color:#fff;border:none;border-radius:8px;font-size:12px;cursor:pointer">+ Add</button>
    </div>`;
  }
  html+=`</div>`;

  // Remove any existing panel then insert
  const existing=document.getElementById('aDayPanel');
  if(existing)existing.remove();
  document.getElementById('aRotaDisplay').insertAdjacentHTML('afterend',html);
  document.getElementById('aDayPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function aCancelDay(key){
  if(!confirm(`Cancel all bookings on ${key} and remove from availability?`))return;
  // Delete standalone bookings for this day only — packages must be cancelled from
  // their own card so we never wipe a whole episode of care by clicking a date.
  const dayBookings=adminBookings.filter(b=>b.bookedDate===key && !b.activeOnly && !aIsPackage(b));
  for(const b of dayBookings){
    const idx=adminBookings.indexOf(b);
    if(b.id){
      await fetch('/api/update-booking',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({token:adminSessionToken,action:'delete',bookingId:b.id})});
    }
    adminBookings.splice(idx,1);
  }
  // Remove from rota
  delete adminROTA[key];
  aSaveRota();
  await fetchBookedSlots();
  renderAdminRota();
  updateAdminStats();
  renderAdminBookings();
  const panel=document.getElementById('aDayPanel');
  if(panel)panel.remove();
}

function aAddDateFromPanel(key){
  const s=document.getElementById('aDayShift').value;
  const map={FULL:FULL_SL,E:E_SL,L:L_SL};
  adminROTA[key]=map[s];
  aSaveRota();
  renderAdminRota();
  const panel=document.getElementById('aDayPanel');
  if(panel)panel.remove();
}

function aRemoveDate(key){
  if(!confirm(`Remove ${key} from availability?`))return;
  delete adminROTA[key];
  aSaveRota();
  renderAdminRota();
}
function aAddDate(){
  const d=document.getElementById('aAddDateInput').value;
  const s=document.getElementById('aAddShiftInput').value;
  if(!d)return alert('Please select a date.');
  const map={FULL:FULL_SL,E:E_SL,L:L_SL};
  adminROTA[d]=map[s];
  aSaveRota();
  renderAdminRota();
  document.getElementById('aAddDateInput').value='';
}
function aExportRota(){
  const lines=Object.entries(adminROTA).sort().map(([k,v])=>{
    let name='FULL_SL';
    if(JSON.stringify(v)===JSON.stringify(E_SL))name='E_SL';
    else if(JSON.stringify(v)===JSON.stringify(L_SL))name='L_SL';
    return `  '${k}':${name}`;
  });
  const txt='const ROTA={\n'+lines.join(',\n')+'\n};';
  navigator.clipboard.writeText(txt).then(()=>alert('Rota copied! Send to Claude to update index.html on GitHub.'));
}
// Saves the rota to your browser AND auto-publishes to the live site so the public
// calendar reflects add/remove edits immediately (no separate Publish click needed).
function aSaveRota(){
  try{localStorage.setItem('ccp_rota',JSON.stringify(adminROTA));}catch(e){}
  try{ROTA=Object.assign({},adminROTA);}catch(e){}
  try{
    fetch('/api/availability',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:adminSessionToken,action:'save-rota',rota:adminROTA})
    }).then(async r=>{
      let data={};try{data=await r.json();}catch(_){}
      if(r.ok){
        window.CCP_ADMIN_STATE.rota={status:'published',updatedAt:data.updatedAt||new Date().toISOString(),days:Number.isFinite(data.days)?data.days:Object.keys(adminROTA).length};
        renderSettings();
      }else{
        console.warn('rota auto-publish failed: HTTP',r.status);
        const dbg=document.getElementById('aDebug');
        if(dbg)dbg.innerHTML='<span style="color:#b45309">Rota change saved here, but publishing to the live site failed'
          +(r.status===401?' — your admin session expired. Sign out and back in, then use “Publish rota to live site”.':' (HTTP '+r.status+'). Try the “Publish rota to live site” button.')
          +'</span>';
      }
    }).catch(()=>{});
  }catch(e){}
}
// Publish the current admin rota straight to the live site (Supabase) — no GitHub step.
async function aPublishRota(btn){
  const original=btn?btn.textContent:'';
  if(btn){btn.textContent='Publishing…';btn.disabled=true;}
  try{
    const res=await fetch('/api/availability',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:adminSessionToken,action:'save-rota',rota:adminROTA})
    });
    let data={};try{data=await res.json();}catch(_){}
    if(res.status===401){
      alert('Your admin session expired — sign out and back in, then try again.');
    }else if(!res.ok){
      alert('Could not publish: '+(data.error||('HTTP '+res.status))+'\n(Make sure availability.js is uploaded to api/ and the site_config table exists.)');
    }else{
      window.CCP_ADMIN_STATE.rota={status:'published',updatedAt:data.updatedAt||new Date().toISOString(),days:Number.isFinite(data.days)?data.days:Object.keys(adminROTA).length};
      renderSettings();
      alert('Rota published to the live site. The public calendar will show it within a minute.');
    }
  }catch(e){
    alert('Could not reach the server: '+e.message);
  }
  if(btn){btn.textContent=original||'☁️ Publish rota to live site';btn.disabled=false;}
}

// ── CUSTOM FOLLOW-UP BOOKING TOOL ──
// Per-session base prices (pounds). Standard = 45 min, Extended = 60 min.
const CB_PRICES = {
  standard: { normal: 75,  complex: 90  },   // 45 min — complex adds £15
  extended: { normal: 90,  complex: 105 }    // 60 min — complex adds £15
};
const CB_OUT_OF_AREA = 15; // per session
let cbSessions = [];       // {date, time, length}
let cbPatient = null;      // {name, email, phone}

// Unique patient key: email first, else phone (digits only), else name.
// Merges all of a patient's bookings/packages into ONE dropdown entry.
function patientKey(b){
  const email=(b.email||'').trim().toLowerCase();
  const phone=(b.phone||'').replace(/\D/g,'');
  return email || phone || (b.name||'').trim().toLowerCase();
}
function cbSearchPatients(){
  const q = document.getElementById('cbPatientSearch').value.trim().toLowerCase();
  const box = document.getElementById('cbPatientResults');
  if(!q){ box.innerHTML=''; return; }
  // Unique patients from existing bookings (merged by email/phone)
  const seen = {};
  const matches = [];
  adminBookings.forEach(b=>{
    if(!b.name) return;
    const key = patientKey(b);
    if(seen[key]) return;
    if(b.name.toLowerCase().includes(q)){
      seen[key] = true;
      matches.push({ name:b.name, email:b.email||'', phone:b.phone||'' });
    }
  });
  if(!matches.length){ box.innerHTML='<div style="font-size:11px;color:var(--muted);padding:4px 0">No match — you can still type a name and add sessions.</div>'; return; }
  box.innerHTML = matches.slice(0,6).map((m,i)=>
    `<div onclick="cbPickPatient(${i})" data-idx="${i}" style="padding:7px 10px;background:#fff;border:1px solid rgba(30,77,59,.15);border-radius:7px;margin-top:4px;font-size:12px;cursor:pointer">${aEsc(m.name)} <span style="color:var(--muted)">· ${aEsc(m.email)||'no email'}</span></div>`
  ).join('');
  cbLastMatches = matches;
}
let cbLastMatches = [];
function cbPickPatient(i){
  cbPatient = cbLastMatches[i];
  document.getElementById('cbPatientResults').innerHTML = '';
  document.getElementById('cbPatientSearch').value = cbPatient.name;
  document.getElementById('cbSelectedPatient').textContent =
    `Selected: ${cbPatient.name}${cbPatient.email?' ('+cbPatient.email+')':''}`;
}

// Admin mini-calendar state
let cbCalYear, cbCalMonth, cbPickedDate='', cbPickedTime='';
const CB_ALL_SLOTS=['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','18:30','19:00','19:30','20:00'];

function cbInitCal(){
  const t=ukToday();
  cbCalYear=t.getFullYear(); cbCalMonth=t.getMonth();
  cbPickedDate=''; cbPickedTime='';
  cbRenderCal();
  document.getElementById('cbTimeWrap').style.display='none';
  document.getElementById('cbSelectedSlot').textContent='Pick a date and time below';
}

function cbCalNav(dir){
  const t=ukToday();
  let ny=cbCalYear, nm=cbCalMonth+dir;
  if(nm>11){nm=0;ny++;} if(nm<0){nm=11;ny--;}
  if(ny<t.getFullYear()||(ny===t.getFullYear()&&nm<t.getMonth()))return;
  cbCalYear=ny; cbCalMonth=nm; cbRenderCal();
}

function cbRenderCal(){
  const MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('cbCalMonth').textContent=`${MN[cbCalMonth]} ${cbCalYear}`;
  const today=ukToday();
  const firstDow=new Date(cbCalYear,cbCalMonth,1).getDay();
  const dim=new Date(cbCalYear,cbCalMonth+1,0).getDate();
  const offset=(firstDow+6)%7;
  const DH=['Mo','Tu','We','Th','Fr','Sa','Su'];
  let h=DH.map(d=>`<div style="font-size:9px;color:var(--muted);text-align:center;font-weight:500">${d}</div>`).join('');
  for(let i=0;i<offset;i++)h+=`<div></div>`;
  for(let d=1;d<=dim;d++){
    const key=`${cbCalYear}-${String(cbCalMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dt=new Date(cbCalYear,cbCalMonth,d);
    const past=dt<today;
    const sel=cbPickedDate===key;
    if(past){
      h+=`<div style="text-align:center;padding:5px 0;font-size:11px;color:#ccc">${d}</div>`;
    } else {
      h+=`<div onclick="cbPickDate('${key}')" style="text-align:center;padding:5px 0;font-size:11px;border-radius:6px;cursor:pointer;${sel?'background:#1e4d3b;color:#fff;font-weight:600':'background:var(--fp);color:var(--char)'}">${d}</div>`;
    }
  }
  document.getElementById('cbCalGrid').innerHTML=h;
}

function cbPickDate(key){
  cbPickedDate=key; cbPickedTime='';
  cbRenderCal();
  // Which slots does the rota make "normally available" this day?
  const rotaSlots = adminROTA[key] || [];
  const container=document.getElementById('cbTimeSlots');
  container.innerHTML=CB_ALL_SLOTS.map(t=>{
    const inRota = rotaSlots.includes(t);
    const booked = isSlotBooked(key,t);
    if(booked){
      return `<div style="padding:8px 4px;text-align:center;font-size:11px;border-radius:6px;background:#fee2e2;color:#dc2626;opacity:.6;text-decoration:line-through" title="Already booked">${fmt12(t)}</div>`;
    }
    // In-rota = normal green-outline; out-of-rota = greyed with ✗ but still clickable (override)
    const style = inRota
      ? 'background:#fff;border:1px solid #1e4d3b;color:#1e4d3b'
      : 'background:#f1f1f1;border:1px solid #ddd;color:#999';
    const mark = inRota ? '' : ' ✗';
    return `<div onclick="cbPickTime(this,'${t}')" data-time="${t}" style="padding:8px 4px;text-align:center;font-size:11px;border-radius:6px;cursor:pointer;${style}">${fmt12(t)}${mark}</div>`;
  }).join('');
  document.getElementById('cbTimeWrap').style.display='block';
  cbUpdateSelectedLabel();
}

function cbPickTime(el,t){
  cbPickedTime=t;
  document.querySelectorAll('#cbTimeSlots > div').forEach(d=>{
    if(d.dataset.time){ d.style.boxShadow='none'; }
  });
  el.style.boxShadow='0 0 0 2px #1e4d3b';
  cbUpdateSelectedLabel();
}

function cbUpdateSelectedLabel(){
  const lbl=document.getElementById('cbSelectedSlot');
  if(cbPickedDate && cbPickedTime){
    const d=new Date(cbPickedDate+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
    lbl.innerHTML=`<span style="color:var(--forest);font-weight:500">Selected: ${d} at ${fmt12(cbPickedTime)}</span>`;
  } else if(cbPickedDate){
    const d=new Date(cbPickedDate+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
    lbl.innerHTML=`${d} — now pick a time`;
  } else {
    lbl.textContent='Pick a date and time below';
  }
}

function cbAddSession(){
  const length = document.getElementById('cbLength').value;
  if(!cbPickedDate || !cbPickedTime){ alert('Please pick a date and time from the calendar.'); return; }
  cbSessions.push({ date: cbPickedDate, time: cbPickedTime, length });
  // Reset picker for next session
  cbPickedDate=''; cbPickedTime='';
  cbRenderCal();
  document.getElementById('cbTimeWrap').style.display='none';
  cbUpdateSelectedLabel();
  cbRenderSessions();
  cbRecalc();
}

function cbRemoveSession(i){
  cbSessions.splice(i,1);
  cbRenderSessions();
  cbRecalc();
}

function cbRenderSessions(){
  const box = document.getElementById('cbSessionList');
  if(!cbSessions.length){ box.innerHTML='<div style="font-size:12px;color:var(--muted);padding:6px 0">No sessions added yet.</div>'; return; }
  box.innerHTML = cbSessions.map((s,i)=>{
    const d = new Date(s.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
    const t = fmt12(s.time);
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:#fff;border:1px solid rgba(30,77,59,.12);border-radius:8px;margin-bottom:6px;font-size:12px">
      <span>${d} · ${t} · <span style="color:var(--muted)">${s.length} min ${s.length==='60'?'(extended)':'(standard)'}</span></span>
      <button onclick="cbRemoveSession(${i})" style="background:#fee2e2;color:#dc2626;border:none;padding:3px 9px;border-radius:6px;font-size:11px;cursor:pointer">Remove</button>
    </div>`;
  }).join('');
}

function cbBlockDiscount(){
  // Option B tiered block discount, mirroring the website's programme savings.
  const n = cbSessions.length;
  if(n >= 6) return 40;
  if(n >= 4) return 30;
  return 0;
}

function cbCalcSubtotal(){
  const complex = document.getElementById('cbComplex').checked;
  const ooa = document.getElementById('cbOutOfArea').checked;
  let total = 0;
  cbSessions.forEach(s=>{
    const tier = s.length==='60' ? 'extended' : 'standard';
    total += complex ? CB_PRICES[tier].complex : CB_PRICES[tier].normal;
    if(ooa) total += CB_OUT_OF_AREA;
  });
  return total;
}

function cbCalcSuggested(){
  return Math.max(0, cbCalcSubtotal() - cbBlockDiscount());
}

function cbRecalc(){
  const subtotal = cbCalcSubtotal();
  const discount = cbBlockDiscount();
  const suggested = cbCalcSuggested();
  document.getElementById('cbSuggested').textContent = '£'+suggested;
  // Show the extended-session surcharge note when complex is on and a 60-min session exists.
  const extNote=document.getElementById('cbExtNote');
  if(extNote){
    const hasExt=cbSessions.some(s=>s.length==='60');
    const complexOn=document.getElementById('cbComplex').checked;
    extNote.style.display=(hasExt && complexOn)?'block':'none';
  }
  // Show subtotal + discount rows only when a discount actually applies
  const subRow = document.getElementById('cbSubtotalRow');
  const discRow = document.getElementById('cbDiscountRow');
  if(discount > 0){
    document.getElementById('cbSubtotal').textContent = '£'+subtotal;
    document.getElementById('cbDiscount').textContent = '–£'+discount;
    document.getElementById('cbDiscountLabel').textContent = `Block discount (${cbSessions.length} sessions)`;
    subRow.style.display = 'flex';
    discRow.style.display = 'flex';
  } else {
    subRow.style.display = 'none';
    discRow.style.display = 'none';
  }
}

function cbFinalAmount(){
  const override = document.getElementById('cbOverride').value.trim();
  if(override !== '' && !isNaN(Number(override)) && Number(override) > 0){
    return Number(override);
  }
  return cbCalcSuggested();
}

async function cbGenerate(){
  const btn = document.getElementById('cbGenerateBtn');
  const out = document.getElementById('cbOutput');
  if(!cbSessions.length){ alert('Add at least one session first.'); return; }

  const patientName = cbPatient ? cbPatient.name : (document.getElementById('cbPatientSearch').value.trim() || 'there');
  const complex = document.getElementById('cbComplex').checked;
  const confirmOnly = document.getElementById('cbPayStatus').value === 'prepaid';

  // Build the dates list for the email
  const dateLines = cbSessions.map(s=>{
    const d = new Date(s.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
    return `• ${d} at ${fmt12(s.time)} (${s.length} min)`;
  }).join('\n');

  // ── CONFIRMATION-ONLY MODE ── already paid: just draft a confirmation email, no payment link.
  if(confirmOnly){
    const emailBody =
`Hi ${patientName},

Your upcoming physiotherapy appointments are listed below:

${dateLines}

These sessions are already covered under your prepaid treatment package, so there is no further payment required. If you need to rearrange any of them, just reply here or message me on WhatsApp and I'll sort it.

Looking forward to seeing you.

${EMAIL_SIGNATURE}`;
    const subject = `Your upcoming appointments — Community Care Physio`;
    const patientEmail = cbPatient && cbPatient.email ? cbPatient.email : '';
    const gmailUrl = gmailComposeUrl(patientEmail, subject, emailBody);
    out.innerHTML = `
      <div style="background:var(--fp);border:1px solid rgba(30,77,59,.15);border-radius:10px;padding:16px">
        <div style="font-size:12px;font-weight:500;color:var(--char);margin-bottom:8px">✓ Confirmation email ready (no payment requested)</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Draft email (review before sending):</div>
        <textarea readonly style="width:100%;height:200px;padding:10px;border-radius:8px;border:1px solid rgba(30,77,59,.15);font-size:12px;font-family:inherit;box-sizing:border-box;resize:vertical">${emailBody.replace(/</g,'&lt;')}</textarea>
        ${emailActions(subject, emailBody, gmailUrl, patientEmail)}
        <button onclick="cbReset()" style="width:100%;margin-top:10px;padding:10px;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;font-family:'Outfit',sans-serif">✓ Done — clear and start a new booking</button>
      </div>`;
    return;
  }

  const amount = cbFinalAmount();
  if(!amount || amount <= 0){ alert('The total is £0 — add sessions or enter an override amount.'); return; }

  const desc = `Community Care Physio — ${cbSessions.length} ${complex?'complex ':''}session${cbSessions.length>1?'s':''}`;

  // Guard: don't even call Stripe if the admin session has expired.
  if(!adminSessionToken || (adminTokenExpiry && adminTokenExpiry <= Date.now())){
    out.innerHTML = '<div style="background:#fffbeb;border:1px solid #fcd34d;color:#b45309;border-radius:8px;padding:12px;font-size:12px">Your admin session has expired (sessions last 12 hours). Please <strong>Sign out</strong> and sign back in, then try again.</div>';
    return;
  }

  btn.textContent = 'Generating…'; btn.disabled = true;
  out.innerHTML = '';

  try {
    const res = await fetch('/api/create-payment-link', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        token: adminSessionToken,
        amount,
        description: desc,
        patient: cbPatient ? { name: cbPatient.name, email: cbPatient.email||'', phone: cbPatient.phone||'' } : { name: patientName, email:'', phone:'' },
        sessions: cbSessions
      })
    });
    let data={}; try{ data = await res.json(); }catch(_){}

    if(res.status === 401){
      out.innerHTML = '<div style="background:#fffbeb;border:1px solid #fcd34d;color:#b45309;border-radius:8px;padding:12px;font-size:12px;line-height:1.6">Payment link creation was <strong>unauthorised</strong>. Your admin session has most likely expired — <strong>Sign out</strong> and sign back in, then try again.<br><br>If it still fails after re-logging in, the <code>ADMIN_PASSWORD_HASH</code> or <code>STRIPE_SECRET_KEY</code> environment variable in Vercel may be missing or incorrect.</div>';
      btn.textContent = 'Generate payment link & draft email'; btn.disabled = false; return;
    }
    if(!res.ok || !data.url){
      const msg = data.error || `Server error (${res.status})`;
      const stripeHint = /stripe|api key|secret|no such|invalid.*key/i.test(msg)
        ? '<br><br>This looks like a Stripe configuration problem — check that <code>STRIPE_SECRET_KEY</code> is set correctly in Vercel → Settings → Environment Variables.' : '';
      out.innerHTML = `<div style="background:#fef2f2;border:1px solid #fecaca;color:#dc2626;border-radius:8px;padding:12px;font-size:12px;line-height:1.6">Couldn't create the link: ${msg}${stripeHint}</div>`;
      btn.textContent = 'Generate payment link & draft email'; btn.disabled = false; return;
    }

    const emailBody =
`Hi ${patientName},

Following on from our conversation, here are the session dates we agreed:

${dateLines}

Total: £${amount}

You can pay securely here:
${data.url}

Once payment is received I'll confirm the appointments. Any questions, just let me know.

Please note: these appointment slots will be held for 48 hours. If payment has not been received within 48 hours, the slots may be released and made available for other patients.

${EMAIL_SIGNATURE}`;

    const subject = `Your physiotherapy sessions — Community Care Physio`;
    const patientEmail = cbPatient && cbPatient.email ? cbPatient.email : '';
    // Open Gmail compose directly (not the Mac default mail app), from the configured account.
    const gmailUrl = gmailComposeUrl(patientEmail, subject, emailBody);

    out.innerHTML = `
      <div style="background:var(--fp);border:1px solid rgba(30,77,59,.15);border-radius:10px;padding:16px">
        <div style="font-size:12px;font-weight:500;color:var(--char);margin-bottom:8px">✓ Payment link created — £${amount}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Stripe link:</div>
        <div style="background:#fff;border-radius:7px;padding:8px 10px;font-size:11px;word-break:break-all;margin-bottom:12px;border:1px solid rgba(30,77,59,.1)">${data.url}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Draft email (review before sending):</div>
        <textarea readonly style="width:100%;height:200px;padding:10px;border-radius:8px;border:1px solid rgba(30,77,59,.15);font-size:12px;font-family:inherit;box-sizing:border-box;resize:vertical">${emailBody.replace(/</g,'&lt;')}</textarea>
        ${emailActions(subject, emailBody, gmailUrl, patientEmail)}
        <button onclick="cbReset()" style="width:100%;margin-top:10px;padding:10px;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;font-family:'Outfit',sans-serif">✓ Done — clear and start a new booking</button>
      </div>`;
  } catch(err){
    out.innerHTML = `<div style="background:#fef2f2;border:1px solid #fecaca;color:#dc2626;border-radius:8px;padding:12px;font-size:12px;line-height:1.6">Couldn't create the link: ${err.message}.<br><br>This is usually a network issue or the payment endpoint being unavailable — check your connection and that the latest deployment is live, then try again.</div>`;
  }
  btn.textContent = 'Generate payment link & draft email'; btn.disabled = false;
}

// Toggle button label + disable price fields when confirmation-only is on
function cbToggleConfirmOnly(){
  const on = document.getElementById('cbPayStatus').value === 'prepaid';
  const btn = document.getElementById('cbGenerateBtn');
  if(btn) btn.textContent = on ? 'Draft prepaid confirmation email' : 'Generate payment link & draft email';
}

// Clear the custom-booking tool after a booking is done
function cbReset(){
  cbSessions = [];
  cbPatient = null;
  cbPickedDate = ''; cbPickedTime = '';
  const ps = document.getElementById('cbPatientSearch'); if(ps) ps.value='';
  const sp = document.getElementById('cbSelectedPatient'); if(sp) sp.textContent='';
  const cx = document.getElementById('cbComplex'); if(cx) cx.checked=false;
  const oo = document.getElementById('cbOutOfArea'); if(oo) oo.checked=false;
  const co = document.getElementById('cbPayStatus'); if(co) co.value='await';
  const gb = document.getElementById('cbGenerateBtn'); if(gb) gb.textContent='Generate payment link & draft email';
  const ov = document.getElementById('cbOverride'); if(ov) ov.value='';
  const out = document.getElementById('cbOutput'); if(out) out.innerHTML='';
  cbRenderSessions();
  cbRecalc();
  cbInitCal();
  document.getElementById('cbSelectedSlot').textContent='Pick a date and time below';
}

// ── HOME EXERCISE PROGRAMME EMAIL ──
let hepPatient = null, hepLastMatches = [];
function hepSearchPatients(){
  const q = document.getElementById('hepPatientSearch').value.trim().toLowerCase();
  const box = document.getElementById('hepPatientResults');
  if(!q){ box.innerHTML=''; hepLastMatches=[]; return; }
  // Use the same name-based patient records and status rules as the review and
  // DNA generators. Household members may share contact details without sharing
  // one another's Active/Archived status.
  const matches=reviewUniquePatients().filter(p=>
    p.name.toLowerCase().includes(q)||
    p.email.toLowerCase().includes(q)||
    String(p.phone||'').replace(/\s+/g,'').includes(q.replace(/\s+/g,''))
  ).slice(0,8);
  if(!matches.length){ box.innerHTML='<div style="font-size:11px;color:var(--muted);padding:4px 0">No match — you can still type a name.</div>'; hepLastMatches=[]; return; }
  box.innerHTML = matches.map((m,i)=>{
    const contacts=[m.email?'✉️ '+aEsc(m.email):'',m.phone?'📱 '+aEsc(m.phone):''].filter(Boolean).join(' · ')||'No contact details saved';
    return `<button type="button" onclick="hepPickPatient(${i})" class="review-patient-result" style="display:flex;width:100%;text-align:left;margin-top:4px"><div><strong>${aEsc(m.name)}</strong><div class="review-result-contact">${contacts}</div></div><span class="review-result-state">${aEsc(m.state)}</span></button>`;
  }).join('');
  hepLastMatches = matches;
}
function hepPickPatient(i){
  hepPatient = hepLastMatches[i];
  document.getElementById('hepPatientResults').innerHTML='';
  document.getElementById('hepPatientSearch').value = hepPatient.name;
  document.getElementById('hepSelectedPatient').textContent =
    `Selected: ${hepPatient.name}${hepPatient.email?' ('+hepPatient.email+')':''}`;
}
function hepGenerate(){
  const out = document.getElementById('hepOutput');
  const name = hepPatient ? hepPatient.name : (document.getElementById('hepPatientSearch').value.trim() || 'there');
  const extra = document.getElementById('hepExtra').value.trim();
  const subject = 'Your home exercise programme — Community Care Physio';
  const emailBody =
`Hi ${name},

I hope you're keeping well.

Please find your home exercise programme attached.

These exercises are based on what we covered during your physiotherapy session. Please complete them as discussed, keeping the movements slow, controlled and within a comfortable range.

It is normal to feel some mild effort or muscle ache, but please do not push through sharp pain or anything that feels unsafe. If your symptoms significantly worsen, stop the exercises and let me know.${extra ? '\n\n'+extra : ''}

${EMAIL_SIGNATURE}`;
  const patientEmail = hepPatient && hepPatient.email ? hepPatient.email : '';
  const gmailUrl = gmailComposeUrl(patientEmail, subject, emailBody);
  out.innerHTML = `
    <div style="background:var(--fp);border:1px solid rgba(30,77,59,.15);border-radius:10px;padding:16px">
      <div style="font-size:12px;font-weight:500;color:var(--char);margin-bottom:8px">✓ Exercise programme email ready — attach the programme file below, then send</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Draft email (review before sending):</div>
      <textarea readonly style="width:100%;height:220px;padding:10px;border-radius:8px;border:1px solid rgba(30,77,59,.15);font-size:12px;font-family:inherit;box-sizing:border-box;resize:vertical">${emailBody.replace(/</g,'&lt;')}</textarea>
      ${emailActions(subject, emailBody, gmailUrl, patientEmail, {attach:true, requireFile:true})}
    </div>`;
}

// ── GOOGLE REVIEW REQUEST ──
const GOOGLE_REVIEW_LINK='https://www.communitycarephysio.co.uk/review';
let reviewPatient=null, reviewLastMatches=[];
function reviewNormaliseName(value){
  return String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
}
function reviewNormalisePhone(value){
  let p=String(value||'').trim().replace(/[^\d+]/g,'');
  if(p.startsWith('00')) p='+'+p.slice(2);
  if(/^07\d{9}$/.test(p)) p='+44'+p.slice(1);
  else if(/^447\d{9}$/.test(p)) p='+'+p;
  return p;
}
function reviewValidPhone(value){
  return /^\+?[1-9]\d{9,14}$/.test(reviewNormalisePhone(value));
}
function reviewDateIsTodayOrFuture(date,time){
  if(!date) return false;
  const tm=/^\d{2}:\d{2}/.test(String(time||'')) ? String(time).slice(0,5) : '23:59';
  const when=Date.parse(`${date}T${tm}:00`);
  if(!Number.isFinite(when)) return false;
  const today=new Date();
  today.setHours(0,0,0,0);
  return when>=today.getTime();
}
function reviewRecordIsCurrentlyActive(b){
  if(!b) return false;
  const status=String(b.status||'').trim().toLowerCase();
  if(['cancelled','expired'].includes(status)) return false;

  if(typeof aIsPackage==='function' && aIsPackage(b)){
    if((typeof aPkgIsComplete==='function'&&aPkgIsComplete(b)) ||
       (typeof aPkgIsArchived==='function'&&aPkgIsArchived(b))) return false;
    const sessions=typeof aPkgSessions==='function' ? aPkgSessions(b) : [];
    // A package is active only when this named patient still has a scheduled,
    // rescheduled or unbooked session remaining. Completed and DNA sessions are used.
    return sessions.some(s=>s&&!['completed','dna'].includes(String(s.status||'').toLowerCase()));
  }

  if(['completed','dna'].includes(status)) return false;

  const date=b.bookedDate||b.appointmentDate||b.date||'';
  const time=b.bookedTime||b.appointmentTime||b.time||'';
  if(date) return reviewDateIsTodayOrFuture(date,time);

  // Undated records are active only when their own status genuinely indicates
  // that they are awaiting payment/confirmation, not merely because a household
  // member shares the same email address or phone number.
  return ['pending','awaiting','awaiting_payment','confirmed','prepaid','paid','in_progress'].includes(status);
}
function reviewPatientRecordState(records){
  if(records.some(reviewRecordIsCurrentlyActive)) return {key:'active',label:'Active patient'};
  const hasCompletedPackage=records.some(b=>
    typeof aIsPackage==='function' && aIsPackage(b) &&
    ((typeof aPkgIsComplete==='function'&&aPkgIsComplete(b)) ||
     (typeof aPkgIsArchived==='function'&&aPkgIsArchived(b)))
  );
  if(hasCompletedPackage) return {key:'archived',label:'Archived patient'};
  return {key:'history',label:'Patient history'};
}
function reviewUniquePatients(){
  // Group by patient name rather than household email/phone. Different family
  // members can legitimately share one contact address or mobile number.
  const groups=new Map();
  adminBookings.forEach(b=>{
    if(!b || !String(b.name||'').trim()) return;
    const key=reviewNormaliseName(b.name);
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(b);
  });
  return [...groups.values()].map(records=>{
    // Prefer the newest record that contains each contact field.
    const newest=[...records].sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||'')));
    const first=newest[0]||records[0];
    const email=(newest.find(x=>String(x.email||'').trim())||{}).email||'';
    const phone=(newest.find(x=>String(x.phone||'').trim())||{}).phone||'';
    const stateInfo=reviewPatientRecordState(records);
    return {
      id:first.id||'',
      name:first.name||'',
      email:String(email||'').trim(),
      phone:String(phone||'').trim(),
      state:stateInfo.label,
      stateKey:stateInfo.key,
      records
    };
  }).sort((a,b)=>a.name.localeCompare(b.name));
}
function reviewSearchPatients(){
  const input=document.getElementById('reviewPatientSearch');
  const box=document.getElementById('reviewPatientResults');
  if(!input||!box) return;
  const q=input.value.trim().toLowerCase();
  reviewPatient=null;
  const selected=document.getElementById('reviewSelectedPatient');
  if(selected) selected.textContent='';
  if(!q){box.innerHTML='';return;}
  reviewLastMatches=reviewUniquePatients().filter(p=>
    p.name.toLowerCase().includes(q)||
    p.email.toLowerCase().includes(q)||
    String(p.phone||'').replace(/\s+/g,'').includes(q.replace(/\s+/g,''))
  ).slice(0,10);
  if(!reviewLastMatches.length){
    box.innerHTML='<div style="font-size:11px;color:var(--muted);padding:5px 0">No match — you can keep the typed name and enter an email address or mobile number manually.</div>';
    return;
  }
  box.innerHTML=reviewLastMatches.map((p,i)=>{
    const contacts=[p.email?'✉️ '+aEsc(p.email):'',p.phone?'📱 '+aEsc(p.phone):''].filter(Boolean).join(' · ')||'No contact details saved';
    return `<div class="review-patient-result" onclick="reviewPickPatient(${i})"><div><strong>${aEsc(p.name)}</strong><div class="review-result-contact">${contacts}</div></div><span class="review-result-state">${aEsc(p.state)}</span></div>`;
  }).join('');
}
function reviewPickPatient(i){
  reviewPatient=reviewLastMatches[i]||null;
  if(!reviewPatient) return;
  const search=document.getElementById('reviewPatientSearch');
  const email=document.getElementById('reviewRecipientEmail');
  const phone=document.getElementById('reviewRecipientPhone');
  const box=document.getElementById('reviewPatientResults');
  const selected=document.getElementById('reviewSelectedPatient');
  if(search) search.value=reviewPatient.name;
  if(email) email.value=reviewPatient.email||'';
  if(phone) phone.value=reviewPatient.phone||'';
  if(box) box.innerHTML='';
  const contact=[reviewPatient.email,reviewPatient.phone].filter(Boolean).join(' · ');
  if(selected) selected.textContent=`Selected: ${reviewPatient.name}${contact?' ('+contact+')':' — enter an email or mobile number manually'}`;
}
function openReviewRequestForBooking(id){
  const b=adminBookings.find(x=>String(x.id)===String(id));
  adminNav('programmes');
  setTimeout(()=>{
    if(b){
      reviewPatient={id:b.id||'',name:b.name||'',email:b.email||'',phone:b.phone||'',state:'Patient record'};
      const search=document.getElementById('reviewPatientSearch');
      const email=document.getElementById('reviewRecipientEmail');
      const phone=document.getElementById('reviewRecipientPhone');
      const selected=document.getElementById('reviewSelectedPatient');
      if(search) search.value=b.name||'';
      if(email) email.value=b.email||'';
      if(phone) phone.value=b.phone||'';
      const contact=[b.email,b.phone].filter(Boolean).join(' · ');
      if(selected) selected.textContent=`Selected: ${b.name||'Patient'}${contact?' ('+contact+')':' — enter an email or mobile number manually'}`;
    }
    const card=document.getElementById('reviewRequestCard');
    if(card) card.scrollIntoView({behavior:'smooth',block:'start'});
  },80);
}
function reviewDraftValues(){
  const typedName=(document.getElementById('reviewPatientSearch')?.value||'').trim();
  const email=(document.getElementById('reviewRecipientEmail')?.value||'').trim();
  const phoneRaw=(document.getElementById('reviewRecipientPhone')?.value||'').trim();
  const phone=reviewNormalisePhone(phoneRaw);
  const personal=(document.getElementById('reviewPersonalMessage')?.value||'').trim();
  const name=(reviewPatient&&reviewPatient.name)||typedName||'there';
  const first=name==='there'?'there':name.split(/\s+/)[0];
  const subject='Could you share your experience with Community Care Physio?';
  const body=`Dear ${first},

Thank you for choosing Community Care Physio. I hope you found the support you received helpful.${personal?'\n\n'+personal:''}

If you have a moment, I would be very grateful if you could leave a short Google review. Your feedback helps other people find the service and helps us continue to improve.

Leave a review here:
${GOOGLE_REVIEW_LINK}

There is no obligation, and please only include information you are comfortable making public.

${EMAIL_SIGNATURE}`;
  const smsBody=`Hi ${first},\n\nThank you for choosing Community Care Physio. If you have a moment, I would really appreciate a short Google review. Your feedback helps other people find the service.\n\n${GOOGLE_REVIEW_LINK}${personal?'\n\n'+personal:''}\n\nThere is no obligation.\n\nKind regards,\n\nZakery Shelley\nCommunity Care Physio\ncommunitycarephysio.co.uk\ninfoccphysio@gmail.com\n07508 401627`;
  return {name,first,email,phone,phoneRaw,personal,subject,body,smsBody};
}
function reviewSmsUrl(phone,body){
  const clean=reviewNormalisePhone(phone);
  return `sms:${clean}?&body=${encodeURIComponent(body)}`;
}
function reviewGenerate(){
  const out=document.getElementById('reviewOutput');
  const v=reviewDraftValues();
  if(!out) return;
  const validEmail=!!v.email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email);
  const validPhone=reviewValidPhone(v.phone);
  if(!validEmail&&!validPhone){
    out.innerHTML='<div style="margin-top:12px;color:#dc2626;font-size:12px">Please select a patient with an email address or mobile number, or enter at least one valid contact manually.</div>';
    return;
  }
  const gmailUrl=validEmail?gmailComposeUrl(v.email,v.subject,v.body):'#';
  const smsUrl=validPhone?reviewSmsUrl(v.phone,v.smsBody):'#';
  const recipientBits=[validEmail?'✉️ '+aEsc(v.email):'',validPhone?'📱 '+aEsc(v.phone):''].filter(Boolean).join(' · ');
  out.innerHTML=`<div class="review-preview">
    <div class="review-preview-layout">
      <div style="font-size:12px;font-weight:600;color:var(--char);margin-bottom:5px">Review request ready for ${aEsc(v.name)}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${recipientBits}</div>
      <textarea readonly style="width:100%;height:245px;padding:10px;border-radius:8px;border:1px solid rgba(30,77,59,.15);font-size:12px;font-family:inherit;box-sizing:border-box;resize:vertical">${aEsc(v.body)}</textarea>
    </div>
    <div class="review-action-row">
      <button id="reviewSendBtn" class="review-send-btn" onclick="reviewSendEmail()" ${validEmail?'':'disabled'}>✉️ Send by email</button>
      <a id="reviewSmsBtn" class="review-sms-btn${validPhone?'':' is-disabled'}" href="${smsUrl}">📱 Open SMS draft</a>
      <button id="reviewBothBtn" class="review-both-btn" onclick="reviewSendBoth()" ${(validEmail&&validPhone)?'':'disabled'}>✉️📱 Send via both</button>
    </div>
    <div class="review-action-row" style="margin-top:8px">
      <a class="review-secondary-btn${validEmail?'':' is-disabled'}" href="${gmailUrl}" target="_blank" rel="noopener">Open draft in Gmail</a>
      <button class="review-secondary-btn" onclick="navigator.clipboard.writeText(GOOGLE_REVIEW_LINK).then(()=>{this.textContent='✓ Link copied';setTimeout(()=>this.textContent='Copy review link',1200)})">Copy review link</button>
    </div>
    <div id="reviewSendStatus" style="font-size:11.5px;margin-top:10px"></div>
  </div>`;
}
async function reviewSendEmail(options={}){
  const v=reviewDraftValues();
  const btn=document.getElementById('reviewSendBtn');
  const bothBtn=document.getElementById('reviewBothBtn');
  const status=document.getElementById('reviewSendStatus');
  if(!v.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)){alert('Please enter a valid recipient email.');return false;}
  if(!options.skipConfirm&&!confirm(`Send the Google review request to ${v.name} at ${v.email}?`)) return false;
  if(btn){btn.disabled=true;btn.textContent='Sending…';}
  if(bothBtn) bothBtn.disabled=true;
  if(status){status.style.color='var(--muted)';status.textContent='Sending the review request email…';}
  try{
    const res=await fetch('/api/send-patient-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emailType:'review',token:adminSessionToken,to:v.email,name:v.name,personalMessage:v.personal})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'The email could not be sent.');
    if(status){status.style.color='#16a34a';status.textContent='✓ Review request emailed successfully.';}
    if(btn) btn.textContent='✓ Email sent';
    return true;
  }catch(e){
    if(status){status.style.color='#dc2626';status.textContent=e&&e.message?e.message:'The email could not be sent.';}
    if(btn){btn.disabled=false;btn.textContent='✉️ Send by email';}
    if(bothBtn) bothBtn.disabled=false;
    return false;
  }
}
function reviewOpenSms(){
  const v=reviewDraftValues();
  if(!reviewValidPhone(v.phone)){alert('Please enter a valid mobile number.');return false;}
  window.location.href=reviewSmsUrl(v.phone,v.smsBody);
  return true;
}
async function reviewSendBoth(){
  const v=reviewDraftValues();
  if(!v.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)){alert('Please enter a valid recipient email.');return;}
  if(!reviewValidPhone(v.phone)){alert('Please enter a valid mobile number.');return;}
  if(!confirm(`Email the review request to ${v.email} and open an SMS draft for ${v.phone}?`)) return;
  const ok=await reviewSendEmail({skipConfirm:true});
  if(!ok) return;
  const status=document.getElementById('reviewSendStatus');
  if(status){status.style.color='#16a34a';status.textContent='✓ Email sent. Opening the SMS draft for you to review and send.';}
  setTimeout(()=>reviewOpenSms(),250);
}

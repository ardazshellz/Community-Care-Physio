// Admin practice tools: referrals (with authorisation + report tracking), invoices
// to third-party payers, intake & consent links, saved-card fees and Google Drive notes.
// Data lives in practice_records via /api/practice. Uses admin globals from index.html
// (adminBookings, aPkgSessions, emailActions, emailSendDirect, gmailComposeUrl).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const money = (n) => '£' + Number(n || 0).toFixed(2);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ukDate = (iso) => iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const token = () => sessionStorage.getItem('ccp_admin_token');
const bookings = () => (typeof adminBookings !== 'undefined' ? adminBookings : []);

// Agreed HCML-style rates as quick-add presets (editable on each line).
const PRESETS = [
  ['Initial assessment (60 min) incl. complex-needs uplift', 130],
  ['Initial assessment report', 50],
  ['Treatment session (60 min) incl. complex-needs uplift', 105],
  ['Treatment session (45 min) incl. complex-needs uplift', 90],
  ['Progress report', 50],
  ['Discharge report', 50],
  ['Travel charge (per visit)', 35]
];
const REF_STATUS = ['new', 'accepted', 'active', 'declined', 'closed'];

const state = { tab: 'referrals', referrals: [], invoices: [], intakes: [], cards: [], settings: {}, open: null, loaded: false };

async function api(action, extra = {}) {
  const t = token();
  if (!t) throw new Error('Sign in first.');
  const r = await fetch('/api/practice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, token: t, ...extra }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 401 ? 'Your admin session has expired. Sign out and back in.' : d.error || 'Request failed.');
  return d;
}
function status(msg, bad = false) { const el = $('prStatus'); if (el) { el.textContent = msg; el.className = 'eq-status' + (bad ? ' error' : ''); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }

// quiet: background refresh after a bookings sync. It never replaces lists or
// re-renders while a referral or invoice is open, so unsaved edits survive.
async function load(quiet = false) {
  const session = token();
  try {
    const [ref, inv, intake, card, settings] = await Promise.all(['referral', 'invoice', 'intake', 'card', 'settings'].map((kind) => api('list', { kind }).then((d) => (Array.isArray(d) ? d : []))));
    if (!session || token() !== session) return; // signed out while loading
    const editing = quiet && (state.open || state.draft || document.getElementById('prPanel')?.contains(document.activeElement));
    Object.assign(state, { cards: card, loaded: true });
    state.settings = Object.fromEntries(settings.map((r) => [r.key, r.value]));
    if (!editing) { Object.assign(state, { referrals: ref, invoices: inv, intakes: intake }); if (!quiet || isVisible()) render(); }
    navBadge();
  } catch (e) { if (!quiet) status(e.message, true); }
}
function isVisible() { const p = document.getElementById('prPanel'); return !!p && p.style.display !== 'none'; }

// ── Tracking helpers ──
function linkedBooking(ref) { return bookings().find((b) => String(b.id) === String(ref.value.bookingId)); }
function sessionsUsed(ref) {
  const b = linkedBooking(ref);
  if (!b || typeof aPkgSessions !== 'function') return Number(ref.value.sessionsUsedManual || 0);
  // Packages list every visit (the first is the booked date); single bookings count once they are past and paid.
  if (typeof aIsPackage === 'function' && aIsPackage(b)) return aPkgSessions(b).filter((s) => ['completed', 'dna'].includes(s.status)).length;
  return b.paid && b.bookedDate && b.bookedDate < today() && !['cancelled', 'expired', 'refunded'].includes(b.status) ? 1 : 0;
}
function referralAlerts(ref) {
  const v = ref.value, out = [];
  if (['declined', 'closed'].includes(v.status)) return out;
  const auth = Number(v.funding?.authorisedSessions || 0), used = sessionsUsed(ref);
  if (auth && used >= auth) out.push({ bad: true, text: `${v.client?.name}: all ${auth} authorised sessions used — request more funding before booking further sessions.` });
  else if (auth && auth - used === 1) out.push({ bad: false, text: `${v.client?.name}: 1 authorised session left.` });
  (v.reports || []).filter((r) => !r.done && r.due).forEach((r) => {
    if (r.due < today()) out.push({ bad: true, text: `${v.client?.name}: ${r.label} was due ${ukDate(r.due)}.` });
    else if (r.due <= addDays(today(), 3)) out.push({ bad: false, text: `${v.client?.name}: ${r.label} due ${ukDate(r.due)}.` });
  });
  if (v.status === 'new') out.push({ bad: false, text: `New referral ${v.ref || ''} from ${v.referrer?.organisation || v.referrer?.name} — reply within one working day.` });
  return out;
}
function invoiceStatus(inv) { const v = inv.value; return v.status === 'sent' && v.dueDate && v.dueDate < today() ? 'overdue' : v.status || 'draft'; }
function invoiceTotal(v) { return (v.lines || []).reduce((s, l) => s + Math.round(Number(l.qty || 0) * Number(l.unit || 0) * 100) / 100, 0); }
function allAlerts() {
  const a = state.referrals.flatMap(referralAlerts);
  state.invoices.filter((i) => invoiceStatus(i) === 'overdue').forEach((i) => a.push({ bad: true, text: `Invoice ${i.value.number} (${money(invoiceTotal(i.value))}) to ${i.value.payer?.name} is overdue.` }));
  return a;
}
function navBadge() {
  const btn = document.querySelector('.admin-nav-item[data-nav="referrals"]');
  if (!btn) return;
  const n = allAlerts().filter((a) => a.bad).length + state.referrals.filter((r) => r.value.status === 'new').length;
  btn.querySelector('.pr-navcount')?.remove();
  if (n) btn.insertAdjacentHTML('beforeend', `<span class="pr-badge overdue pr-navcount">${n}</span>`);
}

// ── Rendering ──
function render() {
  const root = $('prPanel');
  if (!root) return;
  const tabs = [['referrals', 'Referrals'], ['invoices', 'Invoices'], ['intake', 'Intake & consent'], ['settings', 'Settings']];
  const alerts = allAlerts();
  root.innerHTML = `<div class="eq-top"><h2>Referrals &amp; invoices</h2><button class="eq-btn" data-pr="reload">↻ Reload</button></div>
    <p class="eq-muted">Case-manager and insurer referrals, authorised sessions, report deadlines, invoices, intake forms and saved-card fees.</p>
    ${alerts.length ? `<div class="pr-alerts">${alerts.map((a) => `<div class="pr-alert${a.bad ? ' bad' : ''}">${esc(a.text)}</div>`).join('')}</div>` : ''}
    <div class="pr-tabs">${tabs.map(([k, l]) => `<button class="eq-btn" data-pr="tab" data-k="${k}" aria-pressed="${state.tab === k}">${l}</button>`).join('')}</div>
    <div id="prStatus" class="eq-status" role="status"></div>
    <div id="prBody"></div>`;
  ({ referrals: renderReferrals, invoices: renderInvoices, intake: renderIntake, settings: renderSettingsTab })[state.tab]();
}

function renderReferrals() {
  const body = $('prBody');
  const cur = state.referrals.find((r) => r.key === state.open);
  const list = state.referrals.map((r) => {
    const v = r.value, auth = Number(v.funding?.authorisedSessions || 0);
    return `<button data-pr="open" data-key="${esc(r.key)}" aria-current="${r.key === state.open}"><strong>${esc(v.client?.name)}</strong><span class="pr-badge ${esc(v.status)}">${esc(v.status)}</span><small>${esc(v.referrer?.organisation || v.referrer?.name)} · ${esc(v.ref || '')}${auth ? ` · ${sessionsUsed(r)}/${auth} sessions` : ''}</small></button>`;
  }).join('') || '<p class="eq-muted">No referrals yet. Referrals from the website form appear here, or add one manually.</p>';
  body.innerHTML = `<div class="eq-layout"><div><button class="eq-btn primary" data-pr="new-ref">＋ Add referral</button><div class="eq-list">${list}</div></div><div id="prDetail">${cur ? referralEditor(cur) : '<p class="eq-muted">Select a referral.</p>'}</div></div>`;
}

function referralEditor(r) {
  const v = r.value, f = v.funding || {}, c = v.client || {}, rf = v.referrer || {};
  const auth = Number(f.authorisedSessions || 0), used = sessionsUsed(r);
  const opts = bookings().map((b) => `<option value="${esc(b.id)}" ${String(b.id) === String(v.bookingId) ? 'selected' : ''}>${esc(b.name)} — ${esc(b.appointment || '')}</option>`).join('');
  const inv = state.invoices.filter((i) => i.value.referralKey === r.key);
  const reports = (v.reports || []).map((rep, i) => `<tr><td><input data-rep="${i}" data-f="label" value="${esc(rep.label)}"></td><td><input type="date" data-rep="${i}" data-f="due" value="${esc(rep.due || '')}"></td><td><label><input type="checkbox" data-rep="${i}" data-f="done" ${rep.done ? 'checked' : ''}> Done</label></td></tr>`).join('');
  const field = (path, label, val, type = 'text', wide = false) => `<label class="eq-field${wide ? ' eq-wide' : ''}">${label}<input data-path="${path}" type="${type}" value="${esc(val ?? '')}"></label>`;
  return `<section class="eq-section"><h3>${esc(c.name || 'New referral')} <span class="pr-badge ${esc(v.status)}">${esc(v.status)}</span></h3>
    <p class="eq-muted">Ref ${esc(v.ref || '—')} · received ${ukDate((v.submittedAt || r.created_at || '').slice(0, 10))}${v.service?.urgency === 'urgent' ? ' · <strong>URGENT</strong>' : ''}</p>
    <div class="eq-grid">
      <label class="eq-field">Status<select data-path="status">${REF_STATUS.map((s) => `<option ${s === v.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="eq-field">Linked patient (for session counting)<select data-path="bookingId"><option value="">— not linked —</option>${opts}</select></label>
    </div></section>
    <section class="eq-section"><h3>Authorisation</h3>
      <div class="pr-meter" aria-hidden="true"><span style="width:${auth ? Math.min(100, (used / auth) * 100) : 0}%"></span></div>
      <p class="eq-muted"><strong>${used}</strong> of <strong>${auth || '—'}</strong> authorised sessions used${auth ? ` · ${Math.max(0, auth - used)} left` : ''}${linkedBooking(r) ? ' (counted from the linked patient)' : ''}.</p>
      <div class="eq-grid">
        ${field('funding.authorisedSessions', 'Sessions authorised', f.authorisedSessions, 'number')}
        ${linkedBooking(r) ? '' : field('sessionsUsedManual', 'Sessions used (manual, when not linked)', v.sessionsUsedManual, 'number')}
        ${field('funding.caseRef', 'Case / claim reference', f.caseRef)}
        ${field('funding.poNumber', 'PO number', f.poNumber)}
        ${field('funding.payerName', 'Payer', f.payerName)}
        ${field('funding.invoiceEmail', 'Invoice email', f.invoiceEmail, 'email')}
        ${field('funding.invoiceAddress', 'Invoice address', f.invoiceAddress, 'text', true)}
      </div></section>
    <section class="eq-section"><h3>Reports due</h3>
      <table class="pr-lines"><thead><tr><th>Report</th><th>Due</th><th></th></tr></thead><tbody>${reports || '<tr><td colspan="3" class="eq-muted">No reports tracked yet.</td></tr>'}</tbody></table>
      <div class="eq-actions"><button class="eq-btn" data-pr="add-report" data-label="Initial assessment report">＋ Initial report (5 working days)</button><button class="eq-btn" data-pr="add-report" data-label="Progress report">＋ Progress report</button><button class="eq-btn" data-pr="add-report" data-label="Discharge report">＋ Discharge report</button></div></section>
    <section class="eq-section"><h3>Referrer and client</h3><div class="eq-grid">
      ${field('referrer.name', 'Referrer', rf.name)}${field('referrer.organisation', 'Organisation', rf.organisation)}
      ${field('referrer.email', 'Referrer email', rf.email, 'email')}${field('referrer.phone', 'Referrer phone', rf.phone)}
      ${field('client.name', 'Client name', c.name)}${field('client.dob', 'Date of birth', c.dob, 'date')}
      ${field('client.phone', 'Client phone', c.phone)}${field('client.postcode', 'Postcode', c.postcode)}
      ${field('client.address', 'Address', c.address, 'text', true)}
      ${field('client.contactName', 'Appointments contact', c.contactName)}${field('client.contactPhone', 'Contact phone', c.contactPhone)}
      <label class="eq-field eq-wide">Condition / history<textarea data-path="clinical.condition">${esc(v.clinical?.condition)}</textarea></label>
      <label class="eq-field eq-wide">Precautions<textarea data-path="clinical.precautions">${esc(v.clinical?.precautions)}</textarea></label>
      <label class="eq-field eq-wide">Your notes<textarea data-path="notes">${esc(v.notes)}</textarea></label>
    </div></section>
    <div class="eq-actions"><button class="eq-btn primary" data-pr="save-ref">Save referral</button><button class="eq-btn" data-pr="invoice-from-ref">＋ Create invoice</button>${rf.email ? `<button class="eq-btn" data-pr="email-referrer">✉️ Email referrer</button>` : ''}<button class="eq-btn" data-pr="del-ref">Delete</button></div>
    ${inv.length ? `<section class="eq-section"><h3>Invoices for this referral</h3>${inv.map((i) => `<p><button class="eq-btn" data-pr="open-inv" data-key="${esc(i.key)}">${esc(i.value.number)}</button> ${money(invoiceTotal(i.value))} <span class="pr-badge ${invoiceStatus(i)}">${invoiceStatus(i)}</span></p>`).join('')}</section>` : ''}
    <div id="prEmail"></div>`;
}

function readReferral(r) {
  const v = structuredClone(r.value);
  document.querySelectorAll('#prDetail [data-path]').forEach((el) => {
    const path = el.dataset.path.split('.');
    let node = v; path.slice(0, -1).forEach((k) => { node = node[k] = node[k] || {}; });
    let val = el.value.trim();
    if (el.type === 'number') val = val === '' ? null : Number(val);
    node[path[path.length - 1]] = val;
  });
  v.reports = (v.reports || []).map((rep, i) => ({
    label: document.querySelector(`[data-rep="${i}"][data-f="label"]`)?.value.trim() || rep.label,
    due: document.querySelector(`[data-rep="${i}"][data-f="due"]`)?.value || null,
    done: !!document.querySelector(`[data-rep="${i}"][data-f="done"]`)?.checked
  }));
  return v;
}

function renderInvoices() {
  const body = $('prBody');
  const cur = state.invoices.find((i) => i.key === state.open);
  const list = state.invoices.map((i) => `<button data-pr="open-inv" data-key="${esc(i.key)}" aria-current="${i.key === state.open}"><strong>${esc(i.value.number)}</strong><span class="pr-badge ${invoiceStatus(i)}">${invoiceStatus(i)}</span><small>${esc(i.value.payer?.name)} · ${money(invoiceTotal(i.value))} · due ${ukDate(i.value.dueDate)}</small></button>`).join('') || '<p class="eq-muted">No invoices yet.</p>';
  body.innerHTML = `<div class="eq-layout"><div><button class="eq-btn primary" data-pr="new-inv">＋ New invoice</button><div class="eq-list">${list}</div></div><div id="prDetail">${cur ? invoiceEditor(cur) : state.draft ? invoiceEditor({ key: '', value: state.draft }) : '<p class="eq-muted">Select or create an invoice.</p>'}</div></div>`;
}

function invoiceEditor(inv) {
  const v = inv.value, p = v.payer || {}, st = inv.key ? invoiceStatus(inv) : 'draft';
  const lines = (v.lines || []).map((l, i) => `<div class="pr-line"><label class="pr-desc">Description<input data-line="${i}" data-f="description" value="${esc(l.description)}"></label><label>Date<input type="date" data-line="${i}" data-f="date" value="${esc(l.date || '')}"></label><label>Qty<input type="number" step="1" min="0" data-line="${i}" data-f="qty" value="${esc(l.qty)}"></label><label>Unit £<input type="number" step="0.01" min="0" data-line="${i}" data-f="unit" value="${esc(l.unit)}"></label><span class="pr-amt">${money(Number(l.qty) * Number(l.unit))}</span><button class="eq-btn" data-pr="del-line" data-i="${i}" aria-label="Remove line ${i + 1}">✕</button></div>`).join('');
  const field = (path, label, val, type = 'text', wide = false) => `<label class="eq-field${wide ? ' eq-wide' : ''}">${label}<input data-path="${path}" type="${type}" value="${esc(val ?? '')}"></label>`;
  return `<section class="eq-section"><h3>${inv.key ? esc(v.number) : 'New invoice'} <span class="pr-badge ${st}">${st}</span></h3>
    <div class="eq-grid">
      ${field('payer.name', 'Bill to (payer)', p.name)}${field('payer.email', 'Payer email', p.email, 'email')}
      ${field('payer.address', 'Payer address', p.address, 'text', true)}
      ${field('client.name', 'Client', v.client?.name)}${field('caseRef', 'Case / claim reference', v.caseRef)}
      ${field('poNumber', 'PO number', v.poNumber)}
      ${field('issueDate', 'Issue date', v.issueDate, 'date')}${field('dueDate', 'Due date', v.dueDate, 'date')}
      <label class="eq-field">Status<select data-path="status">${['draft', 'sent', 'paid'].map((s) => `<option ${s === (v.status || 'draft') ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      ${field('paidDate', 'Paid date', v.paidDate, 'date')}
    </div></section>
    <section class="eq-section"><h3>Lines</h3>
      ${lines || '<p class="eq-muted">Add a line below.</p>'}
      <p class="pr-total">Total <strong>${money(invoiceTotal(v))}</strong></p>
      <div class="eq-actions"><select id="prPreset" class="eq-search" style="max-width:360px">${PRESETS.map(([d, u], i) => `<option value="${i}">${esc(d)} — ${money(u)}</option>`).join('')}</select><button class="eq-btn" data-pr="add-line">＋ Add line</button><button class="eq-btn" data-pr="add-blank">＋ Blank line</button></div>
      <label class="eq-field eq-wide">Notes on invoice<textarea data-path="notes">${esc(v.notes)}</textarea></label>
    </section>
    <div class="eq-actions"><button class="eq-btn primary" data-pr="save-inv">${inv.key ? 'Save invoice' : 'Create invoice (assigns number)'}</button>${inv.key ? `<button class="eq-btn" data-pr="print-inv">🖨 Print / Save PDF</button><button class="eq-btn" data-pr="email-inv">✉️ Email invoice</button>` : ''}${inv.key && st === 'draft' ? '<button class="eq-btn" data-pr="del-inv">Delete draft</button>' : ''}</div>
    <div id="prEmail"></div>`;
}

function readInvoice(inv) {
  const v = structuredClone(inv.value);
  document.querySelectorAll('#prDetail [data-path]').forEach((el) => {
    const path = el.dataset.path.split('.');
    let node = v; path.slice(0, -1).forEach((k) => { node = node[k] = node[k] || {}; });
    node[path[path.length - 1]] = el.value.trim() || null;
  });
  v.lines = (v.lines || []).map((l, i) => {
    const g = (f) => document.querySelector(`[data-line="${i}"][data-f="${f}"]`)?.value;
    return { date: g('date') || null, description: (g('description') || '').trim(), qty: Number(g('qty') || 0), unit: Number(g('unit') || 0) };
  });
  if (v.status === 'paid' && !v.paidDate) v.paidDate = today();
  return v;
}

function blankInvoice(ref) {
  const s = state.settings['settings:invoice'] || {}, f = ref?.funding || {};
  return {
    payer: { name: f.payerName || ref?.referrer?.organisation || '', email: f.invoiceEmail || ref?.referrer?.email || '', address: f.invoiceAddress || '' },
    client: { name: ref?.client?.name || '' }, caseRef: f.caseRef || '', poNumber: f.poNumber || '',
    issueDate: today(), dueDate: addDays(today(), Number(s.paymentTermsDays || 30)), status: 'draft', lines: [], notes: '',
    referralKey: ref ? state.open : null
  };
}

function invoiceHtml(v) {
  const s = state.settings['settings:invoice'] || {};
  const rows = (v.lines || []).map((l) => `<tr><td>${esc(ukDate(l.date))}</td><td>${esc(l.description)}</td><td class="n">${esc(l.qty)}</td><td class="n">${money(l.unit)}</td><td class="n">${money(l.qty * l.unit)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invoice ${esc(v.number)}</title><style>
    @page{size:A4;margin:16mm}body{font-family:Arial,sans-serif;color:#1a1f1d;font-size:13px;line-height:1.5}
    .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1e4d3b;padding-bottom:12px;margin-bottom:18px}
    h1{font-family:Georgia,serif;color:#1e4d3b;margin:0;font-size:26px}.muted{color:#586860}
    table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}th{background:#e8f2ee;color:#1e4d3b}.n{text-align:right;white-space:nowrap}
    .tot td{font-weight:bold;border-top:2px solid #1e4d3b}.grid{display:flex;gap:40px}.box{background:#f8f5f0;padding:12px;border-radius:8px;margin-top:16px}
  </style></head><body>
  <div class="top"><div><h1>Invoice</h1><div class="muted">${esc(v.number)}</div></div><img src="/assets/email-signature.png" alt="Community Care Physio" style="width:210px;border-radius:6px"></div>
  <div class="grid"><div><strong>From</strong><br>${esc(s.businessName || 'Community Care Physio')}<br>${esc(s.address || '114 Durnsford Road, London SW19 8HQ').replace(/\n/g, '<br>')}<br>infoccphysio@gmail.com · 07508 401627</div>
  <div><strong>Bill to</strong><br>${esc(v.payer?.name)}<br>${esc(v.payer?.address || '').replace(/\n/g, '<br>')}<br>${esc(v.payer?.email || '')}</div>
  <div><strong>Issue date:</strong> ${ukDate(v.issueDate)}<br><strong>Due date:</strong> ${ukDate(v.dueDate)}<br>${v.caseRef ? `<strong>Claim ref:</strong> ${esc(v.caseRef)}<br>` : ''}${v.poNumber ? `<strong>PO:</strong> ${esc(v.poNumber)}<br>` : ''}${v.client?.name ? `<strong>Client:</strong> ${esc(v.client.name)}` : ''}</div></div>
  <table><thead><tr><th>Date</th><th>Description</th><th class="n">Qty</th><th class="n">Unit</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody>
  <tfoot><tr class="tot"><td colspan="4" class="n">Total due</td><td class="n">${money(invoiceTotal(v))}</td></tr></tfoot></table>
  <p class="muted">${esc(s.vatNote || 'VAT not applicable — physiotherapy services are exempt.')}</p>
  ${v.notes ? `<p>${esc(v.notes).replace(/\n/g, '<br>')}</p>` : ''}
  <div class="box"><strong>Payment by bank transfer</strong><br>Account name: ${esc(s.accountName || '[set in Settings]')}<br>Sort code: ${esc(s.sortCode || '[set in Settings]')} · Account number: ${esc(s.accountNumber || '[set in Settings]')}<br>Please quote <strong>${esc(v.number)}</strong>${v.caseRef ? ` and <strong>${esc(v.caseRef)}</strong>` : ''} as the payment reference. Payment terms: ${esc(String(s.paymentTermsDays || 30))} days.</div>
  <p class="muted" style="margin-top:24px">Zakery Shelley, Chartered Physiotherapist · HCPC PH132358 · Community Care Physio</p>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`;
}

function renderIntake() {
  const body = $('prBody');
  const opts = bookings().map((b) => `<option value="${esc(b.id)}">${esc(b.name)}${b.email ? ` (${esc(b.email)})` : ''}</option>`).join('');
  const rows = state.intakes.map((r) => `<tr><td>${esc(r.value.name)}</td><td><span class="pr-badge ${esc(r.value.status)}">${esc(r.value.status)}</span></td><td>${ukDate((r.value.completedAt || r.value.createdAt || '').slice(0, 10))}</td><td>${r.value.status === 'completed' ? `<button class="eq-btn" data-pr="view-intake" data-key="${esc(r.key)}">View answers</button>` : `<button class="eq-btn" data-pr="resend-intake" data-key="${esc(r.key)}">Send link</button>`}</td></tr>`).join('');
  const cur = state.intakes.find((r) => r.key === state.open && r.value.status === 'completed');
  body.innerHTML = `<section class="eq-section"><h3>Send an intake &amp; consent form</h3>
    <p class="eq-muted">Creates a personal link (valid 30 days). The patient completes their health questionnaire and gives consent online before the first visit.</p>
    <div class="eq-grid"><label class="eq-field">Patient<select id="prIntakePatient"><option value="">— choose —</option>${opts}</select></label>
    <label class="eq-field">Or name (not yet a patient)<input id="prIntakeName"></label><label class="eq-field">Email<input id="prIntakeEmail" type="email"></label></div>
    <div class="eq-actions"><button class="eq-btn primary" data-pr="create-intake">Create link</button></div><div id="prEmail"></div></section>
    <section class="eq-section"><h3>Forms</h3><table class="pr-lines"><thead><tr><th>Patient</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="eq-muted">No forms sent yet.</td></tr>'}</tbody></table></section>
    ${cur ? intakeView(cur) : ''}`;
}

function intakeView(r) {
  const a = r.value.response || {};
  const yes = (b) => (b ? 'Yes' : 'No');
  const rows = [
    ['Conditions', (a.conditions || []).join(', ') || 'None ticked'], ['Other conditions / operations', a.surgeries], ['Medications', a.medications], ['Allergies', a.allergies],
    ['Current symptoms flagged', (a.redFlags || []).join(', ') || 'None ticked'], ['Walking aids', a.mobilityAids], ['Home access', a.homeAccess], ['Goals', a.goals],
    ['GP', a.gp], ['Emergency contact', [a.emergencyName, a.emergencyPhone].filter(Boolean).join(' · ')], ['Other information', a.otherInfo],
    ['Consent to assessment & treatment', yes(a.consentAssessment)], ['Consent to records', yes(a.consentData)], ['Cancellation policy acknowledged', yes(a.policyAcknowledged)],
    ['Share with GP', yes(a.consentShareGp)], ['Share reports with referrer', yes(a.consentShareReferrer)], ['Photos for clinical record', yes(a.consentPhotos)],
    ['Signed by', `${a.fullName || ''}${a.signedOnBehalf ? ` (on behalf of patient — ${a.relationship || 'relationship not given'})` : ''}`], ['Signed at', a.signedAt ? new Date(a.signedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : '']
  ];
  return `<section class="eq-section"><h3>${esc(r.value.name)} — intake &amp; consent</h3><dl class="pr-kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd>`).join('')}</dl>
    <div class="eq-actions"><button class="eq-btn" data-pr="print-intake" data-key="${esc(r.key)}">🖨 Print / Save PDF</button></div></section>`;
}

function renderSettingsTab() {
  const s = state.settings['settings:invoice'] || {}, d = state.settings['settings:drive'] || {};
  const f = (id, label, val, type = 'text', wide = false) => `<label class="eq-field${wide ? ' eq-wide' : ''}">${label}<input id="${id}" type="${type}" value="${esc(val ?? '')}" autocomplete="off"></label>`;
  $('prBody').innerHTML = `<section class="eq-section"><h3>Invoice details</h3><p class="eq-muted">Shown on every invoice. Bank details are stored in your private database, not in the website code.</p>
    <div class="eq-grid">${f('psBiz', 'Business name', s.businessName || 'Community Care Physio')}${f('psTerms', 'Payment terms (days)', s.paymentTermsDays || 30, 'number')}
    <label class="eq-field eq-wide">Business address<textarea id="psAddr">${esc(s.address || '114 Durnsford Road\nLondon SW19 8HQ')}</textarea></label>
    ${f('psAccName', 'Account name', s.accountName)}${f('psSort', 'Sort code', s.sortCode)}${f('psAcc', 'Account number', s.accountNumber)}
    ${f('psVat', 'VAT note', s.vatNote || 'VAT not applicable — physiotherapy services are exempt.', 'text', true)}</div>
    <div class="eq-actions"><button class="eq-btn primary" data-pr="save-inv-settings">Save invoice details</button></div></section>
    <section class="eq-section"><h3>Google Drive notes</h3><p class="eq-muted">Connect your Drive once, then the 📝 Notes button on each session creates (or opens) a note in a folder for that patient. Setup steps are in <code>tools/drive-notes/README.md</code>.</p>
    <div class="eq-grid">${f('pdUrl', 'Apps Script web app URL', d.scriptUrl, 'url', true)}${f('pdSecret', 'Shared secret', d.secret)}</div>
    <div class="eq-actions"><button class="eq-btn primary" data-pr="save-drive">Save Drive settings</button><button class="eq-btn" data-pr="gen-secret">Generate secret</button></div></section>`;
}

// ── Actions ──
async function run(fn) { try { await fn(); } catch (e) { status(e.message, true); } }
function upsert(listName, rec) { const l = state[listName]; const i = l.findIndex((x) => x.key === rec.key); if (i < 0) l.unshift(rec); else l[i] = rec; }

document.addEventListener('click', (ev) => {
  const copy = ev.target.closest('#prPanel [data-copy]');
  if (copy) { navigator.clipboard.writeText(copy.dataset.copy).then(() => { copy.textContent = '✓ Copied'; }); return; }
  const btn = ev.target.closest('[data-pr]');
  if (!btn || !btn.closest('#prPanel')) return;
  const a = btn.dataset.pr;
  if (a === 'tab') { state.tab = btn.dataset.k; state.open = null; state.draft = null; render(); return; }
  if (a === 'reload') { run(load); return; }
  if (a === 'open') { state.open = btn.dataset.key; render(); return; }
  if (a === 'new-ref') {
    const key = 'referral:' + crypto.randomUUID();
    state.referrals.unshift({ key, value: { status: 'accepted', ref: 'M-' + Date.now().toString(36).toUpperCase().slice(-6), submittedAt: new Date().toISOString(), referrer: {}, client: {}, clinical: {}, funding: {}, reports: [] }, created_at: new Date().toISOString() });
    state.open = key; render(); status('New referral — fill in the details and Save.'); return;
  }
  const ref = state.referrals.find((r) => r.key === state.open);
  const inv = state.invoices.find((i) => i.key === state.open) || (state.draft ? { key: '', value: state.draft } : null);
  if (a === 'add-report' && ref) {
    ref.value = readReferral(ref);
    const due = btn.dataset.label === 'Initial assessment report' ? workingDaysFrom(today(), 5) : null;
    (ref.value.reports = ref.value.reports || []).push({ label: btn.dataset.label, due, done: false });
    render(); return;
  }
  if (a === 'save-ref' && ref) run(async () => { const d = await api('save', { key: ref.key, value: readReferral(ref) }); upsert('referrals', d); render(); navBadge(); status('Referral saved.'); });
  if (a === 'del-ref' && ref) run(async () => { if (!confirm('Delete this referral? This cannot be undone.')) return; await api('delete', { key: ref.key }).catch((e) => { if (!/not found/i.test(e.message)) throw e; }); state.referrals = state.referrals.filter((r) => r.key !== ref.key); state.open = null; render(); navBadge(); status('Referral deleted.'); });
  if (a === 'invoice-from-ref' && ref) { ref.value = readReferral(ref); state.draft = blankInvoice(ref.value); state.draft.referralKey = ref.key; state.tab = 'invoices'; state.open = null; render(); status('Invoice pre-filled from the referral. Add lines, then create it.'); return; }
  if (a === 'email-referrer' && ref) { const v = ref.value; emailPanel(v.referrer.email, `Referral ${v.ref || ''} — ${v.client?.name || ''} — Community Care Physio`, `Dear ${(v.referrer.name || '').split(' ')[0] || 'colleague'},\n\nThank you for your referral for ${v.client?.name || 'your client'}.\n\n\n\n${typeof EMAIL_SIGNATURE !== 'undefined' ? EMAIL_SIGNATURE : ''}`); return; }
  if (a === 'new-inv') { state.draft = blankInvoice(null); state.open = null; render(); return; }
  if (a === 'open-inv') { state.tab = 'invoices'; state.draft = null; state.open = btn.dataset.key; render(); return; }
  if ((a === 'add-line' || a === 'add-blank') && inv) {
    const v = readInvoice(inv); const [d, u] = a === 'add-line' ? PRESETS[Number($('prPreset').value)] : ['', 0];
    (v.lines = v.lines || []).push({ date: today(), description: d, qty: 1, unit: u });
    if (inv.key) inv.value = v; else state.draft = v; render(); return;
  }
  if (a === 'del-line' && inv) { const v = readInvoice(inv); v.lines.splice(Number(btn.dataset.i), 1); if (inv.key) inv.value = v; else state.draft = v; render(); return; }
  if (a === 'save-inv' && inv) run(async () => {
    const v = readInvoice(inv);
    if (!v.payer?.name) throw new Error('Add who the invoice is for (payer).');
    if (!v.client?.name) throw new Error('Add the client name.');
    if (!v.lines.length) throw new Error('Add at least one line.');
    const d = inv.key ? await api('invoice-save', { key: inv.key, value: v }) : await api('invoice-create', { value: v });
    upsert('invoices', d); state.draft = null; state.open = d.key; render(); navBadge(); status(inv.key ? 'Invoice saved.' : `Invoice ${d.value.number} created.`);
  });
  if (a === 'del-inv' && inv) run(async () => { if (!confirm('Delete this draft invoice?')) return; await api('delete', { key: inv.key }); state.invoices = state.invoices.filter((i) => i.key !== inv.key); state.open = null; render(); status('Draft deleted.'); });
  if ((a === 'print-inv' || a === 'email-inv') && inv) inv.value = readInvoice(inv);
  if (a === 'print-inv' && inv) { const w = window.open('', '_blank'); if (!w) { status('Allow pop-ups to print invoices.', true); return; } w.document.write(invoiceHtml(inv.value)); w.document.close(); return; }
  if (a === 'email-inv' && inv) {
    const v = inv.value;
    emailPanel(v.payer?.email, `Invoice ${v.number}${v.caseRef ? ` — ${v.caseRef}` : ''} — Community Care Physio`,
      `Dear ${v.payer?.name || 'colleague'},\n\nPlease find attached invoice ${v.number}${v.client?.name ? ` for ${v.client.name}` : ''}${v.caseRef ? ` (claim reference ${v.caseRef})` : ''}, for ${money(invoiceTotal(v))}, due by ${ukDate(v.dueDate)}.\n\nPayment details are on the invoice. Please quote ${v.number} as the payment reference.\n\n${typeof EMAIL_SIGNATURE !== 'undefined' ? EMAIL_SIGNATURE : ''}`,
      { attach: true, requireFile: true }, 'Use 🖨 Print / Save PDF first, then attach the PDF below. After sending, set the status to "sent" and save.');
    return;
  }
  if (a === 'create-intake') run(async () => {
    const b = bookings().find((x) => String(x.id) === $('prIntakePatient').value);
    const name = b?.name || $('prIntakeName').value.trim(), email = $('prIntakeEmail').value.trim() || b?.email || '';
    if (!name) throw new Error('Choose a patient or enter a name.');
    const d = await api('intake-create', { bookingId: b?.id || null, name, email });
    await load(); state.tab = 'intake'; render(); intakeEmail(name, email, d.url, b?.phone);
  });
  if (a === 'resend-intake') { const r = state.intakes.find((x) => x.key === btn.dataset.key); if (r) intakeEmail(r.value.name, r.value.email, `https://www.communitycarephysio.co.uk/?intake=${r.key.split(':')[1]}`, bookings().find((b) => String(b.id) === String(r.value.bookingId))?.phone); return; }
  if (a === 'view-intake') { state.open = btn.dataset.key; render(); return; }
  if (a === 'print-intake') { const r = state.intakes.find((x) => x.key === btn.dataset.key); const w = window.open('', '_blank'); if (w && r) { w.document.write(`<!doctype html><title>Intake — ${esc(r.value.name)}</title><body style="font-family:Arial;font-size:13px;max-width:720px;margin:20px auto">${intakeView(r).replace(/<div class="eq-actions">.*?<\/div>/s, '')}<script>onload=()=>print()<\/script></body>`); w.document.close(); } return; }
  if (a === 'save-inv-settings') run(async () => {
    const value = { businessName: $('psBiz').value.trim(), paymentTermsDays: Number($('psTerms').value || 30), address: $('psAddr').value.trim(), accountName: $('psAccName').value.trim(), sortCode: $('psSort').value.trim(), accountNumber: $('psAcc').value.trim(), vatNote: $('psVat').value.trim() };
    const d = await api('save', { key: 'settings:invoice', value }); state.settings['settings:invoice'] = d.value; status('✓ Invoice details saved.');
  });
  if (a === 'gen-secret') { $('pdSecret').value = crypto.randomUUID().replace(/-/g, ''); return; }
  if (a === 'save-drive') run(async () => {
    const url = $('pdUrl').value.trim();
    if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) throw new Error('That does not look like an Apps Script web app URL (https://script.google.com/macros/s/…/exec).');
    const d = await api('save', { key: 'settings:drive', value: { scriptUrl: url, secret: $('pdSecret').value.trim() } }); state.settings['settings:drive'] = d.value; status('✓ Drive settings saved. Test it with the 📝 Notes button on any patient.');
  });
});
document.addEventListener('change', (ev) => {
  // Live-update the running total when an invoice line changes.
  if (ev.target.closest('#prPanel') && ev.target.dataset.line !== undefined) { const inv = state.invoices.find((i) => i.key === state.open); if (inv) inv.value = readInvoice(inv); else if (state.draft) state.draft = readInvoice({ value: state.draft }); render(); }
});

function workingDaysFrom(iso, n) { let d = iso; while (n > 0) { d = addDays(d, 1); const day = new Date(d + 'T12:00:00').getDay(); if (day !== 0 && day !== 6) n--; } return d; }
function emailPanel(to, subject, body, opts, note, extraHtml = '') {
  const el = $('prEmail'); if (!el) return;
  const url = typeof gmailComposeUrl === 'function' ? gmailComposeUrl(to || '', subject, body) : '#';
  el.innerHTML = `<section class="eq-section"><h3>Email</h3>${note ? `<p class="eq-muted">${esc(note)}</p>` : ''}<p class="eq-muted">To: ${esc(to || '— no email address —')}<br>Subject: ${esc(subject)}</p>${extraHtml}<textarea readonly class="eq-search" style="height:180px">${esc(body)}</textarea>${typeof emailActions === 'function' ? emailActions(subject, body, url, to, opts) : ''}</section>`;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function intakeEmail(name, email, url, phone) {
  const first = String(name || '').split(' ')[0] || 'there';
  const mobile = String(phone || '').replace(/[^\d+]/g, '').replace(/^0/, '44').replace(/^\+/, '');
  const wa = `Hi ${first}, before your first physiotherapy visit please complete this short health and consent form (about 5 minutes): ${url} — Zakery, Community Care Physio`;
  const extra = `<div class="eq-actions"><button class="eq-btn" data-copy="${esc(url)}">📋 Copy link</button>${mobile.length >= 11 ? `<a class="eq-btn" href="https://wa.me/${esc(mobile)}?text=${encodeURIComponent(wa)}" target="_blank" rel="noopener">💬 Send by WhatsApp</a>` : ''}</div>`;
  emailPanel(email, 'Before your first visit — Community Care Physio', `Dear ${first},\n\nBefore your first appointment, please complete our short health questionnaire and consent form. It takes about 5 minutes and helps us prepare for your visit safely:\n\n${url}\n\nThe link is personal to you and valid for 30 days. If someone is helping you, they are welcome to complete it on your behalf.\n\n${typeof EMAIL_SIGNATURE !== 'undefined' ? EMAIL_SIGNATURE : ''}`,
    null, 'Personal link (valid 30 days): ' + url, extra);
}

// ── Hooks used from patient cards in index.html ──
async function chargeFee(bookingId, name) {
  try {
    if (!state.loaded) await load();
    const card = state.cards.find((c) => c.key === 'card:' + bookingId);
    if (!card) { alert(`No saved card for ${name}. Cards are saved automatically when a patient pays online (from this update onwards).`); return; }
    const amount = Number(prompt(`Charge ${name}'s saved ${card.value.brand || 'card'} ending ${card.value.last4 || '••••'}.\n\nAmount in £ (e.g. 50):`, '50'));
    if (!amount || amount < 1 || amount > 200) return;
    const reason = (prompt('Reason (shown on the receipt). Include the appointment date, e.g. "Late cancellation fee — 2 Oct". The same patient, amount and reason is only ever charged once.', 'Late cancellation fee') || '').trim();
    if (!reason) return;
    if (!confirm(`Charge £${amount.toFixed(2)} to ${name}'s card for "${reason}"? This takes payment immediately.`)) return;
    const d = await api('charge-fee', { bookingId, amount, reason, idempotencyKey: `fee-${bookingId}-${Math.round(amount * 100)}-${reason.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 80) });
    alert(d.status === 'succeeded' ? `✓ £${amount.toFixed(2)} charged (or already taken earlier for this reason — never twice).` : `Charge status: ${d.status}. Check Stripe before trying again.`);
    load();
  } catch (e) { alert(e.message); }
}
async function notesFor(bookingId, sessionIndex) {
  if (!state.loaded) await load(true);
  const d = state.settings['settings:drive'];
  if (!d?.scriptUrl || !d?.secret) { alert('Connect Google Drive first: Referrals & invoices › Settings › Google Drive notes.'); return; }
  const b = bookings().find((x) => String(x.id) === String(bookingId)); if (!b) return;
  let label = b.appointment || 'Appointment', date = b.bookedDate, time = b.bookedTime;
  if (sessionIndex != null && typeof aPkgSessions === 'function') { const s = aPkgSessions(b)[sessionIndex]; if (s) { label = s.label; date = s.date; time = s.time; } }
  // POST (not GET) so patient names stay out of URLs and browser history.
  const form = document.createElement('form');
  Object.assign(form, { method: 'POST', action: d.scriptUrl, target: '_blank' });
  Object.entries({ secret: d.secret, patient: b.name, programme: b.appointment || '', session: label, date: date || '', time: time || '', bookingId: String(b.id) })
    .forEach(([k, v]) => { const i = document.createElement('input'); Object.assign(i, { type: 'hidden', name: k, value: v }); form.appendChild(i); });
  document.body.appendChild(form); form.submit(); form.remove();
}
async function intakeFor(bookingId) {
  state.tab = 'intake'; state.open = null; state.draft = null;
  if (!state.loaded) await load();
  if (typeof adminNav === 'function') adminNav('referrals');
  render();
  const sel = $('prIntakePatient'); if (sel) sel.value = String(bookingId);
}
function cardBadge(bookingId) { const c = state.cards.find((x) => x.key === 'card:' + bookingId); return c ? `💳 ${esc(c.value.brand || 'Card')} ••${esc(c.value.last4 || '')}` : ''; }

// Sign-out / expiry: drop health data, bank details and the Drive secret from memory and the page.
function clear() {
  Object.assign(state, { tab: 'referrals', referrals: [], invoices: [], intakes: [], cards: [], settings: {}, open: null, draft: null, loaded: false });
  const p = $('prPanel'); if (p) p.innerHTML = '';
  document.querySelector('.pr-navcount')?.remove();
}

window.CCPPractice = { clear, load, render: () => { if (!state.loaded) load(); else render(); }, chargeFee, notesFor, intakeFor, cardBadge, alerts: allAlerts };
if (token()) load();

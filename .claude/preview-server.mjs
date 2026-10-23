// Local preview server: serves the repo statically and fakes /api with FICTIONAL data.
// Never touches Supabase, Stripe or Gmail.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

const records = new Map();
const put = (key, kind, value) => records.set(key, { key, kind, value, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
put('referral:11111111-1111-4111-8111-111111111111', 'referral', { status: 'active', ref: 'R-DEMO01', submittedAt: new Date().toISOString(), bookingId: 'demo-2',
  referrer: { name: 'Alex Example', organisation: 'Example Case Management', role: 'Case Manager', email: 'alex@example.com', phone: '07000 000000' },
  client: { name: 'Pat Demo', dob: '1950-01-01', postcode: 'SW19 1AA', address: '1 Example Road', contactName: 'Sam Demo', contactPhone: '07000 000001' },
  clinical: { condition: 'Fictional example: lower-limb injury after a fall. Reduced balance and endurance.', precautions: 'None known' },
  service: { type: 'assessment-treatment', urgency: 'routine' },
  funding: { caseRef: 'CASE-0001', payerName: 'Example Case Management', invoiceEmail: 'accounts@example.com', invoiceAddress: '2 Example Street, London', authorisedSessions: 4, poNumber: 'PO-77' },
  reports: [{ label: 'Initial assessment report', due: d(-1), done: false }, { label: 'Progress report', due: d(20), done: false }] });
put('referral:66666666-6666-4666-8666-666666666666', 'referral', { status: 'active', ref: 'R-DEMO03', submittedAt: new Date().toISOString(), bookingId: 'cm-1',
  referrer: { name: 'Casey Manager', organisation: 'Example Case Management', role: 'Case Manager', email: 'casey@example.com' },
  client: { name: 'Jordan Fictional', email: 'jordan.f@example.com', postcode: 'SW19 4DD', address: '9 Example Avenue', contactName: 'Casey Fictional', contactPhone: '07000 000010' },
  clinical: { condition: 'Fictional example: deconditioning after a hospital stay.' }, service: { type: 'assessment-treatment', urgency: 'routine' },
  funding: { caseRef: 'CASE-0003', payerName: 'Example Case Management', invoiceEmail: 'accounts@example.com', authorisedSessions: 8 },
  reports: [{ label: 'Progress report', due: d(5), done: false }, { label: 'Discharge report', due: d(40), done: false }] });
put('referral:22222222-2222-4222-8222-222222222222', 'referral', { status: 'new', ref: 'R-DEMO02', submittedAt: new Date().toISOString(),
  referrer: { name: 'Jo Sample', organisation: 'Sample Insurance', email: 'jo@example.com' }, client: { name: 'Chris Fictional' },
  clinical: { condition: 'Fictional example: post-operative knee rehabilitation.' }, service: { type: 'assessment-report', urgency: 'urgent' }, funding: { authorisedSessions: null }, reports: [] });
put('invoice:33333333-3333-4333-8333-333333333333', 'invoice', { number: 'CCP-2026-0001', status: 'sent', payer: { name: 'Example Case Management', email: 'accounts@example.com', address: '2 Example Street, London' },
  client: { name: 'Pat Demo' }, caseRef: 'CASE-0001', poNumber: 'PO-77', issueDate: d(-40), dueDate: d(-10), referralKey: 'referral:11111111-1111-4111-8111-111111111111',
  lines: [{ date: d(-41), description: 'Initial assessment (60 min) incl. complex-needs uplift', qty: 1, unit: 130 }, { date: d(-41), description: 'Travel charge (per visit)', qty: 1, unit: 35 }] });
put('intake:44444444-4444-4444-8444-444444444444', 'intake', { name: 'Pat Demo', email: 'pat@example.com', bookingId: 'demo-2', status: 'completed', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), expiresAt: d(30),
  response: { conditions: ['Arthritis'], medications: 'Fictional medication list', allergies: 'None', redFlags: [], goals: 'Walk to the shops again', mobilityAids: 'Stick', homeAccess: 'Ground floor', gp: 'Example Surgery', emergencyName: 'Sam Demo', emergencyPhone: '07000 000001', consentAssessment: true, consentData: true, policyAcknowledged: true, consentShareGp: true, consentShareReferrer: true, consentPhotos: false, fullName: 'Pat Demo', signedAt: new Date().toISOString() } });
put('intake:55555555-5555-4555-8555-555555555555', 'intake', { name: 'Chris Fictional', email: 'chris@example.com', status: 'pending', createdAt: new Date().toISOString(), expiresAt: d(30) });
put('card:demo-2', 'card', { customer: 'cus_demo', paymentMethod: 'pm_demo', brand: 'visa', last4: '4242', charges: [] });
let invoiceN = 1;

const bookings = [
  { id: 'demo-1', name: 'Taylor Test', email: 'taylor@example.com', phone: '07000 000002', appointment: 'Initial Assessment', bookedDate: d(1), bookedTime: '18:00', price: 145, paid: true, confirmed: true, postcode: 'SW19 2BB', address: '3 Example Close', createdAt: new Date().toISOString(), status: null },
  { id: 'demo-2', name: 'Pat Demo', email: 'pat@example.com', phone: '07000 000003', appointment: 'Block of 4 Sessions', bookedDate: d(-14), bookedTime: '10:00', price: 295, paid: true, confirmed: true, postcode: 'SW19 1AA', address: '1 Example Road', createdAt: new Date().toISOString(), status: 'active',
    customSessions: [{ label: 'Follow-up 1', date: d(-7), time: '10:00', length: 45, status: 'completed' }, { label: 'Follow-up 2', date: d(2), time: '18:00', length: 45, status: 'scheduled' }, { label: 'Follow-up 3', date: null, time: null, status: 'unscheduled' }] },
  { id: 'demo-3', name: 'Robin Example', email: 'robin.example@example.com', phone: '07000 000004', appointment: 'Block of 4 Sessions', bookedDate: d(-40), bookedTime: '18:00', price: 295, paid: true, confirmed: true, postcode: 'SW19 3CC', address: '7 Sample Lane', createdAt: new Date().toISOString(), status: 'active',
    customSessions: [1, 2, 3, 4].map((n) => ({ label: 'Follow-up ' + n, date: d(-40 + n * 7), time: '18:00', length: 45, status: 'completed' })) },
  { id: 'demo-4', name: 'Kim Example', email: 'kim.e@example.com', phone: '07000 000005', appointment: 'Block of 4 Sessions', bookedDate: d(4), bookedTime: '18:00', price: 295, paid: true, confirmed: true, postcode: 'SW19 3CC', address: '7 Sample Lane', createdAt: new Date().toISOString(), status: 'active',
    customSessions: [{ label: 'Follow-up 1', date: d(4), time: '18:00', length: 45, status: 'scheduled' }, { label: 'Follow-up 2', date: null, time: null, status: 'unscheduled' }, { label: 'Follow-up 3', date: null, time: null, status: 'unscheduled' }, { label: 'Follow-up 4', date: null, time: null, status: 'unscheduled' }] },
  // Case managed episode (fictional): initial assessment booked with an email, three
  // invoiced sessions created with only the contact phone. Must draw as ONE card.
  { id: 'cm-0', name: 'Jordan Fictional', email: 'jordan.f@example.com', phone: '', appointment: 'Initial Assessment', bookedDate: d(-15), bookedTime: '11:00', price: 130, paid: true, confirmed: true, postcode: 'SW19 4DD', address: '9 Example Avenue', createdAt: new Date().toISOString(), status: 'completed', bookingFor: 'A patient / resident' },
  ...[[-7, 'completed'], [-1, 'completed'], [0, 'invoiced']].map(([n, status], i) => ({ id: 'cm-' + (i + 1), name: 'Jordan Fictional', email: '', phone: '07000 000010', appointment: 'Extended Session', bookedDate: d(n), bookedTime: '16:00', price: 140, paid: false, confirmed: true, postcode: 'SW19 4DD', address: '9 Example Avenue', createdAt: new Date().toISOString(), status, bookingFor: 'referral', patientType: 'existing', reason: 'Example Case Management R-DEMO03, case ref CASE-0003. Authorised session, invoice Example Case Management, not the client. Appointments via Casey Fictional.' })),
  // Household (fictional): two family members booked with one email. The older
  // completed visit belongs in the live card, never in the archive.
  { id: 'hh-1', name: 'Lee Household', email: 'household@example.com', phone: '07000 000011', appointment: 'Standard Session', bookedDate: d(-90), bookedTime: '14:00', price: 95, paid: true, confirmed: true, postcode: 'SW20 1EE', address: '4 Sample Row', createdAt: new Date().toISOString(), status: 'completed' },
  { id: 'hh-2', name: 'Lee Household', email: 'household@example.com', phone: '07000 000011', appointment: 'Standard Session', bookedDate: d(6), bookedTime: '14:00', price: 95, paid: true, confirmed: true, postcode: 'SW20 1EE', address: '4 Sample Row', createdAt: new Date().toISOString(), status: null },
  { id: 'hh-3', name: 'Ash Household', email: 'household@example.com', phone: '07000 000012', appointment: 'Initial Assessment', bookedDate: d(6), bookedTime: '15:00', price: 145, paid: true, confirmed: true, postcode: 'SW20 1EE', address: '4 Sample Row', createdAt: new Date().toISOString(), status: null },
  // Abandoned checkout pipeline, one row per stage (all fictional).
  { id: 'lead-1', name: 'Morgan Unpaid', email: 'morgan@example.com', phone: '07000 000006', appointment: 'Initial Assessment', bookedDate: d(3), bookedTime: '18:30', price: 145, paid: false, confirmed: false, postcode: 'SW17 7AA', createdAt: new Date(Date.now() - 2 * 3600e3).toISOString(), status: 'abandoned', leadEmails: 1, bookingFor: 'A patient / resident', reason: 'Fictional: knee pain after a fall' },
  { id: 'lead-2', name: 'Sam Dayfour', email: 'sam.d@example.com', phone: '07000 000007', appointment: 'Full Programme', bookedDate: d(5), bookedTime: '19:00', price: 615, paid: false, confirmed: false, postcode: 'SW16 1BB', createdAt: new Date(Date.now() - 4 * 86400e3).toISOString(), status: 'abandoned', leadEmails: 2, bookingFor: 'A family member' },
  { id: 'lead-3', name: 'Jo Weekold', email: 'jo.w@example.com', phone: '07000 000008', appointment: 'Standard Session', bookedDate: d(-2), bookedTime: '18:00', price: 95, paid: false, confirmed: false, postcode: 'SW19 8CC', createdAt: new Date(Date.now() - 10 * 86400e3).toISOString(), status: 'lead', leadEmails: 2, bookingFor: 'A patient / resident' },
  { id: 'lead-4', name: 'Alex Noemail', email: '', phone: '07000 000009', appointment: 'Initial Assessment', bookedDate: null, bookedTime: null, price: 145, paid: false, confirmed: false, postcode: 'SW18 2DD', createdAt: new Date(Date.now() - 9 * 86400e3).toISOString(), status: 'abandoned', leadEmails: 0, bookingFor: 'A patient / resident' },
  { id: 'lead-5', name: 'Enquiry Hidden', email: 'e@example.com', phone: '', appointment: 'Initial Assessment', price: 145, paid: false, confirmed: false, createdAt: new Date(Date.now() - 12 * 86400e3).toISOString(), status: 'lead', leadEmails: 0, bookingFor: 'enquiry' }
];

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });

async function practice(req, res) {
  const b = await readBody(req);
  const admin = b.token === 'preview-token';
  const a = b.action;
  if (a === 'referral') { const ref = 'R-' + crypto.randomBytes(3).toString('hex').toUpperCase(); if (!b.data?.referrer?.email || !b.data?.client?.name || !b.data?.consent) return json(res, 400, { error: 'Please complete the required fields.' }); put('referral:' + crypto.randomUUID(), 'referral', { ...b.data, status: 'new', ref, submittedAt: new Date().toISOString() }); return json(res, 200, { ok: true, ref }); }
  if (a === 'intake-get') { const r = records.get('intake:' + b.token); if (!r) return json(res, 404, { error: 'Not found' }); return json(res, 200, { firstName: r.value.name.split(' ')[0], status: r.value.status }); }
  if (a === 'intake-submit') { const r = records.get('intake:' + b.token); if (!r) return json(res, 404, { error: 'Not found' }); if (r.value.status === 'completed') return json(res, 409, { error: 'This form has already been submitted.' }); r.value = { ...r.value, status: 'completed', completedAt: new Date().toISOString(), response: { ...b.data, signedAt: new Date().toISOString() } }; return json(res, 200, { ok: true }); }
  if (!admin) return json(res, 401, { error: 'Unauthorised' });
  if (a === 'list') return json(res, 200, [...records.values()].filter((r) => r.kind === b.kind).reverse());
  if (a === 'save') { const kind = b.key.split(':')[0]; put(b.key, kind, b.value); return json(res, 200, records.get(b.key)); }
  if (a === 'invoice-create') { const key = 'invoice:' + crypto.randomUUID(); invoiceN++; put(key, 'invoice', { ...b.value, number: `CCP-2026-${String(invoiceN).padStart(4, '0')}` }); return json(res, 200, records.get(key)); }
  if (a === 'invoice-save') { const old = records.get(b.key); put(b.key, 'invoice', { ...b.value, number: old.value.number }); return json(res, 200, records.get(b.key)); }
  if (a === 'outcome-save') { const key = b.key || ('outcome:' + crypto.randomUUID()); const v = { ...b.value, patientKey: String(b.value.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), createdAt: records.get(key)?.value?.createdAt || new Date().toISOString() }; put(key, 'outcome', v); return json(res, 200, records.get(key)); }
  if (a === 'delete') { records.delete(b.key); return json(res, 200, { ok: true }); }
  if (a === 'intake-create') { const t = crypto.randomUUID(); put('intake:' + t, 'intake', { name: b.name, email: b.email, bookingId: b.bookingId, status: 'pending', createdAt: new Date().toISOString(), expiresAt: d(30) }); return json(res, 200, { token: t, url: `http://localhost:${PORT}/?intake=${t}` }); }
  if (a === 'charge-fee') return json(res, 200, { ok: true, status: 'succeeded' });
  return json(res, 400, { error: 'Unknown action' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/practice') return practice(req, res);
  if (url.pathname === '/api/admin-login') return json(res, 200, { success: true, token: 'preview-token', expiresAt: Date.now() + 8 * 3600e3 });
  if (url.pathname === '/api/get-bookings') { const b = await readBody(req); if (b.action === 'enquiries') return json(res, 200, { enquiries: [] }); return json(res, 200, { bookings, bookedSlots: {} }); }
  if (url.pathname === '/api/availability') { const rota = {}; for (let i = 0; i < 40; i++) rota[d(i)] = ['18:00', '18:30', '19:00', '19:30']; return json(res, 200, { rota }); }
  if (url.pathname === '/api/get-slots') return json(res, 200, { bookedSlots: {} });
  if (url.pathname === '/api/update-booking') { const b = await readBody(req); const row = bookings.find((x) => x.id === b.bookingId);
    if (b.action === 'create' && b.booking) { const nb = { ...b.booking, id: 'new-' + Date.now().toString(36), paid: false, confirmed: true, status: 'invoiced', createdAt: new Date().toISOString() }; bookings.push(nb); return json(res, 200, { success: true, bookingId: nb.id }); }
    if (row && b.action === 'markLead') row.status = 'lead';
    if (row && b.action === 'restore') { row.status = null; row.confirmed = true; return json(res, 200, { success: true, clash: row.id === 'lead-2' }); }
    if (row && ['delete', 'purge'].includes(b.action)) bookings.splice(bookings.indexOf(row), 1);
    return json(res, 200, { success: true }); }
  if (url.pathname.startsWith('/api/')) return json(res, 200, { success: true });
  if (url.pathname.startsWith('/_vercel/')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(''); }
  let file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
  if (!file.startsWith(ROOT) || file.includes('/_local-only/')) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data); });
}).listen(PORT, () => console.log('preview on http://localhost:' + PORT));

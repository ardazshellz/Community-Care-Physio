// Local preview server: serves the repo statically and fakes /api with FICTIONAL data.
// Never touches Supabase, Stripe or Gmail.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = '/Users/ardazshellz/Documents/Community Care Physio';
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
    customSessions: [{ label: 'Follow-up 1', date: d(4), time: '18:00', length: 45, status: 'scheduled' }, { label: 'Follow-up 2', date: null, time: null, status: 'unscheduled' }, { label: 'Follow-up 3', date: null, time: null, status: 'unscheduled' }, { label: 'Follow-up 4', date: null, time: null, status: 'unscheduled' }] }
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
  if (url.pathname.startsWith('/api/')) return json(res, 200, { success: true });
  if (url.pathname.startsWith('/_vercel/')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(''); }
  let file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
  if (!file.startsWith(ROOT) || file.includes('/_local-only/')) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data); });
}).listen(PORT, () => console.log('preview on http://localhost:' + PORT));

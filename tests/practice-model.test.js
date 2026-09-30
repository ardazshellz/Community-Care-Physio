import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { cleanReferral, cleanIntake, cleanInvoice, formatInvoiceNumber, invoiceTotals, invoiceStatus } from '../lib/practice-model.js';
import { createPracticeHandler } from '../api/practice.js';
import { customEmail } from '../api/send-patient-email.js';
import { textToHtml, wrapHtml, SIGNATURE_TEXT, SIGNATURE_HTML } from '../lib/mailer.js';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
function referral() {
  return {
    referrer: { name: ' Fictional Referrer ', email: 'referrer@example.test', organisation: 'Example Clinic' },
    client: { name: ' Fictional Patient ', dob: '2000-02-29' },
    clinical: { condition: ' Example condition ' },
    service: { type: 'assessment-report', urgency: 'urgent' },
    funding: { authorisedSessions: 4, reportDue: '2026-10-31' }, consent: true
  };
}
function intake() {
  return { fullName: ' Fictional Signatory ', consentAssessment: true, consentData: true,
    policyAcknowledged: true, conditions: ['Example condition'], redFlags: [], goals: 'Example goal' };
}
function invoice() {
  return { payer: { name: 'Example Payer', email: 'payer@example.test', address: 'Fictional address' },
    client: { name: 'Example Client' }, issueDate: '2026-09-30', dueDate: '2026-10-30',
    lines: [{ date: '2026-09-30', description: 'Example assessment', qty: 1, unit: 100 }], status: 'draft' };
}

test('referral validates, trims and strips unexpected fields without mutating input', () => {
  const input = referral();
  input.referrer.secret = 'discard'; input.status = 'accepted';
  const output = cleanReferral(input);
  assert.equal(output.referrer.name, 'Fictional Referrer');
  assert.equal(output.client.name, 'Fictional Patient');
  assert.equal(output.clinical.condition, 'Example condition');
  assert.equal(output.referrer.secret, undefined);
  assert.equal(output.status, undefined);
  assert.equal(output.funding.authorisedSessions, 4);
  assert.equal(input.client.name, ' Fictional Patient ');
});

test('referral enforces all required fields and explicit consent', () => {
  for (const path of ['referrer.name', 'referrer.email', 'client.name', 'clinical.condition']) {
    const value = referral(); const [group, field] = path.split('.'); value[group][field] = ' ';
    assert.throws(() => cleanReferral(value), Error, path);
  }
  for (const consent of [false, 'true', 1, null, undefined]) assert.throws(() => cleanReferral({ ...referral(), consent }));
  for (const value of [null, [], '', { ...referral(), referrer: [] }]) assert.throws(() => cleanReferral(value));
});

test('referral rejects invalid email, enums, dates, lengths and session counts', () => {
  for (const [group, field, value] of [
    ['referrer', 'email', 'bad'], ['referrer', 'email', 'a@example.test,b@example.test'],
    ['referrer', 'email', 'a@example.test\r\nBcc: b@example.test'],
    ['referrer', 'name', 'x'.repeat(201)], ['clinical', 'precautions', 'x'.repeat(4001)],
    ['service', 'type', 'invalid'], ['service', 'urgency', 'immediate'],
    ['client', 'dob', '2025-02-29'], ['funding', 'reportDue', '2026-13-01'],
    ['funding', 'authorisedSessions', -1], ['funding', 'authorisedSessions', 1.5],
    ['funding', 'authorisedSessions', '4'], ['funding', 'invoiceEmail', '<a@example.test>']
  ]) {
    const input = referral(); input[group][field] = value;
    assert.throws(() => cleanReferral(input), Error, `${group}.${field}`);
  }
});

test('referral optional groups have safe defaults and permit documented bounds', () => {
  const input = referral(); delete input.service; delete input.funding;
  input.clinical.condition = 'x'.repeat(4000); input.referrer.name = 'x'.repeat(200);
  const clean = cleanReferral(input);
  assert.equal(clean.service.urgency, 'routine'); assert.equal(clean.service.type, 'other');
  assert.equal(clean.funding.authorisedSessions, null); assert.equal(clean.funding.reportDue, null);
});

test('intake validates signature and consent, strips client timestamps and health extras', () => {
  const value = cleanIntake({ ...intake(), signedAt: 'forged', completedAt: 'forged', privateExtra: 'drop' });
  assert.equal(value.fullName, 'Fictional Signatory');
  assert.equal(value.consentPhotos, false); assert.equal(value.signedAt, undefined);
  assert.equal(value.completedAt, undefined); assert.equal(value.privateExtra, undefined);
  assert.deepEqual(value.conditions, ['Example condition']);
});

test('intake requires true consent flags and a typed signature', () => {
  for (const field of ['consentAssessment', 'consentData', 'policyAcknowledged']) {
    for (const value of [false, 'true', undefined]) assert.throws(() => cleanIntake({ ...intake(), [field]: value }));
  }
  for (const fullName of ['', null, 42, 'x'.repeat(201)]) assert.throws(() => cleanIntake({ ...intake(), fullName }));
  assert.throws(() => cleanIntake(null));
});

test('intake bounds arrays, text, booleans and signatures on behalf of a patient', () => {
  for (const patch of [
    { conditions: Array(41).fill('Example') }, { conditions: ['x'.repeat(101)] },
    { conditions: [42] }, { redFlags: 'Example' }, { redFlags: Array(41).fill('Example') },
    { goals: 'x'.repeat(4001) }, { gp: {} }, { consentPhotos: 'false' },
    { signedOnBehalf: true }, { signedOnBehalf: 'true' }
  ]) assert.throws(() => cleanIntake({ ...intake(), ...patch }));
  const value = cleanIntake({ ...intake(), signedOnBehalf: true, relationship: ' Parent ',
    conditions: Array(40).fill('x'.repeat(100)), otherInfo: 'x'.repeat(4000) });
  assert.equal(value.relationship, 'Parent');
});

test('invoice numbers are padded without truncating large sequence numbers', () => {
  assert.equal(formatInvoiceNumber(1, 2026), 'CCP-2026-0001');
  assert.equal(formatInvoiceNumber(10000, 2027), 'CCP-2027-10000');
  for (const n of [0, -1, 1.5, NaN, Infinity, '1']) assert.throws(() => formatInvoiceNumber(n, 2026));
  for (const year of [26, '2026', NaN, 10000]) assert.throws(() => formatInvoiceNumber(1, year));
});

test('invoice totals round each decimal product to pennies and sum in integer pence', () => {
  assert.deepEqual(invoiceTotals([{ qty: 3, unit: 0.1 }, { qty: 1, unit: 0.2 }]), { subtotal: 0.5, total: 0.5 });
  assert.deepEqual(invoiceTotals([{ qty: 1, unit: 1.005 }, { qty: 1, unit: 2.675 }]), { subtotal: 3.69, total: 3.69 });
  assert.equal(invoiceTotals([{ qty: 0.1, unit: 0.05 }, { qty: 0.1, unit: 0.05 }]).total, 0.02);
  assert.equal(invoiceTotals([{ qty: 1e-7, unit: 1e7 }]).total, 1);
  assert.deepEqual(invoiceTotals([]), { subtotal: 0, total: 0 });
  assert.equal(invoiceTotals([{ qty: 0, unit: 10 }]).total, 0);
});

test('invoice totals reject negatives, coercion, non-finite values, overflow and oversized lists', () => {
  for (const value of [-1, NaN, Infinity, '1', null, undefined]) {
    assert.throws(() => invoiceTotals([{ qty: value, unit: 1 }]));
    assert.throws(() => invoiceTotals([{ qty: 1, unit: value }]));
  }
  assert.throws(() => invoiceTotals([{ qty: Number.MAX_VALUE, unit: Number.MAX_VALUE }]));
  assert.throws(() => invoiceTotals(Array(101).fill({ qty: 1, unit: 1 })));
  assert.throws(() => invoiceTotals(null)); assert.throws(() => invoiceTotals([null]));
});

test('invoice status becomes overdue only after the due date and only when sent', () => {
  assert.equal(invoiceStatus({ status: 'sent', dueDate: '2026-09-29' }, '2026-09-30'), 'overdue');
  assert.equal(invoiceStatus({ status: 'sent', dueDate: '2026-09-30' }, '2026-09-30'), 'sent');
  assert.equal(invoiceStatus({ status: 'sent', dueDate: '2026-10-01' }, '2026-09-30'), 'sent');
  for (const status of ['draft', 'paid']) assert.equal(invoiceStatus({ status, dueDate: '2025-01-01' }, '2026-09-30'), status);
  assert.throws(() => invoiceStatus({ status: 'cancelled', dueDate: '2026-09-30' }, '2026-09-30'));
  assert.throws(() => invoiceStatus({ status: 'sent', dueDate: 'bad' }, '2026-09-30'));
  assert.throws(() => invoiceStatus({ status: 'sent', dueDate: '2026-09-30' }, 'bad'));
});

test('invoice cleaning validates fields and never accepts forged numbers or totals', () => {
  const value = cleanInvoice({ ...invoice(), number: 'forged', total: 1, referralKey: `referral:${ID}` });
  assert.equal(value.number, undefined); assert.equal(value.total, undefined);
  assert.equal(value.referralKey, `referral:${ID}`); assert.equal(value.paidDate, null);
  const draft = invoice(); delete draft.status;
  assert.equal(cleanInvoice(draft).status, 'draft');
});

test('invoice cleaning rejects invalid payer, dates, status, lines, key and long text', () => {
  for (const patch of [
    { payer: { name: '', email: 'a@example.test' } }, { payer: { name: 'Example', email: 'bad' } },
    { client: { name: '' } }, { issueDate: '2026-02-30' }, { dueDate: '' }, { paidDate: 'today' },
    { status: 'overdue' }, { lines: [] }, { lines: [{ qty: 1, unit: -1, description: 'Example' }] },
    { lines: [{ qty: 1, unit: 1, description: '' }] }, { lines: [{ qty: 1, unit: 1, description: 'Example', date: 'bad' }] },
    { referralKey: 'settings:invoice' }, { caseRef: 'x'.repeat(201) }, { notes: 'x'.repeat(4001) }
  ]) assert.throws(() => cleanInvoice({ ...invoice(), ...patch }));
  assert.throws(() => cleanInvoice(null));
});

test('shared mail layout preserves custom email signature, escaping, links and attachments', () => {
  const rendered = textToHtml('<script>bad</script>\nline\n\nhttps://example.test/?a=1&b=2');
  assert.ok(rendered.includes('&lt;script&gt;')); assert.ok(rendered.includes('<br>line'));
  assert.ok(rendered.includes('href="https://example.test/?a=1&amp;b=2"'));
  assert.ok(wrapHtml(rendered).includes(SIGNATURE_HTML));
  const email = customEmail({ subject: 'Example', body: 'Hello\n\nKind regards,\nZakery',
    attachments: [{ filename: 'example.pdf', contentType: 'application/pdf', data: Buffer.from('fictional').toString('base64') }] });
  assert.equal(email.text, `Hello\n\n${SIGNATURE_TEXT}`);
  assert.equal(email.html, wrapHtml(textToHtml('Hello')));
  assert.equal(email.attachments[0].content.toString(), 'fictional');
});

// In-memory service doubles; these tests never import an SDK or make network calls.
function database(initial = []) {
  const rows = new Map(initial.map(row => [row.key, structuredClone(row)]));
  const db = { rows, sequence: 0, failure: null, conflict: null, calls: 0 };
  db.rpc = async name => {
    assert.equal(name, 'next_invoice_number');
    return db.failure ? { error: db.failure } : { data: ++db.sequence };
  };
  db.from = table => {
    assert.equal(table, 'practice_records'); db.calls++;
    let operation = 'select', payload, options, single = false, range, sort;
    const filters = [];
    const query = {
      select() { return query; },
      eq(field, value) { filters.push(row => field === 'value' ? JSON.stringify(row.value) === value : row[field] === value); return query; },
      gte(field, value) { filters.push(row => String(row[field]) >= value); return query; },
      order(field, opts) { if (field === 'created_at') sort = opts; return query; },
      range(start, end) { range = [start, end]; return query; },
      maybeSingle() { single = true; return query; },
      single() { single = true; return query; },
      insert(value) { operation = 'insert'; payload = value; return query; },
      upsert(value, opts) { operation = 'upsert'; payload = value; options = opts; return query; },
      update(value) { operation = 'update'; payload = value; return query; },
      delete() { operation = 'delete'; return query; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (db.failure) return { error: db.failure };
          if (db.conflict && ['update', 'delete'].includes(operation)) {
            const conflict = db.conflict; db.conflict = null; conflict(rows);
            // A concurrent writer also moves updated_at, which the handler uses as its version check.
            rows.forEach(row => { row.updated_at = new Date(Date.parse(row.updated_at) + 1000).toISOString(); });
          }
          let selected = [...rows.values()].filter(row => filters.every(filter => filter(row)));
          if (operation === 'insert' || operation === 'upsert') {
            const existing = rows.get(payload.key);
            if (existing && operation === 'insert') return { error: { code: '23505' } };
            if (existing && options?.ignoreDuplicates) selected = [];
            else {
              const row = { created_at: existing?.created_at || new Date().toISOString(), ...structuredClone(payload) };
              rows.set(row.key, row); selected = [row];
            }
          } else if (operation === 'update') {
            selected = selected.map(row => ({ ...row, ...structuredClone(payload) }));
            selected.forEach(row => rows.set(row.key, row));
          } else if (operation === 'delete') selected.forEach(row => rows.delete(row.key));
          if (sort) selected.sort((a, b) => b.created_at.localeCompare(a.created_at));
          if (range) selected = selected.slice(range[0], range[1] + 1);
          return { data: structuredClone(single ? selected[0] || null : selected), error: null };
        }).then(resolve, reject);
      }
    };
    return query;
  };
  return db;
}

function record(kind, value, id = ID) {
  return { key: `${kind}:${id}`, kind, value, created_at: '2026-09-30T12:00:00Z', updated_at: '2026-09-30T12:00:00Z' };
}
function pending() {
  return record('intake', { name: 'Fictional Patient', email: 'patient@example.test', bookingId: ID,
    status: 'pending', expiresAt: new Date(Date.now() + 86400000).toISOString() });
}
function setup(initial = []) {
  const db = database(initial), emails = [], charges = [];
  const stripe = { paymentIntents: { create: async (params, options) => {
    charges.push({ params, options }); return { id: 'pi_example', status: 'succeeded' };
  } } };
  const handler = createPracticeHandler({ db, stripe, mail: async message => { emails.push(message); }, verifyToken: token => token === 'admin' });
  return { db, emails, charges, stripe, handler };
}
async function request(handler, body, { method = 'POST', contentType = 'application/json' } = {}) {
  const res = { headers: {}, code: 200, body: undefined,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(value) { this.body = value; return this; }, end() { return this; } };
  await handler({ method, body, headers: { 'content-type': contentType } }, res);
  return res;
}

test('practice accepts only POST JSON, disables caching and performs no work for honeypots', async () => {
  const { handler, db, emails } = setup();
  assert.equal((await request(handler, {}, { method: 'GET' })).code, 405);
  assert.equal((await request(handler, {}, { method: 'OPTIONS' })).code, 200);
  assert.equal((await request(handler, {}, { contentType: 'text/plain' })).code, 400);
  for (const body of ['{', [], null]) assert.equal((await request(handler, body)).code, 400);
  const response = await request(handler, { action: 'referral', website: 'spam' });
  assert.deepEqual(response.body, { ok: true });
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.headers['Access-Control-Allow-Origin'], 'https://communitycarephysio.co.uk');
  assert.equal(db.calls, 0); assert.equal(emails.length, 0);
});

test('every admin action requires a valid token; unknown actions never touch storage', async () => {
  const { handler, db } = setup();
  for (const action of ['list', 'save', 'invoice-create', 'invoice-save', 'delete', 'intake-create', 'charge-fee', 'other']) {
    assert.equal((await request(handler, { action, token: 'invalid' })).code, 401, action);
  }
  assert.equal((await request(handler, { action: 'other', token: 'admin' })).code, 400);
  assert.equal(db.calls, 0);
});

test('public referral stores validated data and sends only a reference to the referrer', async () => {
  const { handler, db, emails } = setup();
  const response = await request(handler, { action: 'referral', data: { ...referral(), status: 'closed' } });
  assert.equal(response.code, 200); assert.match(response.body.ref, /^R-[A-Z0-9]{6}$/);
  const stored = [...db.rows.values()][0];
  assert.equal(stored.kind, 'referral'); assert.equal(stored.value.status, 'new');
  assert.equal(stored.value.ref, response.body.ref); assert.ok(Date.parse(stored.value.submittedAt));
  assert.equal(emails.length, 2);
  const acknowledgement = emails.find(email => email.to === 'referrer@example.test');
  assert.ok(acknowledgement.text.includes('We aim to reply within one working day'));
  assert.ok(!acknowledgement.text.includes('Example condition'));
  assert.equal((await request(handler, { action: 'referral', data: {} })).code, 400);
  assert.equal(db.rows.size, 1);
});

test('referral survives mail failures without logging or returning patient data', async t => {
  const db = database(), logs = []; let sends = 0;
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const handler = createPracticeHandler({ db, mail: async () => { sends++; throw Object.assign(new Error('private details'), { code: 'EAUTH' }); } });
  const res = await request(handler, { action: 'referral', data: referral() });
  assert.equal(res.code, 200); assert.equal(sends, 2); assert.equal(db.rows.size, 1);
  assert.ok(!JSON.stringify(logs).includes('private details'));
  assert.ok(!JSON.stringify(res.body).includes('Fictional'));
});

test('intake-get discloses only first name and status and handles missing/expired tokens', async () => {
  const { handler, db } = setup([pending()]);
  const res = await request(handler, { action: 'intake-get', token: ID });
  assert.deepEqual(res.body, { firstName: 'Fictional', status: 'pending' });
  assert.equal((await request(handler, { action: 'intake-get', token: OTHER_ID })).code, 404);
  assert.equal((await request(handler, { action: 'intake-get', token: '../settings:invoice' })).code, 400);
  db.rows.get(`intake:${ID}`).value.expiresAt = '2020-01-01T00:00:00Z';
  assert.equal((await request(handler, { action: 'intake-get', token: ID })).code, 410);
  assert.equal((await request(handler, { action: 'intake-submit', token: ID, data: intake() })).code, 410);
});

test('intake submission stamps the signature, prevents resubmission and sends no health details', async () => {
  const { handler, db, emails } = setup([pending()]);
  const requestBody = { action: 'intake-submit', token: ID, data: { ...intake(), signedAt: 'forged' } };
  assert.equal((await request(handler, requestBody)).code, 200);
  const value = db.rows.get(`intake:${ID}`).value;
  assert.equal(value.status, 'completed'); assert.equal(value.completedAt, value.response.signedAt);
  assert.ok(Date.parse(value.response.signedAt));
  assert.equal(emails.length, 1); assert.ok(!emails[0].text.includes('Example condition'));
  const repeat = await request(handler, requestBody);
  assert.equal(repeat.code, 409); assert.deepEqual(repeat.body, { error: 'This form has already been submitted.' });
  assert.equal(emails.length, 1);
});

test('concurrent intake submissions cannot replace a completed response', async () => {
  const { handler, db, emails } = setup([pending()]);
  db.conflict = rows => { rows.get(`intake:${ID}`).value = { ...pending().value, status: 'completed', response: { fullName: 'First signer' } }; };
  const res = await request(handler, { action: 'intake-submit', token: ID, data: intake() });
  assert.equal(res.code, 409); assert.equal(db.rows.get(`intake:${ID}`).value.response.fullName, 'First signer');
  assert.equal(emails.length, 0);
});

test('admin creates an intake token lasting 30 days and can read its full response', async () => {
  const { handler, db } = setup();
  const before = Date.now();
  const res = await request(handler, { action: 'intake-create', token: 'admin', bookingId: ID, name: 'Example Patient', email: 'patient@example.test' });
  assert.equal(res.code, 200); assert.match(res.body.token, /^[a-f0-9-]{36}$/);
  assert.equal(res.body.url, `https://www.communitycarephysio.co.uk/?intake=${res.body.token}`);
  const value = db.rows.get(`intake:${res.body.token}`).value;
  assert.equal(Date.parse(value.expiresAt) - Date.parse(value.createdAt), 30 * 86400000);
  assert.ok(Date.parse(value.createdAt) >= before);
  value.response = { goals: 'Example goal' };
  const list = await request(handler, { action: 'list', token: 'admin', kind: 'intake' });
  assert.equal(list.body[0].value.response.goals, 'Example goal');
});

test('admin list supports all allowed kinds, excludes counters and pages beyond 500 records', async () => {
  const records = Array.from({ length: 501 }, (_, i) => record('referral', { status: 'new' }, String(i)));
  const { handler } = setup(records);
  const list = await request(handler, { action: 'list', token: 'admin', kind: 'referral' });
  assert.equal(list.body.length, 501);
  assert.equal((await request(handler, { action: 'list', token: 'admin', kind: 'counter' })).code, 400);
  for (const kind of ['invoice', 'card', 'settings']) assert.equal((await request(handler, { action: 'list', token: 'admin', kind })).code, 200);
});

test('admin save is restricted to referrals and the two settings records', async () => {
  const { handler, db } = setup();
  for (const key of ['settings:invoice', 'settings:drive', `referral:${ID}`]) {
    assert.equal((await request(handler, { action: 'save', token: 'admin', key, value: { status: 'new' } })).code, 200);
  }
  for (const key of [`intake:${ID}`, `card:${ID}`, `invoice:${ID}`, 'counter:invoice', 'settings:unknown']) {
    assert.equal((await request(handler, { action: 'save', token: 'admin', key, value: {} })).code, 400);
  }
  for (const value of [[], null, { status: 'invalid' }, { status: 'new', notes: 'x'.repeat(4001) }]) {
    assert.equal((await request(handler, { action: 'save', token: 'admin', key: `referral:${ID}`, value })).code, 400);
  }
  assert.equal(db.rows.size, 3);
});

test('invoice creation allocates numbers and edits preserve number and creation timestamp', async () => {
  const { handler, db } = setup();
  const created = await request(handler, { action: 'invoice-create', token: 'admin', value: invoice() });
  assert.equal(created.code, 200); assert.equal(created.body.value.number, 'CCP-2026-0001');
  const second = await request(handler, { action: 'invoice-create', token: 'admin', value: invoice() });
  assert.equal(second.body.value.number, 'CCP-2026-0002');
  const saved = await request(handler, { action: 'invoice-save', token: 'admin', key: created.body.key,
    value: { ...invoice(), number: 'forged', createdAt: 'forged', status: 'sent' } });
  assert.equal(saved.body.value.number, created.body.value.number);
  assert.equal(saved.body.value.createdAt, created.body.value.createdAt);
  assert.equal(saved.body.value.status, 'sent');
  assert.equal((await request(handler, { action: 'invoice-create', token: 'admin', value: {} })).code, 400);
  assert.equal(db.sequence, 2);
});

test('only draft invoices and referrals can be deleted; concurrent status changes survive', async () => {
  const { handler, db } = setup([record('invoice', { ...invoice(), status: 'sent' }), record('referral', { status: 'new' })]);
  for (const status of ['sent', 'paid']) {
    db.rows.get(`invoice:${ID}`).value.status = status;
    const res = await request(handler, { action: 'delete', token: 'admin', key: `invoice:${ID}` });
    assert.equal(res.code, 400); assert.ok(res.body.error.includes('Mark as cancelled in notes'));
  }
  db.rows.get(`invoice:${ID}`).value.status = 'draft';
  db.conflict = rows => { rows.get(`invoice:${ID}`).value.status = 'sent'; };
  assert.equal((await request(handler, { action: 'delete', token: 'admin', key: `invoice:${ID}` })).code, 409);
  assert.ok(db.rows.has(`invoice:${ID}`));
  db.rows.get(`invoice:${ID}`).value.status = 'draft';
  for (const kind of ['invoice', 'referral']) assert.equal((await request(handler, { action: 'delete', token: 'admin', key: `${kind}:${ID}` })).code, 200);
  assert.equal((await request(handler, { action: 'delete', token: 'admin', key: `card:${ID}` })).code, 400);
});

function card() { return record('card', { customer: 'cus_example', paymentMethod: 'pm_example', charges: [] }); }
function fee(patch = {}) { return { action: 'charge-fee', token: 'admin', bookingId: ID, amount: 50, reason: 'Missed appointment', idempotencyKey: 'example-charge', ...patch }; }

test('fee charges use server-saved card details, exact pence and idempotent history', async () => {
  const { handler, db, charges } = setup([card()]);
  const res = await request(handler, fee({ amount: 50.25, customer: 'cus_forged', paymentMethod: 'pm_forged' }));
  assert.deepEqual(res.body, { ok: true, status: 'succeeded' });
  assert.equal(charges[0].params.amount, 5025); assert.equal(charges[0].params.currency, 'gbp');
  assert.equal(charges[0].params.customer, 'cus_example'); assert.equal(charges[0].params.payment_method, 'pm_example');
  assert.equal(charges[0].params.off_session, true); assert.equal(charges[0].params.confirm, true);
  assert.equal(charges[0].options.idempotencyKey, 'example-charge');
  const history = db.rows.get(`card:${ID}`).value.charges;
  assert.equal(history.length, 1); assert.equal(history[0].amount, 50.25); assert.equal(history[0].paymentIntent, 'pi_example');
  assert.equal((await request(handler, fee({ amount: 50.25 }))).code, 200);
  assert.equal(charges.length, 1);
  assert.equal((await request(handler, fee({ amount: 51 }))).code, 400);
});

test('fee validation rejects unsafe amounts, malformed identifiers and missing idempotency keys before charging', async () => {
  const { handler, charges } = setup([card()]);
  for (const amount of [0, -1, 200.01, NaN, Infinity, '50', 1.005, null]) assert.equal((await request(handler, fee({ amount }))).code, 400);
  for (const patch of [{ idempotencyKey: undefined }, { idempotencyKey: 'x'.repeat(81) }, { reason: '' }, { bookingId: 'bad' }]) {
    assert.equal((await request(handler, fee(patch))).code, 400);
  }
  const missing = await request(handler, fee({ bookingId: OTHER_ID }));
  assert.equal(missing.code, 404); assert.equal(missing.body.error, 'No saved card for this patient.');
  assert.equal(charges.length, 0);
});

test('fee append retries preserve concurrent charges without creating a second payment', async () => {
  const { handler, db, charges } = setup([card()]);
  db.conflict = rows => { rows.get(`card:${ID}`).value.charges.push({ paymentIntent: 'pi_other', amount: 10 }); };
  assert.equal((await request(handler, fee())).code, 200);
  assert.equal(charges.length, 1);
  assert.deepEqual(db.rows.get(`card:${ID}`).value.charges.map(c => c.paymentIntent), ['pi_other', 'pi_example']);
});

test('Stripe card failures return safe 402 errors and never append successful charges', async t => {
  t.mock.method(console, 'error', () => {});
  const { handler, stripe, db } = setup([card()]);
  for (const code of ['authentication_required', 'card_declined']) {
    stripe.paymentIntents.create = async () => { throw Object.assign(new Error('private Stripe internals'), { type: 'StripeCardError', code }); };
    const res = await request(handler, fee());
    assert.equal(res.code, 402); assert.ok(!res.body.error.includes('private'));
  }
  assert.equal(db.rows.get(`card:${ID}`).value.charges.length, 0);
});

test('missing schema maps to 503 and unexpected failures expose neither internals nor data', async t => {
  const logs = []; t.mock.method(console, 'error', (...args) => logs.push(args));
  const { handler, db } = setup();
  for (const code of ['42P01', 'PGRST202', 'PGRST205', 'XX000']) {
    db.failure = { code, message: 'private health details', details: 'private database internals' };
    const res = await request(handler, { action: 'list', token: 'admin', kind: 'referral' });
    assert.equal(res.code, code === 'XX000' ? 500 : 503);
    assert.ok(!JSON.stringify(res.body).includes('private'));
  }
  assert.ok(!JSON.stringify(logs).includes('private'));
});

// Execute the card-storage helper with local doubles; SDK imports remain unexecuted.
function webhookCard(initial = []) {
  const db = database(initial), calls = [], logs = [];
  const stripe = { paymentIntents: { retrieve: async (...args) => {
    calls.push(args);
    return { customer: 'cus_example', payment_method: { id: 'pm_example',
      card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } } };
  } } };
  const source = readFileSync(new URL('../api/stripe-webhook.js', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('async function saveCard('), source.indexOf('export default async function handler'));
  const context = vm.createContext({ stripe, supabase: db, console: { error: (...args) => logs.push(args) } });
  vm.runInContext(helper, context);
  return { db, calls, logs, stripe, save: context.saveCard };
}

test('webhook stores Stripe card references and display details with existing charge history', async () => {
  const existing = card(); existing.value.charges.push({ paymentIntent: 'pi_previous', amount: 50 });
  const { db, calls, save } = webhookCard([existing]);
  await save({ payment_intent: 'pi_example' }, ID);
  const value = db.rows.get(`card:${ID}`).value;
  assert.equal(value.customer, 'cus_example'); assert.equal(value.paymentMethod, 'pm_example');
  assert.equal(value.brand, 'visa'); assert.equal(value.last4, '4242');
  assert.equal(value.expMonth, 12); assert.equal(value.expYear, 2030); assert.ok(Date.parse(value.savedAt));
  assert.deepEqual(value.charges, existing.value.charges);
  assert.equal(calls[0][0], 'pi_example'); assert.equal(calls[0][1].expand[0], 'payment_method');
});

test('webhook can create a card record and preserves a concurrently appended charge', async () => {
  const { db, save } = webhookCard();
  await save({ payment_intent: 'pi_example' }, ID);
  assert.deepEqual(db.rows.get(`card:${ID}`).value.charges, []);
  db.conflict = rows => { rows.get(`card:${ID}`).value.charges.push({ paymentIntent: 'pi_concurrent', amount: 50 }); };
  await save({ payment_intent: 'pi_example' }, ID);
  assert.equal(db.rows.get(`card:${ID}`).value.charges.length, 1);
  assert.equal(db.rows.get(`card:${ID}`).value.charges[0].paymentIntent, 'pi_concurrent');
});

test('webhook leaves payment-link sessions and missing card details alone', async () => {
  const { db, save, calls, stripe } = webhookCard();
  await save({ payment_link: 'plink_example', payment_intent: 'pi_example' }, ID);
  await save({}, ID);
  assert.equal(calls.length, 0); assert.equal(db.rows.size, 0);
  stripe.paymentIntents.retrieve = async () => ({ customer: null, payment_method: null });
  await save({ payment_intent: 'pi_example' }, ID);
  assert.equal(db.rows.size, 0);
});

test('webhook card storage failures cannot break confirmation or log patient data', async () => {
  const { db, save, logs, stripe } = webhookCard();
  db.failure = { code: '42P01', message: 'private database details' };
  await assert.doesNotReject(save({ payment_intent: 'pi_example' }, ID));
  stripe.paymentIntents.retrieve = async () => { throw new Error('private Stripe details'); };
  await assert.doesNotReject(save({ payment_intent: 'pi_example' }, ID));
  assert.equal(logs.length, 2); assert.ok(!JSON.stringify(logs).includes('private'));
});

test('public referrals are rate limited and each referrer is acknowledged at most once a day', async () => {
  const { handler, db, emails } = setup();
  assert.equal((await request(handler, { action: 'referral', data: referral() })).code, 200);
  assert.equal((await request(handler, { action: 'referral', data: referral() })).code, 200);
  // Two referrals stored; the clinic is told twice but the referrer is acknowledged once.
  assert.equal(db.rows.size, 2);
  assert.equal(emails.filter(email => email.to === 'referrer@example.test').length, 1);
  const now = new Date().toISOString();
  for (let i = 0; i < 10; i++) db.rows.set(`referral:flood-${i}`, { key: `referral:flood-${i}`, kind: 'referral', value: { referrer: { email: `x${i}@example.test` } }, created_at: now, updated_at: now });
  const blocked = await request(handler, { action: 'referral', data: referral() });
  assert.equal(blocked.code, 429); assert.equal(db.rows.size, 12);
});

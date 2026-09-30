import { randomUUID, randomInt } from 'node:crypto';
import { verifyAdminToken } from '../lib/adminAuth.js';
import { cleanReferral, cleanIntake, cleanInvoice, formatInvoiceNumber } from '../lib/practice-model.js';
import { FROM_EMAIL, SIGNATURE_TEXT, sendMail, textToHtml, wrapHtml } from '../lib/mailer.js';

const PUBLIC_ACTIONS = ['referral', 'intake-get', 'intake-submit'];
const ADMIN_ACTIONS = ['list', 'save', 'invoice-create', 'invoice-save', 'delete', 'intake-create', 'charge-fee'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = 'key,kind,value,created_at,updated_at';
const ALREADY_SUBMITTED = 'This form has already been submitted.';
const NO_DELETE = 'Sent or paid invoices cannot be deleted. Mark as cancelled in notes instead.';

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function invalid(message) { throw new RequestError(400, message); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function safeCode(error) {
  return typeof error?.code === 'string' && /^[a-z0-9_]{1,40}$/i.test(error.code) ? error.code : 'unknown';
}
function logError(action, error) { console.error('practice', { action, code: safeCode(error) }); }

function string(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    invalid(`Please provide a valid ${label} (up to ${max} characters).`);
  }
  return value.trim();
}

function uuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(`Invalid ${label}.`);
  return value.toLowerCase();
}

function recordKey(value, kind) {
  if (typeof value !== 'string' || !value.startsWith(`${kind}:`)) invalid('Invalid record key.');
  return `${kind}:${uuid(value.slice(kind.length + 1), 'record key')}`;
}

function clean(cleaner, value) {
  try { return cleaner(value); } catch (error) { invalid(error.message); }
}

// Settings and admin referral notes have flexible shapes, but bounded JSON only.
function boundedObject(value) {
  if (!isObject(value)) invalid('Value must be an object.');
  function check(item, depth = 0) {
    if (depth > 8) invalid('Value is too deeply nested.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item === 'string' && item.length <= 4000 && !item.includes('\0')) return;
    if (Array.isArray(item) && item.length <= 100) {
      item.forEach(child => check(child, depth + 1));
      return;
    }
    if (isObject(item) && Object.keys(item).length <= 100) {
      for (const [key, child] of Object.entries(item)) {
        if (key.length > 100 || ['__proto__', 'constructor', 'prototype'].includes(key)) invalid('Invalid value field.');
        check(child, depth + 1);
      }
      return;
    }
    invalid('Value contains invalid or oversized fields.');
  }
  check(value);
  if (Buffer.byteLength(JSON.stringify(value)) > 64000) invalid('Value is too large.');
  return structuredClone(value);
}

function result({ data, error }) {
  if (error) throw error;
  return data;
}

async function load(db, key, message = 'Record not found.') {
  const record = result(await db.from('practice_records').select(COLUMNS).eq('key', key).maybeSingle());
  if (!record) throw new RequestError(404, message);
  return record;
}

async function write(db, key, kind, value, method = 'upsert') {
  return result(await db.from('practice_records')[method]({ key, kind, value, updated_at: new Date().toISOString() })
    .select(COLUMNS).single());
}

async function replace(db, record, value) {
  return result(await db.from('practice_records').update({ value, updated_at: new Date().toISOString() })
    .eq('key', record.key).eq('kind', record.kind).eq('updated_at', record.updated_at)
    .select(COLUMNS).maybeSingle());
}

function checkExpiry(record) {
  const expiry = Date.parse(record.value.expiresAt);
  if (!Number.isFinite(expiry) || expiry < Date.now()) throw new RequestError(410, 'This form has expired. Please request a new link.');
}

async function bestEffortMail(mail, action, message) {
  try { await mail(message); } catch (error) { logError(action, error); }
}

const ackBody = (ref) => `Thank you for your referral. Your reference is ${ref}.\n\nWe aim to reply within one working day to confirm whether we can accept it.\n\nPlease do not send clinical documents by open email; once the referral is accepted we'll arrange a secure way to receive discharge summaries and consent forms.`;

function referralSummary(value) {
  const lines = [`New referral ${value.ref}`, `Submitted: ${value.submittedAt}`];
  for (const group of ['referrer', 'client', 'clinical', 'service', 'funding']) {
    lines.push('', group.toUpperCase());
    for (const [key, detail] of Object.entries(value[group])) {
      if (detail !== '' && detail !== null) lines.push(`${key.replace(/([A-Z])/g, ' $1')}: ${detail}`);
    }
  }
  lines.push('', 'Referral consent: confirmed', '', 'View it in admin.');
  return lines.join('\n');
}

// Dependency injection keeps validation and failure paths testable without services.
export function createPracticeHandler({ db, stripe, mail = sendMail, verifyToken = verifyAdminToken } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let action = 'unknown';
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) invalid('Send a JSON request.');
      let body = req.body;
      if (typeof body === 'string') {
        if (Buffer.byteLength(body) > 128000) invalid('Request is too large.');
        try { body = JSON.parse(body); } catch { invalid('Invalid JSON request.'); }
      }
      if (!isObject(body)) invalid('Send a JSON object.');
      if (Buffer.byteLength(JSON.stringify(body)) > 128000) invalid('Request is too large.');
      if (body.website != null && body.website !== '') return res.status(200).json({ ok: true });
      if (PUBLIC_ACTIONS.includes(body.action) || ADMIN_ACTIONS.includes(body.action)) action = body.action;
      if (!PUBLIC_ACTIONS.includes(action) &&
        (typeof body.token !== 'string' || body.token.length > 2048 || !verifyToken(body.token))) {
        throw new RequestError(401, 'Unauthorised');
      }
      if (action === 'unknown') invalid('Unknown action.');
      const database = db || (await import('../lib/supabase.js')).supabase;

      if (action === 'referral') {
        const data = clean(cleanReferral, body.data);
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const ref = `R-${Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('')}`;
        const value = { ...data, status: 'new', submittedAt: new Date().toISOString(), ref };
        await write(database, `referral:${randomUUID()}`, 'referral', value, 'insert');
        await Promise.all([
          bestEffortMail(mail, action, {
            to: FROM_EMAIL,
            subject: `New referral ${ref} — ${data.referrer.organisation || data.referrer.name}`.replace(/[\r\n]/g, ' '),
            text: referralSummary(value)
          }),
          bestEffortMail(mail, action, {
            to: data.referrer.email,
            subject: `Referral received — ${ref} — Community Care Physio`,
            text: `${ackBody(ref)}\n\n${SIGNATURE_TEXT}`,
            html: wrapHtml(textToHtml(ackBody(ref)))
          })
        ]);
        return res.status(200).json({ ok: true, ref });
      }

      if (action === 'intake-get' || action === 'intake-submit') {
        const record = await load(database, `intake:${uuid(body.token, 'form token')}`);
        checkExpiry(record);
        if (action === 'intake-get') {
          return res.status(200).json({ firstName: String(record.value.name || '').trim().split(/\s+/)[0], status: record.value.status });
        }
        if (record.value.status === 'completed') throw new RequestError(409, ALREADY_SUBMITTED);
        const completedAt = new Date().toISOString();
        const response = { ...clean(cleanIntake, body.data), signedAt: completedAt };
        const saved = await replace(database, record, { ...record.value, response, status: 'completed', completedAt });
        if (!saved) throw new RequestError(409, ALREADY_SUBMITTED);
        await bestEffortMail(mail, action, {
          to: FROM_EMAIL,
          subject: `Intake & consent completed — ${record.value.name}`.replace(/[\r\n]/g, ' '),
          text: 'An intake and consent form has been completed. Please view it in admin.'
        });
        return res.status(200).json({ ok: true });
      }

      if (action === 'list') {
        if (!['referral', 'invoice', 'intake', 'card', 'settings'].includes(body.kind)) invalid('Invalid record kind.');
        const records = [];
        // Supabase caps each response; fetch every page for the admin list.
        for (let offset = 0; ; offset += 500) {
          const page = result(await database.from('practice_records').select(COLUMNS).eq('kind', body.kind)
            .order('created_at', { ascending: false }).order('key', { ascending: false }).range(offset, offset + 499));
          records.push(...page);
          if (page.length < 500) break;
        }
        return res.status(200).json(records);
      }

      if (action === 'save') {
        const value = boundedObject(body.value);
        let key, kind;
        if (typeof body.key === 'string' && body.key.startsWith('referral:')) {
          key = recordKey(body.key, 'referral');
          kind = 'referral';
          if (!['new', 'accepted', 'active', 'declined', 'closed'].includes(value.status)) invalid('Invalid referral status.');
        } else if (['settings:invoice', 'settings:drive'].includes(body.key)) {
          key = body.key;
          kind = 'settings';
        } else invalid('This record cannot be saved here.');
        return res.status(200).json(await write(database, key, kind, value));
      }

      if (action === 'invoice-create') {
        const value = clean(cleanInvoice, body.value);
        const n = result(await database.rpc('next_invoice_number'));
        const number = formatInvoiceNumber(n, Number(value.issueDate.slice(0, 4)));
        const record = await write(database, `invoice:${randomUUID()}`, 'invoice', {
          ...value, number, createdAt: new Date().toISOString()
        }, 'insert');
        return res.status(200).json(record);
      }

      if (action === 'invoice-save') {
        const key = recordKey(body.key, 'invoice');
        const value = clean(cleanInvoice, body.value);
        const existing = await load(database, key);
        const saved = await replace(database, existing, {
          ...value, number: existing.value.number, createdAt: existing.value.createdAt
        });
        if (!saved) throw new RequestError(409, 'This invoice changed. Reload before saving.');
        return res.status(200).json(saved);
      }

      if (action === 'delete') {
        const kind = typeof body.key === 'string' && body.key.startsWith('referral:') ? 'referral' : 'invoice';
        const key = recordKey(body.key, kind);
        const existing = await load(database, key);
        if (kind === 'invoice' && existing.value.status !== 'draft') invalid(NO_DELETE);
        const deleted = result(await database.from('practice_records').delete().eq('key', key)
          .eq('updated_at', existing.updated_at).select('key').maybeSingle());
        if (!deleted) throw new RequestError(409, 'This record changed. Reload before deleting.');
        return res.status(200).json({ ok: true });
      }

      if (action === 'intake-create') {
        const bookingId = body.bookingId == null || body.bookingId === '' ? null : uuid(String(body.bookingId), 'booking ID');
        const name = string(body.name, 'patient name');
        const email = body.email == null || body.email === '' ? '' : string(body.email, 'patient email');
        if (email && !/^[^\s@<>,;"\\]+@[^\s@<>,;"\\]+\.[^\s@<>,;"\\]+$/.test(email)) invalid('Please provide a valid patient email.');
        const token = randomUUID();
        const now = Date.now();
        await write(database, `intake:${token}`, 'intake', {
          bookingId, name, email, status: 'pending', createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 30 * 86400000).toISOString()
        }, 'insert');
        return res.status(200).json({ token, url: `https://www.communitycarephysio.co.uk/?intake=${token}` });
      }

      if (action === 'charge-fee') {
        const bookingId = uuid(body.bookingId, 'booking ID');
        const { amount } = body;
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 1 || amount > 200 ||
          Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) invalid('Enter a fee between £1 and £200, to the nearest penny.');
        const reason = string(body.reason, 'reason');
        const idempotencyKey = string(body.idempotencyKey, 'idempotency key', 80);
        const key = `card:${bookingId}`;
        let record = await load(database, key, 'No saved card for this patient.');
        const previous = record.value.charges?.find(charge => charge.idempotencyKey === idempotencyKey);
        if (previous) {
          if (previous.amount !== amount || previous.reason !== reason) invalid('This idempotency key has already been used for a different charge.');
          return res.status(200).json({ ok: true, status: previous.status });
        }
        if (typeof record.value.customer !== 'string' || !/^cus_[a-z0-9]+$/i.test(record.value.customer) ||
          typeof record.value.paymentMethod !== 'string' || !/^pm_[a-z0-9]+$/i.test(record.value.paymentMethod)) {
          throw new RequestError(404, 'No saved card for this patient.');
        }
        const payments = stripe || new (await import('stripe')).default(process.env.STRIPE_SECRET_KEY);
        const intent = await payments.paymentIntents.create({
          amount: Math.round(amount * 100), currency: 'gbp', customer: record.value.customer,
          payment_method: record.value.paymentMethod, off_session: true, confirm: true,
          description: `Community Care Physio — ${reason}`, metadata: { booking_id: bookingId, reason }
        }, { idempotencyKey });
        const charge = { amount, reason, status: intent.status, paymentIntent: intent.id, at: new Date().toISOString(), idempotencyKey };
        // Retry only the database append, never the payment, on concurrent writes.
        for (let attempt = 0; attempt < 5; attempt++) {
          const charges = record.value.charges || [];
          if (charges.some(item => item.paymentIntent === intent.id)) return res.status(200).json({ ok: true, status: intent.status });
          if (await replace(database, record, { ...record.value, charges: [...charges, charge] })) {
            return res.status(200).json({ ok: true, status: intent.status });
          }
          record = await load(database, key, 'No saved card for this patient.');
        }
        throw new RequestError(409, 'Charge recording is busy. Retry with the same idempotency key.');
      }
    } catch (error) {
      if (error instanceof RequestError) return res.status(error.status).json({ error: error.message });
      logError(action, error);
      if (['42P01', 'PGRST202', 'PGRST205'].includes(error?.code)) {
        return res.status(503).json({ error: 'Practice tools are not enabled yet…' });
      }
      if (action === 'charge-fee' && (error?.type === 'StripeCardError' || ['authentication_required', 'card_declined'].includes(error?.code))) {
        const authentication = error.code === 'authentication_required' || error.decline_code === 'authentication_required';
        return res.status(402).json({ error: authentication
          ? 'The card needs patient authentication. Please arrange payment with the patient.'
          : 'The card was declined. Please arrange another payment method with the patient.' });
      }
      return res.status(500).json({ error: action === 'charge-fee'
        ? 'Unable to complete this request. Check payment status before retrying with the same idempotency key.'
        : 'Unable to complete this request. Please try again.' });
    }
  };
}

export default createPracticeHandler();

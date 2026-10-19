import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { fakeDb, loadHandler, response } from './safety-helpers.js';

const booking = { id: 'booking-test', paid: false, appointment: 'Initial Assessment', booked_date: '2099-10-01',
  booked_time: '18:00', name: 'Fictional Patient', email: 'patient@example.test', price: 100 };
const warning = '⚠️ TIME CLASH: this paid booking overlaps another appointment — please rearrange.';
function setup(initial = {}) {
  const db = fakeDb({ bookings: [booking], pending_bookings: [{ stripe_session_id: 'pending_booking-test' }], ...initial });
  const mail = [], logs = [];
  let event;
  const stripe = { webhooks: { constructEvent() { return event; } } };
  const handler = loadHandler('stripe-webhook', { db, stripe, mail, logs });
  return { db, mail, logs, async deliver(payment_status = 'paid', type = 'checkout.session.completed') {
    event = { type, data: { object: { payment_status, metadata: { booking_id: booking.id } } } };
    const req = Readable.from([Buffer.from('{}')]); req.method = 'POST'; req.headers = {};
    const res = response(); await handler(req, res); return res;
  } };
}

test('unpaid completed sessions leave the booking unpaid; async success confirms it', async () => {
  const ctx = setup();
  for (const status of ['unpaid', 'no_payment_required', undefined]) {
    assert.equal((await ctx.deliver(status === undefined ? null : status)).statusCode, 200);
  }
  assert.equal(ctx.db.calls.length, 0);
  assert.equal(ctx.db.tables.bookings[0].paid, false);
  assert.equal((await ctx.deliver('paid', 'checkout.session.async_payment_succeeded')).statusCode, 200);
  assert.equal(ctx.db.tables.bookings[0].paid, true);
  assert.equal(ctx.mail.length, 2);
});

test('paid-update errors return 500; a successful retry sends once and later retries send nothing', async () => {
  const ctx = setup();
  ctx.db.error = query => query.table === 'bookings' && query.action === 'update' ? { code: 'unavailable' } : null;
  const failed = await ctx.deliver();
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.body.error, 'Booking confirmation failed; retry required');
  assert.equal(ctx.db.tables.bookings[0].paid, false);
  assert.equal(ctx.mail.length, 0);
  ctx.db.error = null;
  assert.equal((await ctx.deliver()).statusCode, 200);
  assert.equal(ctx.db.tables.bookings[0].confirmed, true);
  assert.equal(ctx.mail.length, 2);
  assert.equal(ctx.db.tables.pending_bookings.length, 0);
  assert.equal((await ctx.deliver()).statusCode, 200);
  assert.equal(ctx.mail.length, 2);
});

test('booking read errors also request a Stripe retry', async () => {
  const ctx = setup(); ctx.db.error = { code: 'unavailable' };
  assert.equal((await ctx.deliver()).statusCode, 500);
  assert.equal(ctx.mail.length, 0);
});

test('slot clashes retain the other booking and flag only the clinic notification', async () => {
  const ctx = setup({ blocked_slots: [{ booking_date: booking.booked_date, slot_time: '18:30', booking_id: 'other-booking' }] });
  assert.equal((await ctx.deliver()).statusCode, 200);
  assert.equal(ctx.db.tables.bookings[0].paid, true);
  assert.equal(ctx.db.tables.blocked_slots.find(row => row.slot_time === '18:30').booking_id, 'other-booking');
  assert.ok(ctx.mail[0].text.startsWith(warning));
  assert.ok(ctx.mail[0].html.startsWith(`<p><strong>${warning}</strong></p>`));
  assert.ok(!ctx.mail[1].html.includes(warning));
  assert.equal(JSON.stringify(ctx.logs), JSON.stringify([['stripe-webhook', { action: 'slot-clash', code: 'overlap' }]]));
});

test('the same booking and slots on other dates do not trigger a clash warning', async () => {
  const ctx = setup({ blocked_slots: [
    { booking_date: booking.booked_date, slot_time: '18:30', booking_id: booking.id },
    { booking_date: '2099-10-02', slot_time: '18:30', booking_id: 'other-booking' }
  ] });
  await ctx.deliver();
  assert.ok(!ctx.mail[0].html.includes(warning));
  assert.ok(!ctx.mail[0].text.includes(warning));
  assert.equal(ctx.logs.length, 0);
});

test('custom sessions block each date and detect a clash on a later session', async () => {
  const ctx = setup({ bookings: [{ ...booking, custom_sessions: JSON.stringify([
    { date: '2099-10-03', time: '18:00', length: '45' }, { date: '2099-10-04', time: '18:00', length: '60' }
  ]) }], blocked_slots: [{ booking_date: '2099-10-04', slot_time: '19:30', booking_id: 'other-booking' }] });
  await ctx.deliver();
  assert.equal(ctx.db.tables.blocked_slots.filter(row => row.booking_date === '2099-10-03').length, 3);
  assert.equal(ctx.db.tables.blocked_slots.filter(row => row.booking_date === '2099-10-04').length, 4);
  assert.ok(ctx.mail[0].text.startsWith(warning));
});

test('expired checkout: abandoned, resume link saved, customer emailed once, lead_emails 1', async () => {
  const ctx = setup();
  const url = 'https://checkout.stripe.com/c/pay/recover_abc';
  const expire = async () => {
    const req = Readable.from([Buffer.from('{}')]); req.method = 'POST'; req.headers = {};
    const res = response();
    const handler = loadHandler('stripe-webhook', { db: ctx.db, mail: ctx.mail, logs: ctx.logs,
      stripe: { webhooks: { constructEvent() { return { type: 'checkout.session.expired', data: { object: { metadata: { booking_id: booking.id }, after_expiration: { recovery: { url } } } } }; } } } });
    await handler(req, res); return res;
  };
  assert.equal((await expire()).statusCode, 200);
  const row = ctx.db.tables.bookings[0];
  assert.equal(row.status, 'abandoned');
  assert.equal(row.recovery_url, url);
  assert.equal(row.lead_emails, 1);
  assert.equal(ctx.mail.length, 2, 'clinician alert + customer email');
  assert.equal(ctx.mail[1].to, booking.email);
  assert.ok(ctx.mail[1].text.includes(url));
  assert.equal((await expire()).statusCode, 200);
  assert.equal(ctx.mail.length, 2, 'a Stripe retry sends nothing more');
});

test('paying later revives an abandoned or lead booking and blocks its slots', async () => {
  for (const status of ['abandoned', 'lead']) {
    const ctx = setup({ bookings: [{ ...booking, status, lead_emails: 2 }] });
    assert.equal((await ctx.deliver()).statusCode, 200);
    const row = ctx.db.tables.bookings[0];
    assert.equal(row.paid, true);
    assert.equal(row.confirmed, true);
    assert.equal(row.status, null, status);
    assert.equal(ctx.db.tables.blocked_slots.filter(r => r.booking_id === booking.id).length, 4, '60 min visit + 45 min buffer');
    assert.equal(ctx.mail.length, 2);
  }
});

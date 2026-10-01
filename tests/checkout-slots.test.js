import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb, loadHandler, response } from './safety-helpers.js';

const date = '2099-10-01';
const booking = { appointment: 'Initial Assessment', postcode: 'SW19 1AA', bookedDate: date, bookedTime: '18:00' };
const activeHold = { booked_date: date, booked_time: '18:30', expires_at: '2099-10-01T23:00:00Z', booking_data: { appointment: 'Initial Assessment' } };
async function checkout(db, body = booking, clock = Date) {
  const stripe = { checkout: { sessions: { async create() { return { url: 'https://example.test/checkout' }; } } } };
  const handler = loadHandler('create-checkout', { db, stripe, Date: clock });
  const res = response(); await handler({ method: 'POST', body }, res); return res;
}

test('checkout rejects a later blocked slot before creating any rows', async () => {
  const db = fakeDb({ blocked_slots: [{ booking_date: date, slot_time: '18:30' }] });
  const res = await checkout(db);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'That time overlaps another appointment. Please choose another time.');
  assert.equal(res.body.code, 'SLOT_TAKEN');
  assert.ok(db.calls.every(query => query.action === 'select'));
});

test('checkout expands active holds including their buffer and default duration', async () => {
  for (const booking_data of [{ appointment: 'Initial Assessment' }, null]) {
    const db = fakeDb({ pending_bookings: [{ ...activeHold, booked_time: '17:00', booking_data }] });
    const res = await checkout(db);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'SLOT_TAKEN');
    assert.ok(db.calls.every(query => query.action === 'select'));
  }
});

test('exact-start conflicts retain their existing responses', async () => {
  const blocked = await checkout(fakeDb({ blocked_slots: [{ booking_date: date, slot_time: '18:00' }] }));
  assert.equal(blocked.body.error, 'Slot already booked');
  assert.equal(blocked.body.code, 'SLOT_TAKEN');
  const held = await checkout(fakeDb({ pending_bookings: [{ ...activeHold, booked_time: '18:00' }] }));
  assert.equal(held.body.error, 'Slot temporarily held');
  assert.equal(held.body.code, 'SLOT_HELD');
});

test('expired holds, other days, and an exact buffer boundary allow checkout', async () => {
  for (const hold of [
    { ...activeHold, expires_at: '2000-01-01T00:00:00Z' },
    { ...activeHold, booked_date: '2099-10-02' },
    { ...activeHold, booked_time: '16:30', booking_data: { appointment: 'Standard Session' } }
  ]) {
    const db = fakeDb({ pending_bookings: [hold] });
    const res = await checkout(db);
    assert.equal(res.statusCode, 200);
    assert.equal(db.tables.bookings.length, 1);
    assert.equal(db.tables.pending_bookings.length, 2);
  }
});

test('availability read errors prevent creating a booking', async () => {
  const db = fakeDb(); db.error = query => query.table === 'pending_bookings' ? { code: 'unavailable' } : null;
  assert.equal((await checkout(db)).statusCode, 500);
  assert.ok(db.calls.every(query => query.action === 'select'));
});

test('past-date rejection uses the UK date, even without a time', async () => {
  class LondonMidnight extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-06-01T23:30:00Z'])); }
    static now() { return new Date('2026-06-01T23:30:00Z').getTime(); }
  }
  const db = fakeDb();
  const res = await checkout(db, { ...booking, bookedDate: '2026-06-01', bookedTime: '' }, LondonMidnight);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Please choose a future date and time.');
  assert.equal(db.calls.length, 0);
  assert.equal((await checkout(db, { ...booking, bookedDate: '2026-06-02' }, LondonMidnight)).statusCode, 200);
});

test('public calendar expands and deduplicates only active holds without exposing booking data', async () => {
  const db = fakeDb({ blocked_slots: [{ booking_date: date, slot_time: '18:30' }], pending_bookings: [
    activeHold,
    { ...activeHold, booked_time: '09:00', expires_at: '2000-01-01T00:00:00Z' },
    { ...activeHold, booked_time: '21:00', booking_data: null },
    { ...activeHold, booked_time: null }
  ] });
  const res = response(); await loadHandler('get-slots', { db })({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Array.from(res.body.bookedSlots[date]), ['18:30', '19:00', '19:30', '20:00', '21:00', '21:30', '22:00', '22:30']);
  assert.ok(!JSON.stringify(res.body).includes('appointment'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { isAbandonedRow, abandonedAlert, ABANDON_AFTER_MS } from '../lib/abandoned.js';

const now = Date.parse('2026-10-14T12:00:00Z');
const base = { name: 'A Person', paid: false, confirmed: false, status: null, booking_for: 'A patient / resident', created_at: '2026-10-14T10:00:00Z' };

test('unpaid, unconfirmed public booking older than the hold is abandoned', () => {
  assert.equal(isAbandonedRow(base, now), true);
  assert.equal(isAbandonedRow({ ...base, created_at: new Date(now - ABANDON_AFTER_MS + 60000).toISOString() }, now), false);
});

test('paid, confirmed, cancelled or enquiry rows are not abandoned', () => {
  assert.equal(isAbandonedRow({ ...base, paid: true }, now), false);
  assert.equal(isAbandonedRow({ ...base, confirmed: true }, now), false);
  assert.equal(isAbandonedRow({ ...base, status: 'cancelled' }, now), false);
  assert.equal(isAbandonedRow({ ...base, booking_for: 'enquiry' }, now), false);
  assert.equal(isAbandonedRow({ ...base, status: 'abandoned' }, now), true);
});

test('alert is high priority and carries the contact details', () => {
  const m = abandonedAlert({ ...base, phone: '07000 000000', email: 'a@b.c', appointment: 'Full Programme', price: 615, booked_date: '2026-10-20', booked_time: '18:30', reason: 'Bed bound stroke' });
  assert.match(m.subject, /^FOLLOW UP: unpaid booking, A Person/);
  assert.equal(m.headers.Importance, 'high');
  for (const s of ['07000 000000', 'a@b.c', 'Full Programme', '£615', '18:30', 'Bed bound stroke']) assert.ok(m.text.includes(s), s);
  assert.ok(!m.html.includes('<script'));
});

test('recovery email carries the resume link and no discount', async () => {
  const { recoveryEmail } = await import('../lib/abandoned.js');
  const m = recoveryEmail({ ...base, email: 'a@b.c', appointment: 'Full Programme', booked_date: '2026-10-20', booked_time: '18:30' }, 'https://checkout.stripe.com/c/pay/recover_123');
  assert.match(m.subject, /finish your booking/);
  assert.ok(m.text.includes('https://checkout.stripe.com/c/pay/recover_123'));
  assert.ok(m.text.includes('Hi A,'));
  assert.match(m.text, /Full Programme on Tue,? 20 Oct 2026 at 18:30/);
  assert.ok(!/discount|%/.test(m.text));
  assert.ok(!/;|–|—/.test(m.text));
});

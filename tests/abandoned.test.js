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
  assert.ok(m.text.includes('unsubscribe') && m.html.includes('unsubscribe'), 'opt out line (PECR)');
});

test('cron stages: day 2 second email once, day 7 becomes a lead, nothing else', async () => {
  const { leadStage, BOOK_URL } = await import('../lib/abandoned.js');
  const ago = (days) => new Date(now - days * 86400000).toISOString();
  const ab = (extra) => ({ ...base, status: 'abandoned', lead_emails: 1, ...extra });
  assert.equal(leadStage(ab({ created_at: ago(1) }), now), null, 'day 1 waits');
  assert.equal(leadStage(ab({ created_at: ago(2) }), now), 'second-email');
  assert.equal(leadStage(ab({ created_at: ago(2), lead_emails: 0 }), now), 'second-email', 'webhook missed: still gets the day 2 email');
  assert.equal(leadStage(ab({ created_at: ago(3), lead_emails: 2 }), now), null, 'already sent twice');
  assert.equal(leadStage(ab({ created_at: ago(7) }), now), 'lead');
  assert.equal(leadStage(ab({ created_at: ago(30), lead_emails: 2 }), now), 'lead');
  assert.equal(leadStage({ ...base, created_at: ago(9) }, now), null, 'status null is the sweep\'s job first');
  assert.equal(leadStage(ab({ created_at: ago(9), status: 'lead' }), now), null, 'idempotent');
  assert.equal(leadStage(ab({ created_at: ago(9), booking_for: 'enquiry' }), now), null);
  assert.equal(BOOK_URL, 'https://www.communitycarephysio.co.uk/?book=1');
});

test('day 2 email: lighter subject, plain booking link when no resume link was saved', async () => {
  const { recoveryEmail, BOOK_URL } = await import('../lib/abandoned.js');
  const row = { ...base, email: 'a@b.c', appointment: 'Initial Assessment', booked_date: '2026-10-20', booked_time: '18:30' };
  const second = recoveryEmail(row, 'https://checkout.stripe.com/c/pay/recover_123', { followUp: true });
  assert.match(second.subject, /^Still thinking about your booking/);
  assert.ok(second.text.includes('already filled in'));
  const plain = recoveryEmail(row, BOOK_URL, { followUp: true });
  assert.ok(plain.text.includes(BOOK_URL));
  assert.ok(!plain.text.includes('already filled in'));
  assert.ok(!plain.text.includes('30 days'));
  assert.ok(plain.html.includes(`href="${BOOK_URL}"`));
  assert.ok(!/;|–|—/.test(plain.text));
  for (const m of [second, plain]) assert.ok(m.text.includes('unsubscribe') && m.html.includes('privacy policy'), 'opt out line (PECR)');
  assert.match(plain.headers['List-Unsubscribe'], /^<mailto:infoccphysio@gmail.com/);
});

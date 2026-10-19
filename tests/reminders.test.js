import test from 'node:test';
import assert from 'node:assert/strict';
import { isSecured } from '../lib/reminders.js';

test('only paid, confirmed or invoiced bookings earn a reminder', () => {
  assert.equal(isSecured({ paid: false, confirmed: false, status: null }), false, 'unpaid checkout');
  assert.equal(isSecured({ paid: false, confirmed: false, status: 'abandoned' }), false);
  assert.equal(isSecured({ paid: true, confirmed: true, status: 'confirmed' }), true, 'Stripe paid');
  assert.equal(isSecured({ paid: false, confirmed: true, status: 'invoiced' }), true, 'admin invoiced');
  assert.equal(isSecured({ paid: true, confirmed: false, status: 'active' }), true, 'package paid');
  assert.equal(isSecured(null), false);
});
